// Minimal ANSI → HTML converter. Handles:
//   - SGR codes: 0 (reset), 1 (bold), 2 (dim), 30-37/90-97 (fg colors)
//   - Carriage return (\r) with line reset (so spinners don't spam the log)
//   - Strips all other CSI/OSC sequences
// Good enough for Claude CLI output on a phone. Not a full terminal emulator.

const COLOR_CLASS = {
  31: 'ansi-red', 91: 'ansi-red',
  32: 'ansi-green', 92: 'ansi-green',
  33: 'ansi-yellow', 93: 'ansi-yellow',
  34: 'ansi-blue', 94: 'ansi-blue',
  35: 'ansi-magenta', 95: 'ansi-magenta',
  36: 'ansi-cyan', 96: 'ansi-cyan',
};

export function ansiToHtml(text, state = { classes: new Set() }) {
  let html = '';
  let i = 0;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const applyCodes = (codes) => {
    for (const raw of codes) {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n) || n === 0) { state.classes.clear(); continue; }
      if (n === 1) { state.classes.add('ansi-bold'); continue; }
      if (n === 2) { state.classes.add('ansi-dim'); continue; }
      if (n === 22) { state.classes.delete('ansi-bold'); state.classes.delete('ansi-dim'); continue; }
      if (n === 39) {
        for (const c of [...state.classes]) if (c.startsWith('ansi-') && !['ansi-bold','ansi-dim'].includes(c)) state.classes.delete(c);
        continue;
      }
      const klass = COLOR_CLASS[n];
      if (klass) {
        for (const c of [...state.classes]) if (c.startsWith('ansi-') && !['ansi-bold','ansi-dim'].includes(c)) state.classes.delete(c);
        state.classes.add(klass);
      }
    }
  };

  const openSpan = () => state.classes.size ? `<span class="${[...state.classes].join(' ')}">` : '';
  const closeSpan = () => state.classes.size ? '</span>' : '';

  let buf = '';
  const flush = () => {
    if (!buf) return;
    html += openSpan() + esc(buf) + closeSpan();
    buf = '';
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '\x1b' && text[i + 1] === '[') {
      flush();
      // CSI ... final-byte
      let j = i + 2;
      while (j < text.length && !/[\x40-\x7e]/.test(text[j])) j++;
      const seq = text.slice(i + 2, j);
      const final = text[j];
      if (final === 'm') applyCodes(seq.split(';'));
      // all other CSI (cursor moves, erase) are ignored
      i = j + 1;
      continue;
    }
    if (ch === '\x1b' && text[i + 1] === ']') {
      // OSC ... BEL or ESC \\
      flush();
      let j = i + 2;
      while (j < text.length && text[j] !== '\x07' && !(text[j] === '\x1b' && text[j + 1] === '\\')) j++;
      i = j + (text[j] === '\x07' ? 1 : 2);
      continue;
    }
    if (ch === '\r' && text[i + 1] !== '\n') {
      // Overwrite the current line — for the PWA we just emit a newline so spinners don't replace content.
      buf += '\n';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return html;
}
