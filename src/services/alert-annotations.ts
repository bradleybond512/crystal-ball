/**
 * Alert annotations — lets users attach free-text notes to any alert.
 * Persisted to localStorage keyed by alert ID.
 */

const STORAGE_KEY = 'crystalball-alert-annotations-v1';

interface AnnotationRecord {
  text: string;
  createdAt: number;
  updatedAt: number;
}

const annotations = new Map<string, AnnotationRecord>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, AnnotationRecord>;
    for (const [k, v] of Object.entries(obj)) annotations.set(k, v);
  } catch { /* noop */ }
}

function save(): void {
  const obj: Record<string, AnnotationRecord> = {};
  for (const [k, v] of annotations) obj[k] = v;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { /* noop */ }
}

export function getAnnotation(alertId: string): string | null {
  return annotations.get(alertId)?.text ?? null;
}

export function setAnnotation(alertId: string, text: string): void {
  const existing = annotations.get(alertId);
  const now = Date.now();
  if (text.trim() === '') {
    annotations.delete(alertId);
  } else {
    annotations.set(alertId, {
      text: text.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  save();
}

export function getAllAnnotations(): Map<string, AnnotationRecord> {
  return new Map(annotations);
}

export function initAlertAnnotations(): void {
  load();
}
