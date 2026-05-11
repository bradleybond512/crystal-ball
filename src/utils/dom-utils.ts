/** Anything that can appear as a child of h() / fragment(). */
export type DomChild = Node | string | number | null | undefined | false;

/** Props accepted by h(). */
export interface DomProps {
  className?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
  [key: string]: unknown;
}

export function h(
  tag: string,
  propsOrChild?: DomProps | DomChild | null,
  ...children: DomChild[]
): HTMLElement {
  const el = document.createElement(tag);

  let allChildren: DomChild[];

  if (
	propsOrChild != undefined &&
	typeof propsOrChild === 'object' &&
	!(propsOrChild instanceof Node)
  ) {
	applyProps(el, propsOrChild as DomProps);
	allChildren = children;
  } else {
	allChildren = [propsOrChild as DomChild, ...children];
  }

  appendChildren(el, allChildren);
  return el;
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function fragment(...children: DomChild[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  return frag;
}

export function clearChildren(el: Element): void {
  while (el.lastChild) el.lastChild.remove();
}

export function replaceChildren(el: Element, ...children: DomChild[]): void {
  const frag = document.createDocumentFragment();
  appendChildren(frag, children);
  clearChildren(el);
  el.append(frag);
}

export function rawHtml(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

const SAFE_TAGS = new Set([
  'strong', 'em', 'b', 'i', 'br', 'p', 'ul', 'ol', 'li', 'span', 'div', 'a',
]);
const SAFE_ATTRS = new Set(['class', 'href', 'target', 'rel']);

function stripAttrsAndHref(el: Element): void {
  for (const attr of el.attributes) {
	if (!SAFE_ATTRS.has(attr.name.toLowerCase())) {
	  el.removeAttribute(attr.name);
	}
  }
  if (el.hasAttribute('href')) {
	const href = el.getAttribute('href') ?? '';
	if (!/^https?:\/\//i.test(href) && !href.startsWith('/') && !href.startsWith('#')) {
	  el.removeAttribute('href');
	}
  }
}

/** Like rawHtml() but strips tags and attributes not in the allowlist. */
export function safeHtml(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = (parent: Element | DocumentFragment) => {
	// eslint-disable-next-line unicorn/no-useless-spread -- childNodes is a live NodeList; spread to static array before mutating
	for (const node of [...parent.childNodes]) {
	  if (node.nodeType !== Node.ELEMENT_NODE) continue;
	  const el = node as Element;
	  if (!SAFE_TAGS.has(el.tagName.toLowerCase())) {
		while (el.firstChild) parent.insertBefore(el.firstChild, el);
		el.remove();
		continue;
	  }
	  stripAttrsAndHref(el);
	  walk(el);
	}
  };
  walk(tpl.content);
  return tpl.content;
}

function applyStyleProp(el: HTMLElement, value: unknown): void {
  if (typeof value === 'string') {
	el.style.cssText = value;
  } else if (typeof value === 'object' && value !== null) {
	Object.assign(el.style, value as Partial<CSSStyleDeclaration>);
  }
}

function applyProps(el: HTMLElement, props: DomProps): void {
  for (const key in props) {
	const value = props[key];
	if (value == undefined || value === false) continue;

	if (key === 'className') {
	  el.className = value as string;
	} else if (key === 'style') {
	  applyStyleProp(el, value);
	} else if (key === 'dataset') {
	  const ds = value as Record<string, string>;
	  for (const k in ds) {
		el.dataset[k] = ds[k]!;
	  }
	} else if (key.startsWith('on') && typeof value === 'function') {
	  el.addEventListener(
		key.slice(2).toLowerCase(),
		value as EventListener,
	  );
	} else if (value === true) {
	  el.setAttribute(key, '');
	} else if (typeof value === 'string' || typeof value === 'number') {
	  el.setAttribute(key, String(value));
	}
  }
}

function appendChildren(
  parent: Element | DocumentFragment,
  children: DomChild[],
): void {
  for (const child of children) {
	if (child == undefined || child === false) continue;
	if (child instanceof Node) {
	  parent.append(child);
	} else {
	  parent.append(document.createTextNode(String(child)));
	}
  }
}
