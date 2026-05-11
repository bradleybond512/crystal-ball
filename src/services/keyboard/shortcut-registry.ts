/**
 * Shortcut registry — pure, testable mapping of keyboard chords to actions.
 *
 * Use `parseChord` to convert "Cmd+K" / "⌘1" / "Ctrl+Shift+/" → a normalized
 * descriptor, and `matchesChord` to test a `KeyboardEvent`-shaped object
 * against it. `ShortcutRegistry` collects bindings and dispatches on match.
 *
 * Why a registry: the existing keydown listeners in `event-handlers.ts` and
 * `panel-layout.ts` each parse modifiers ad-hoc. Centralizing makes ⌘1–9 +
 * help-overlay reuse the same input-suppression rules without duplication.
 */

export interface ChordDescriptor {
  /** Lowercased single-character key or named key ("/" "\\" "k" "1" "Escape"). */
  key: string;
  /** ⌘ on macOS, Win/Super elsewhere. KeyboardEvent.metaKey. */
  meta: boolean;
  /** Ctrl. KeyboardEvent.ctrlKey. */
  ctrl: boolean;
  /** Shift. KeyboardEvent.shiftKey. */
  shift: boolean;
  /** Alt / Option. KeyboardEvent.altKey. */
  alt: boolean;
}

export interface KeyboardEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface ShortcutBinding {
  /** Stable id ("cmd-k", "cmd-slash", "cmd-1"). */
  id: string;
  /** Human label for help overlay ("Open command palette"). */
  label: string;
  /** Group label for help overlay ("Navigation", "Panels"). */
  group: string;
  /** Display string ("⌘K"). */
  display: string;
  /** Parsed chord. */
  chord: ChordDescriptor;
  /** Run when chord matches and event is not suppressed. */
  run: () => void;
  /**
   * When true (default), the chord does NOT fire if the focused element is an
   * INPUT/TEXTAREA/contenteditable. Escape and the palette-internal arrows
   * opt out by setting this to false.
   */
  suppressInTextInputs?: boolean;
}

/** Map common alias tokens to canonical chord pieces. Case-insensitive. */
const TOKEN_ALIASES: Record<string, keyof ChordDescriptor | 'cmd'> = {
  cmd: 'meta', meta: 'meta', '⌘': 'meta', super: 'meta', win: 'meta',
  ctrl: 'ctrl', control: 'ctrl', '⌃': 'ctrl',
  shift: 'shift', '⇧': 'shift',
  alt: 'alt', option: 'alt', opt: 'alt', '⌥': 'alt',
  cmdorctrl: 'meta', // resolved at parse time as meta on mac, ctrl elsewhere; we keep meta and let matcher accept either
};

function tokenizeChord(raw: string): string[] {
  if (raw.includes('+') || raw.includes('-') || raw.includes(' ')) {
    return raw.split(/[+\-\s]+/).filter(Boolean);
  }
  // Glued symbol form: "⌘K", "⌘⇧/". High-codepoint chars are each a token;
  // the first ASCII char terminates and the remainder becomes the key.
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? '';
    if ((ch.codePointAt(0) ?? 0) > 127) {
      out.push(ch);
      continue;
    }
    out.push(raw.slice(i));
    break;
  }
  return out;
}

function applyToken(out: ChordDescriptor, tok: string, spec: string): void {
  const alias = TOKEN_ALIASES[tok.toLowerCase()];
  if (alias === 'meta') { out.meta = true; return; }
  if (alias === 'ctrl') { out.ctrl = true; return; }
  if (alias === 'shift') { out.shift = true; return; }
  if (alias === 'alt') { out.alt = true; return; }
  if (out.key) {
    throw new Error(`parseChord: multiple non-modifier keys in "${spec}"`);
  }
  out.key = normalizeKey(tok);
}

/**
 * Parse a chord string like "Cmd+K", "⌘⇧/", "Ctrl+Alt+1".
 * Throws on empty key or unknown token to surface typos early.
 */
export function parseChord(spec: string): ChordDescriptor {
  if (!spec?.trim()) {
    throw new Error('parseChord: empty spec');
  }
  const tokens = tokenizeChord(spec.trim());
  const out: ChordDescriptor = { key: '', meta: false, ctrl: false, shift: false, alt: false };
  for (const tok of tokens) applyToken(out, tok, spec);
  if (!out.key) {
    throw new Error(`parseChord: no key in "${spec}"`);
  }
  return out;
}

