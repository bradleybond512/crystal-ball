#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Source-only ratchet: no evaluation, data flow, generated CSS or computed layout.
// Exclude test/spec files, .d.ts declarations, and directories named generated,
// __generated__, __tests__, or __fixtures__. Symlinks are rejected, never followed.
const EXTENSIONS = new Set(['.css', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.html']);
const KINDS = new Set(['css-z-index', 'css-token', 'js-z-index', 'unsupported']);
const CLASSIFICATIONS = new Set(['dom', 'non-dom', 'separate-document', 'unsupported']);
const printer = ts.createPrinter({ removeComments: true });
const compare = (a, b) => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};
const key = (d) => JSON.stringify([d.path, d.kind, d.anchor, d.expression, d.bindings]);
const nonempty = (s) => typeof s === 'string' && s.trim().length > 0;
const safePath = (s) => nonempty(s) && !path.isAbsolute(s) && !s.includes('\\') && s.split('/').every((p) => p && p !== '.' && p !== '..');

function quotedEnd(text, start) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === text[start]) return index + 1;
    index += text[index] === '\\' ? 2 : 1;
  }
  return -1;
}
function canonical(text) {
  let result = '', space = false, index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { space = true; index++; continue; }
    if (space && result) result += ' ';
    space = false;
    if (['"', "'", '`'].includes(char)) {
      const end = quotedEnd(text, index);
      const stop = end === -1 ? text.length : end;
      result += text.slice(index, stop);
      index = stop;
    } else { result += char; index++; }
  }
  return result.trim();
}
function decodeCss(s) {
  return s.replace(/\\([\da-f]{1,6})(?:\r\n|\s)?|\\([^\r\n\f])/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(Number.parseInt(hex, 16) || 0xFF_FD, 0x10_FF_FF)) : char);
}
function jsText(node, source) { return canonical(printer.printNode(ts.EmitHint.Unspecified, node, source)); }
function literalName(node) {
  if (!node) return null;
  if (ts.isComputedPropertyName(node)) return literalName(node.expression);
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}
function stackingName(name) { return name === 'zIndex' || name === 'z-index' || name?.startsWith('--z-'); }
function accessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function isAssignment(node) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}
function isPlus(node) { return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken; }
function callAnchor(node, source) {
  let target = jsText(node.expression, source);
  if (ts.isPropertyAccessExpression(node.expression) && ts.isArrayLiteralExpression(node.expression.expression)) target = `array.${node.expression.name.text}`;
  if (target === 'Object.assign' && node.arguments[0]) target += '(' + jsText(node.arguments[0], source) + ')';
  return `call:${target}`;
}
function lexicalAnchor(node, source) {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return `${ts.isClassDeclaration(node) ? 'class' : 'function'}:${literalName(node.name) ?? jsText(node.name, source)}`;
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isVariableDeclaration(node)) return `variable:${jsText(node.name, source)}`;
  if (ts.isPropertyAssignment(node) && !stackingName(literalName(node.name))) return `property:${literalName(node.name) ?? jsText(node.name, source)}`;
  if (isAssignment(node)) return `assignment:${jsText(node.left, source)}`;
  if (ts.isCallExpression(node)) return callAnchor(node, source);
  return null;
}
function jsAnchor(node, source) {
  const parts = [];
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
    const part = lexicalAnchor(current, source);
    if (part) parts.push(part);
  }
  return ['js', ...parts.toReversed()].join(' > ');
}
function cleanCss(input, error) {
  let clean = '', index = 0;
  while (index < input.length) {
    if (['"', "'"].includes(input[index])) {
      const end = quotedEnd(input, index);
      if (end === -1) { error('unterminated CSS string'); return null; }
      clean += input.slice(index, end); index = end;
    } else if (input.startsWith('/*', index)) {
      const end = input.indexOf('*/', index + 2);
      if (end === -1) { error('unterminated CSS comment'); return null; }
      clean += input.slice(index, end + 2).replace(/[^\n]/g, ' '); index = end + 2;
    } else { clean += input[index]; index++; }
  }
  return clean;
}
function skipCssToken(clean, index, brackets, error) {
  const char = clean[index];
  if (['"', "'"].includes(char)) return quotedEnd(clean, index);
  if (char === '\\') return index + 2;
  if (char === '(' || char === '[') { brackets.push(char); return index + 1; }
  if (char === ')' || char === ']') {
    if (brackets.pop() !== (char === ')' ? '(' : '[')) error('malformed CSS delimiter');
    return index + 1;
  }
  if (brackets.length) return index + 1;
  return null;
}
function restoreInterpolations(text, replacements) {
  for (const [placeholder, replacement] of replacements) text = text.replaceAll(placeholder, replacement.expression);
  return text;
}
function interpolationBindings(segment, stack, replacements) {
  const bindings = new Map();
  for (const [placeholder, replacement] of replacements) {
    if (![segment, ...stack].some((part) => part.includes(placeholder))) continue;
    for (const binding of replacement.bindings) bindings.set(binding.name, binding);
  }
  return [...bindings.values()].sort((a, b) => compare(a.name, b.name));
}
function cssDeclaration(segment, stack, base, position, bindings, replacements, add) {
  const colon = segment.indexOf(':');
  const restore = (value) => restoreInterpolations(value, replacements);
  const anchors = [base, ...stack.map((value) => restore(value))];
  const selectedBindings = () => replacements.size ? interpolationBindings(segment, stack, replacements) : bindings;
  if (colon !== -1) {
    const name = decodeCss(segment.slice(0, colon).trim());
    if (name.toLowerCase() === 'z-index' || name.startsWith('--z-')) {
      const kind = name.startsWith('--z-') ? 'css-token' : 'css-z-index';
      anchors.push(kind === 'css-token' ? name : 'z-index');
      add(kind, anchors.join(' > '), restore(segment.slice(colon + 1)), position, selectedBindings());
    }
  } else if (/z-index|--z-|\\(?:0*7a|z)/i.test(segment)) {
    add('unsupported', [...anchors, 'unsupported'].join(' > '), restore(segment), position, selectedBindings());
  }
}
function scanCss(input, base, position, bindings, replacements, add, error) {
  const clean = cleanCss(input, error);
  if (clean === null) return;
  const stack = [], brackets = [];
  let start = 0, index = 0;
  const declaration = (end) => {
    const segment = clean.slice(start, end).trim();
    const offset = start + clean.slice(start, end).search(/\S|$/);
    cssDeclaration(segment, stack, base, position + offset, bindings, replacements, add);
  };
  while (index < clean.length) {
    const next = skipCssToken(clean, index, brackets, error);
    if (next !== null) { index = next; continue; }
    const char = clean[index];
    if (char === '{') {
      const selector = canonical(clean.slice(start, index));
      if (!selector) error('empty CSS selector');
      stack.push(selector); start = index + 1;
    } else if (char === ';' || char === '}') {
      declaration(index); start = index + 1;
      if (char === '}' && stack.pop() === undefined) error('unmatched CSS closing brace');
    }
    index++;
  }
  declaration(clean.length);
  if (stack.length || brackets.length) error('unterminated CSS block or delimiter');
}
function containsCss(input) {
  return input.split(/[;{]/).some((segment) => {
    const colon = segment.indexOf(':');
    if (colon === -1) return false;
    const name = decodeCss(segment.slice(0, colon).trim());
    return name.toLowerCase() === 'z-index' || name.startsWith('--z-');
  });
}
function sourceKind(sourcePath) {
  if (/\.[jt]sx$/.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.[cm]?js$/.test(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isReference(node) {
  return ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node);
}
function findBinding(node, scopes) {
  for (let current = node; current; current = current.parent) {
    const binding = scopes.get(current)?.get(node.text);
    if (binding) return binding;
  }
  return null;
}
function constantBinding(binding, source) {
  return binding && ts.isVariableDeclaration(binding) && binding.initializer && binding.parent.getFirstToken(source)?.kind === ts.SyntaxKind.ConstKeyword;
}
function isAccessor(node) {
  return ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isMethodDeclaration(node);
}
function jsSink(node, emit, source, dependencies) {
  if (isAccessor(node) && stackingName(literalName(node.name))) emit(node, 'unsupported', literalName(node.name), jsText(node, source), dependencies(node));
  else if (ts.isPropertyAssignment(node) && stackingName(literalName(node.name))) emit(node, 'js-z-index', literalName(node.name), jsText(node.initializer, source), dependencies(node.initializer));
  else if (ts.isShorthandPropertyAssignment(node) && stackingName(node.name.text)) emit(node, 'unsupported', node.name.text, jsText(node, source), dependencies(node.name));
  else if (isAssignment(node) && stackingName(accessName(node.left))) {
    const plain = node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    emit(node, plain ? 'js-z-index' : 'unsupported', accessName(node.left), jsText(plain ? node.right : node, source), dependencies(node.right));
  }
}
function jsPropertyCall(node, emit, source, dependencies) {
  if (!ts.isCallExpression(node) || accessName(node.expression) !== 'setProperty' || !node.arguments[0]) return;
  const property = ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null;
  if (stackingName(property)) emit(node, node.arguments.length >= 2 ? 'js-z-index' : 'unsupported', property, node.arguments.slice(1).map((arg) => jsText(arg, source)).join(', ') || jsText(node, source), node.arguments.slice(1).flatMap((arg) => dependencies(arg)));
  else if (/zIndex|z-index|--z-/.test(jsText(node.arguments[0], source))) emit(node, 'unsupported', 'dynamic-property', jsText(node, source), dependencies(node));
}
function dynamicProperty(node, source) {
  if (!ts.isComputedPropertyName(node) && !ts.isElementAccessExpression(node)) return false;
  const property = ts.isComputedPropertyName(node) ? node.expression : node.argumentExpression;
  return !literalName(property) && /zIndex|z-index|--z-/.test(jsText(node, source));
}
function embeddedLiteral(node, fragments) {
  return ts.isStringLiteralLike(node) && !fragments.has(node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !(ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) && !(ts.isCallExpression(node.parent) && accessName(node.parent.expression) === 'setProperty');
}
function embeddedTokenEnd(input, index) {
  if (['"', "'"].includes(input[index])) return quotedEnd(input, index);
  if (!input.startsWith('/*', index)) return null;
  const end = input.indexOf('*/', index + 2);
  return end === -1 ? -1 : end + 2;
}
function isMarkup(input) {
  let index = 0;
  while (index < input.length) {
    const end = embeddedTokenEnd(input, index);
    if (end !== null) {
      if (end === -1) return false;
      index = end;
      continue;
    }
    const char = input[index];
    if (['{', ';'].includes(char)) return false;
    if (char === '<' && /[a-z!]/i.test(input[index + 1] ?? '')) return true;
    index++;
  }
  return false;
}
function hasStyleMarkup(input) {
  const stripped = input.replace(/<!--[\s\S]*?-->/g, '');
  if (/<style\b/i.test(stripped)) return true;
  for (const match of stripped.matchAll(/<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    if (/\sstyle\s*=/i.test(match[0])) return true;
  }
  return false;
}
function jsUpdate(node, emit, source, dependencies) {
  if (!ts.isPrefixUnaryExpression(node) && !ts.isPostfixUnaryExpression(node)) return;
  if (node.operator !== ts.SyntaxKind.PlusPlusToken && node.operator !== ts.SyntaxKind.MinusMinusToken) return;
  const name = accessName(node.operand);
  if (stackingName(name)) emit(node, 'unsupported', name, jsText(node, source), dependencies(node.operand));
}
function runtimeHeritage(node) {
  if (!ts.isExpressionWithTypeArguments(node) || !ts.isHeritageClause(node.parent)) return false;
  const declaration = node.parent.parent;
  return node.parent.token === ts.SyntaxKind.ExtendsKeyword && (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration));
}
function decodeHtmlStyle(value) {
  const names = new Map([['quot', '"'], ['apos', "'"], ['amp', '&'], ['lt', '<'], ['gt', '>']]);
  let unsupported = false;
  const decoded = value.replace(/&(#(?:x[\da-f]+|\d+);?|[a-z][a-z\d]*;?)/gi, (whole, reference) => {
    const name = reference.replace(/;$/, '');
    if (name.startsWith('#')) {
      const hex = name[1].toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code === 0 || code > 0x10_FF_FF || (code >= 0xD8_00 && code <= 0xDF_FF)) return '\uFFFD';
      return String.fromCodePoint(code);
    }
    if (names.has(name)) return names.get(name);
    unsupported = true;
    return whole;
  });
  return { decoded, unsupported };
}

export function extractDeclarations(text, { path: sourcePath } = {}) {
  const declarations = [], errors = [];
  if (!safePath(sourcePath) || typeof text !== 'string') return { declarations, errors: ['Invalid source path or content'] };
  const add = (kind, anchor, expression, position, bindings = []) => {
    expression = canonical(expression);
    if (!expression) { errors.push(`${sourcePath}: empty stacking expression at ${anchor}`); return; }
    const tokens = [...new Set([...decodeCss(expression).matchAll(/var\(\s*(--z-[\w-]+)/g)].map((m) => m[1]))].sort(compare);
    declarations.push({ path: sourcePath, kind, anchor, expression, count: 1, bindings, tokens, line: text.slice(0, Math.max(0, position)).split('\n').length });
  };
  const css = (input, base, position, bindings = [], replacements = new Map()) => {
    scanCss(input, base, position, bindings, replacements, add, (message) => errors.push(`${sourcePath}: ${message}`));
  };
  const markup = (input, base, position, bindings, replacements) => {
    const stripped = input.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
    const blocks = [...stripped.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
    if ([...stripped.matchAll(/<style\b/gi)].length !== blocks.length) errors.push(`${sourcePath}: unterminated HTML style block`);
    for (const match of blocks) css(match[1], `${base} > style`, position + match.index, bindings, replacements);
    for (const match of stripped.matchAll(/<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
      const tag = match[0];
      const identity = /\sid\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] ?? /\sclass\s*=\s*(['"])(.*?)\1/i.exec(tag)?.[2] ?? /^<([\w-]+)/.exec(tag)?.[1];
      for (const attribute of tag.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const value = attribute[1] ?? attribute[2] ?? attribute[3];
        const { decoded, unsupported } = decodeHtmlStyle(value);
        const anchor = `${base} > html:${identity} > style`;
        const offset = position + match.index + attribute.index;
        if (unsupported) add('unsupported', anchor, restoreInterpolations(value, replacements), offset, interpolationBindings(value, [], replacements));
        else css(decoded, anchor, offset, bindings, replacements);
      }
    }
  };
  const embedded = (input, base, position, bindings = [], replacements = new Map()) => {
    if (isMarkup(input)) { markup(input, base, position, bindings, replacements); return; }
    if (containsCss(input)) css(input, `${base} > css`, position, bindings, replacements);
    if (hasStyleMarkup(input)) add('unsupported', `${base} > ambiguous-markup`, JSON.stringify(restoreInterpolations(input, replacements)), position, interpolationBindings(input, [], replacements));
  };
  if (sourcePath.endsWith('.css')) css(text, 'css', 0);
  else if (sourcePath.endsWith('.html')) markup(text, 'html', 0, [], new Map());
  else {
    const source = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true, sourceKind(sourcePath));
    for (const diagnostic of source.parseDiagnostics) errors.push(`${sourcePath}: parse error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    const scopes = new Map();
    const scopeOf = (node) => {
      for (let p = node.parent; p; p = p.parent) if (ts.isSourceFile(p) || ts.isBlock(p) || ts.isFunctionLike(p)) return p;
      return source;
    };
    const collect = (node) => {
      if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        const scope = scopeOf(node), bindings = scopes.get(scope) ?? new Map();
        bindings.set(node.name.text, node); scopes.set(scope, bindings);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    const dependencies = (expression) => {
      const found = new Map(), visiting = new Set();
      const visit = (node) => {
        if (isReference(node)) {
          const binding = findBinding(node, scopes);
          if (constantBinding(binding, source)) {
            const name = `${jsAnchor(binding, source)}`;
            if (visiting.has(name)) { errors.push(`${sourcePath}: circular constant binding ${node.text}`); return; }
            if (!found.has(name)) {
              found.set(name, { name, expression: jsText(binding.initializer, source) });
              visiting.add(name); visit(binding.initializer); visiting.delete(name);
            }
          } else if (!binding && /^[A-Z][A-Z\d_]+$/.test(node.text)) errors.push(`${sourcePath}: unresolved constant binding ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(expression);
      return [...found.values()].sort((a, b) => compare(a.name, b.name));
    };
    const embeddedFragments = new WeakSet();
    const emit = (node, kind, name, expression, bindings) => add(kind, `${jsAnchor(node, source)} > ${name}`, expression, node.getStart(source), bindings);
    const concatenated = (node) => {
      const replacements = new Map();
      const concatenate = (part) => {
        if (isPlus(part)) return concatenate(part.left) + concatenate(part.right);
        if (ts.isStringLiteralLike(part)) { embeddedFragments.add(part); return part.text; }
        const placeholder = `___STACK_EXPR_${replacements.size}___`;
        replacements.set(placeholder, { expression: '${' + jsText(part, source) + '}', bindings: dependencies(part) });
        return placeholder;
      };
      embedded(concatenate(node), jsAnchor(node, source), node.getStart(source), [], replacements);
    };
    const template = (node) => {
      let input = node.head.text;
      const replacements = new Map();
      for (const [i, span] of node.templateSpans.entries()) {
        const placeholder = `___STACK_EXPR_${i}___`;
        input += placeholder + span.literal.text;
        replacements.set(placeholder, { expression: '${' + jsText(span.expression, source) + '}', get bindings() { return dependencies(span.expression); } });
      }
      if (!/z-index|zIndex|--z-|\\|&/i.test(input)) return;
      embedded(input, jsAnchor(node, source), node.getStart(source), [], replacements);
    };
    const visit = (node) => {
      if (runtimeHeritage(node)) { visit(node.expression); return; }
      if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node)) return;
      jsSink(node, emit, source, dependencies);
      jsUpdate(node, emit, source, dependencies);
      jsPropertyCall(node, emit, source, dependencies);
      if (dynamicProperty(node, source)) emit(node, 'unsupported', 'dynamic-property', jsText(node, source), dependencies(node));
      if (isPlus(node) && !isPlus(node.parent) && /z-index|--z-|&#/.test(node.getText(source))) concatenated(node);
      if (ts.isTemplateExpression(node)) template(node);
      else if (embeddedLiteral(node, embeddedFragments)) embedded(node.text, jsAnchor(node, source), node.getStart(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const grouped = new Map();
  for (const declaration of declarations) {
    const existing = grouped.get(key(declaration));
    if (existing) existing.count++;
    else grouped.set(key(declaration), declaration);
  }
  return { declarations: [...grouped.values()].sort((a, b) => compare(key(a), key(b))), errors: [...new Set(errors)].sort(compare) };
}

function containedFile(root, relative) {
  if (!safePath(relative)) throw new Error(`unsafe repository path: ${relative}`);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`symlink is unsupported: ${relative}`);
  }
  return current;
}

export function scanRepository(root) {
  const declarations = [], errors = [], files = [];
  const walk = (relative) => {
    let entries;
    try { entries = fs.readdirSync(containedFile(root, relative), { withFileTypes: true }).sort((a, b) => compare(a.name, b.name)); }
    catch (error) { errors.push(`${relative}: ${error.message}`); return; }
    for (const entry of entries) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) { errors.push(`${name}: symlink is unsupported`); continue; }
      if (entry.isDirectory()) {
        if (!['generated', '__generated__', '__tests__', '__fixtures__'].includes(entry.name)) walk(name);
        continue;
      }
      if (!EXTENSIONS.has(path.extname(name)) || /\.(?:test|spec)\.[^.]+$|\.d\.[cm]?ts$/.test(name)) continue;
      files.push(name);
      try { const result = extractDeclarations(fs.readFileSync(containedFile(root, name), 'utf8'), { path: name }); declarations.push(...result.declarations); errors.push(...result.errors); }
      catch (error) { errors.push(`${name}: ${error.message}`); }
    }
  };
  walk('src');
  return { declarations: declarations.sort((a, b) => compare(key(a), key(b))), errors: errors.sort(compare), files };
}

const ENTRY_FIELDS = new Set(['path', 'kind', 'anchor', 'expression', 'count', 'bindings', 'classification', 'owner', 'context', 'rationale', 'evidence']);
function validEntry(entry) {
  return !(!entry || typeof entry !== 'object' || Object.keys(entry).some((k) => !ENTRY_FIELDS.has(k)) || !safePath(entry.path) || !KINDS.has(entry.kind) || !nonempty(entry.anchor) || !nonempty(entry.expression) || !Number.isSafeInteger(entry.count) || entry.count <= 0 || !Array.isArray(entry.bindings) || !CLASSIFICATIONS.has(entry.classification) || !['owner', 'context', 'rationale'].every((k) => nonempty(entry[k])) || !Array.isArray(entry.evidence) || !entry.evidence.length);
}
function validateBindings(entry, label, errors) {
  const bindingNames = new Set();
  for (const binding of entry.bindings) {
    if (!binding || Object.keys(binding).sort().join(',') !== 'expression,name' || !nonempty(binding.name) || !nonempty(binding.expression) || bindingNames.has(binding.name)) errors.push(`${label}: invalid or duplicate binding`);
    bindingNames.add(binding?.name);
  }
}
function evidenceFileExists(evidence, scan, root) {
  if (!root) return scan.files?.includes(evidence.path) || scan.declarations.some((declaration) => declaration.path === evidence.path);
  try { return fs.statSync(containedFile(root, evidence.path)).isFile(); } catch { return false; }
}
function validateEvidence(entry, label, errors, scan, root) {
  for (const evidence of entry.evidence) {
    if (!evidence || Object.keys(evidence).sort().join(',') !== 'anchor,fact,path' || !safePath(evidence.path) || !nonempty(evidence.anchor) || !nonempty(evidence.fact)) { errors.push(`${label}: invalid evidence`); continue; }
    const anchored = scan.declarations.some((declaration) => declaration.path === evidence.path && declaration.anchor === evidence.anchor);
    if (evidence.anchor !== 'file' && !anchored) errors.push(`${label}: missing evidence anchor ${evidence.path} ${evidence.anchor}`);
    if (!evidenceFileExists(evidence, scan, root)) errors.push(`${label}: missing or unsafe evidence file ${evidence.path}`);
  }
}

function reconcileSource(declarations, expected, errors) {
  const tokens = new Set(declarations.filter((d) => d.kind === 'css-token').map((d) => d.anchor.split(' > ').at(-1)));
  for (const declaration of declarations) {
    const entry = expected.get(key(declaration));
    if (!entry) errors.push(`Unowned declaration: ${declaration.path}:${declaration.line} ${declaration.anchor} = ${declaration.expression}`);
    else if (entry.count !== declaration.count) errors.push(`Multiplicity mismatch: ${declaration.path} ${declaration.anchor}: inventory ${entry.count}, source ${declaration.count}`);
    for (const token of declaration.tokens ?? []) if (!tokens.has(token)) errors.push(`Undefined overlay token ${token}: ${declaration.path} ${declaration.anchor}`);
  }
}

export function reconcileInventory(scan, inventory, { root } = {}) {
  const errors = [...(scan.errors ?? [])];
  if (!inventory || inventory.version !== 1 || !Array.isArray(inventory.entries) || Object.keys(inventory).some((k) => !['version', 'entries'].includes(k))) return [...errors, 'Invalid inventory schema/version'];
  const expected = new Map(), actual = new Map(scan.declarations.map((d) => [key(d), d]));
  for (const [index, entry] of inventory.entries.entries()) {
    const label = `inventory entry ${index}`;
    if (!validEntry(entry)) { errors.push(`${label}: invalid schema`); continue; }
    if ((entry.kind === 'unsupported') !== (entry.classification === 'unsupported')) errors.push(`${label}: unsupported declaration requires unsupported classification`);
    validateBindings(entry, label, errors);
    validateEvidence(entry, label, errors, scan, root);
    const id = key(entry);
    if (expected.has(id)) errors.push(`${label}: duplicate inventory declaration ${entry.path} ${entry.anchor}`);
    expected.set(id, entry);
    if (!actual.has(id)) errors.push(`Stale inventory declaration: ${entry.path} ${entry.anchor} = ${entry.expression}`);
  }
  reconcileSource(scan.declarations, expected, errors);
  return [...new Set(errors)].sort(compare);
}

function main() {
  const started = performance.now();
  let root = process.cwd(), inventoryPath = 'scripts/stacking-inventory.json', timing = false;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--timing') { timing = true; continue; }
    if (!['--root', '--inventory'].includes(arg) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${arg}`);
    if (arg === '--root') root = path.resolve(process.argv[++i]); else inventoryPath = process.argv[++i];
  }
  root = fs.realpathSync(root);
  const inventory = JSON.parse(fs.readFileSync(containedFile(root, inventoryPath), 'utf8'));
  const scan = scanRepository(root);
  const errors = reconcileInventory(scan, inventory, { root });
  for (const error of errors) console.error(error);
  console.log(`Stacking inventory: ${scan.files.length} files, ${scan.declarations.length} declarations, ${errors.length} errors`);
  if (timing) console.log(`Cold scan: ${Math.round(performance.now() - started)} ms`);
  if (errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(`Stacking inventory failed: ${error.message}`); process.exitCode = 1; }
}