/**
 * Normalize a key token to its canonical KeyboardEvent.key form.
 * Single letters lowercase. Named keys (Escape, Enter, etc.) preserved.
 */
export function normalizeKey(token: string): string {
  if (token.length === 1) return token.toLowerCase();
  // Common aliases for named keys.
  const lc = token.toLowerCase();
  switch (lc) {
    case 'esc': { return 'Escape';
    }
    case 'escape': { return 'Escape';
    }
    case 'enter': { return 'Enter';
    }
    case 'return': { return 'Enter';
    }
    case 'space': { return ' ';
    }
    case 'tab': { return 'Tab';
    }
    case 'up': case 'arrowup': { return 'ArrowUp';
 }
    case 'down': case 'arrowdown': { return 'ArrowDown';
 }
    case 'left': case 'arrowleft': { return 'ArrowLeft';
 }
    case 'right': case 'arrowright': { return 'ArrowRight';
 }
    case 'slash': { return '/';
    }
    case 'backslash': { return '\\';
    }
    case 'comma': { return ',';
    }
    case 'period': { return '.';
    }
    default: { return lc;
    }
  }
}

/**
 * Does the event match this chord?
 *
 * Meta/Ctrl special case: a chord written with `meta: true` also matches when
 * `ctrlKey` is true (so Cmd+K on macOS and Ctrl+K on Windows/Linux work from
 * the same binding). A chord written with `ctrl: true` only matches Ctrl.
 */
export function matchesChord(event: KeyboardEventLike, chord: ChordDescriptor): boolean {
  const evKey = (event.key ?? '').length === 1 ? event.key.toLowerCase() : event.key;
  if (evKey !== chord.key) return false;
  if (chord.shift !== Boolean(event.shiftKey)) return false;
  if (chord.alt !== Boolean(event.altKey)) return false;
  if (chord.meta) {
    // Either Cmd or Ctrl satisfies a meta-tagged binding (cross-platform).
    return Boolean(event.metaKey) || Boolean(event.ctrlKey);
  }
  if (chord.ctrl) {
    // Ctrl-only: must be Ctrl without Meta to avoid double-fire on macOS Cmd+Ctrl chords.
    return Boolean(event.ctrlKey) && !event.metaKey;
  }
  // No modifier required: must NOT have meta/ctrl held (avoids stealing OS chords).
  return !event.metaKey && !event.ctrlKey;
}

/**
 * Should the event be suppressed because the user is typing in a field?
 * Treats null/undefined activeElement as "not in input". Suppression matches
 * the pattern already used in `event-handlers.ts`.
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false;
  const el = target as Partial<HTMLElement> & { tagName?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export interface ShortcutRegistry {
  register(binding: ShortcutBinding): void;
  unregister(id: string): void;
  /** All registered bindings, useful for the help overlay. */
  list(): ShortcutBinding[];
  /**
   * Try to dispatch the event. Returns true iff a binding matched and ran
   * (caller should `preventDefault()` if true).
   */
  dispatch(event: KeyboardEventLike & { target?: EventTarget | null }): boolean;
}

export function createShortcutRegistry(): ShortcutRegistry {
  const bindings = new Map<string, ShortcutBinding>();
  return {
    register(b) {
      if (bindings.has(b.id)) {
        // Re-registration is allowed (e.g., hot-reload); last writer wins.
      }
      bindings.set(b.id, b);
    },
    unregister(id) { bindings.delete(id); },
    list() { return [...bindings.values()]; },
    dispatch(event) {
      const suppress = isTypingTarget(event.target);
      for (const b of bindings.values()) {
        if (matchesChord(event, b.chord)) {
          if (suppress && (b.suppressInTextInputs ?? true)) return false;
          try { b.run(); } catch { /* swallow — a faulty handler must not break dispatch */ }
          return true;
        }
      }
      return false;
    },
  };
}

/** Build the ⌘1…⌘9 panel-focus bindings for a list of panel keys. */
export function buildPanelFocusBindings(
  panelKeys: readonly string[],
  focus: (panelKey: string, index: number) => void,
): ShortcutBinding[] {
  const out: ShortcutBinding[] = [];
  for (let i = 0; i < Math.min(panelKeys.length, 9); i++) {
    const idx = i + 1;
    const key = panelKeys[i];
    if (!key) continue;
    out.push({
      id: `panel-focus-${idx}`,
      label: `Focus panel ${idx}`,
      group: 'Panels',
      display: `⌘${idx}`,
      chord: parseChord(`Cmd+${idx}`),
      run: () => focus(key, i),
    });
  }
  return out;
}
