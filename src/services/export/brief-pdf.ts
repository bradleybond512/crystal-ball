/**
 * Daily intelligence brief → PDF renderer.
 *
 * Pure function over the existing `IntelligenceBriefing` shape (no
 * data fetching, no globals). Caller passes a briefing + optional
 * classification footer; returns a jsPDF document the caller can save
 * via Tauri fs, download in the browser, or post elsewhere.
 *
 * Plan invariants:
 *   - Letter-size US (8.5 × 11") with 0.75" margins so the brief
 *     prints cleanly and reads well on screen.
 *   - Header repeats on every page with the brief id + UTC date.
 *   - Footer carries the classification stamp + page-N-of-M counter.
 *   - Long sections wrap and overflow to subsequent pages — no
 *     content silently truncated.
 *   - Text rendering uses jsPDF's built-in Helvetica for portability;
 *     no font upload required.
 */

import { jsPDF } from 'jspdf';
import type {
  BriefingItem,
  BriefingSection,
  IntelligenceBriefing,
  ThreatSeverity,
} from '../intelligence-briefing';

// ── Public types ──────────────────────────────────────────────────────

export interface BriefPdfOptions {
  /** Classification footer line. Default 'UNCLASSIFIED // FOR OFFICIAL
   *  USE ONLY' per spec. */
  classification?: string;
  /** Override the document title shown in the header. Default
   *  'CRYSTAL BALL INTELLIGENCE BRIEF'. */
  title?: string;
}

const DEFAULT_CLASSIFICATION = 'UNCLASSIFIED // FOR OFFICIAL USE ONLY';
const DEFAULT_TITLE = 'CRYSTAL BALL INTELLIGENCE BRIEF';

// Letter-size points (jsPDF default). 1pt = 1/72 inch.
const PAGE_WIDTH = 612;     // 8.5"
const PAGE_HEIGHT = 792;    // 11"
const MARGIN = 54;          // 0.75"
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEADER_BOTTOM_Y = 80;
const FOOTER_TOP_Y = PAGE_HEIGHT - 40;

// ── Severity → color (RGB tuples) ─────────────────────────────────────

const SEVERITY_COLOR: Readonly<Record<ThreatSeverity, [number, number, number]>> = {
  critical: [194, 0, 0],
  high:     [217, 86, 0],
  medium:   [186, 137, 0],
  low:      [70, 113, 70],
  info:     [80, 80, 80],
};

function severityRgb(sev: ThreatSeverity | undefined): [number, number, number] {
  return sev ? SEVERITY_COLOR[sev] : SEVERITY_COLOR.info;
}

// ── Public API ────────────────────────────────────────────────────────

export function renderBriefingPdf(
  briefing: IntelligenceBriefing,
  options: BriefPdfOptions = {},
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const dateStr = new Date(briefing.generatedAt).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const title = options.title ?? DEFAULT_TITLE;
  const classification = options.classification ?? DEFAULT_CLASSIFICATION;

  let y = HEADER_BOTTOM_Y + 20;
  drawHeader(doc, title, dateStr);

  // No sections → render an empty-state line so the page isn't blank.
  if (briefing.sections.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('No active sections in this briefing.', MARGIN, y);
  } else {
    for (const section of briefing.sections) {
      y = renderSection(doc, section, y, () => {
        drawHeader(doc, title, dateStr);
        return HEADER_BOTTOM_Y + 20;
      });
    }
  }

  // Stamp footer + page numbers across every page.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    drawFooter(doc, classification, i, pageCount);
  }
  return doc;
}

/** Convenience: returns the PDF as a Blob suitable for browser
 *  download. */
export function renderBriefingPdfBlob(
  briefing: IntelligenceBriefing,
  options: BriefPdfOptions = {},
): Blob {
  return renderBriefingPdf(briefing, options).output('blob');
}

/** Convenience: returns the PDF as a base64 string. The sidecar uses
 *  this for the POST /api/export/brief response payload. */
export function renderBriefingPdfBase64(
  briefing: IntelligenceBriefing,
  options: BriefPdfOptions = {},
): string {
  // jsPDF's `datauristring` returns "data:application/pdf;base64,...";
  // strip the prefix so the consumer can decide how to wrap it.
  const dataUri = renderBriefingPdf(briefing, options).output('datauristring');
  const idx = dataUri.indexOf(',');
  return idx === -1 ? dataUri : dataUri.slice(idx + 1);
}

/** Default filename: crystal-ball-brief-YYYY-MM-DD.pdf (UTC date). */
export function briefPdfFilename(briefing: IntelligenceBriefing): string {
  const iso = new Date(briefing.generatedAt).toISOString().slice(0, 10);
  return `crystal-ball-brief-${iso}.pdf`;
}

// ── Layout primitives ─────────────────────────────────────────────────

function drawHeader(doc: jsPDF, title: string, dateStr: string): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(20, 20, 20);
  doc.text(`${title} — ${dateStr} UTC`, MARGIN, MARGIN + 16);
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, HEADER_BOTTOM_Y, PAGE_WIDTH - MARGIN, HEADER_BOTTOM_Y);
}

function drawFooter(doc: jsPDF, classification: string, page: number, total: number): void {
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, FOOTER_TOP_Y, PAGE_WIDTH - MARGIN, FOOTER_TOP_Y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  doc.text(`Classification: ${classification}`, MARGIN, FOOTER_TOP_Y + 16);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Page ${page} of ${total}`,
    PAGE_WIDTH - MARGIN,
    FOOTER_TOP_Y + 16,
    { align: 'right' },
  );
}

/** Render one section starting at `y`. Returns the new `y` cursor
 *  after the section. May add new pages. `onPageBreak` is called when
 *  the renderer hops to a new page so the caller can re-draw the
 *  header and reset the y cursor. */
function renderSection(
  doc: jsPDF,
  section: BriefingSection,
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 60, onPageBreak);

  // Section title bar.
  const [r, g, b] = severityRgb(section.severity);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(r, g, b);
  doc.text(section.title.toUpperCase(), MARGIN, y);
  y += 6;
  doc.setDrawColor(r, g, b);
  doc.setLineWidth(1);
  doc.line(MARGIN, y, MARGIN + 80, y);
  y += 14;

  // Section narrative (wrapped).
  if (section.content.trim().length > 0) {
    y = renderWrappedText(doc, section.content, y, onPageBreak);
    y += 6;
  }

  // Sub-items (bullets).
  if (section.items && section.items.length > 0) {
    for (const item of section.items) {
      y = renderItem(doc, item, y, onPageBreak);
    }
  }
  return y + 14;
}

function renderItem(
  doc: jsPDF,
  item: BriefingItem,
  startY: number,
  onPageBreak: () => number,
): number {
  let y = ensureRoomFor(doc, startY, 30, onPageBreak);
  const [r, g, b] = severityRgb(item.severity);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(r, g, b);
  doc.text('•', MARGIN, y);
  doc.setTextColor(20, 20, 20);
  doc.text(item.title, MARGIN + 14, y);
  y += 12;
  if (item.detail.trim().length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    y = renderWrappedText(doc, item.detail, y, onPageBreak, MARGIN + 14, CONTENT_WIDTH - 14);
    y += 4;
  }
  return y;
}

/** Wrap `text` to fit inside `width` (defaults to content width) and
 *  draw it line-by-line with page-break awareness. Returns the new
 *  `y` cursor below the rendered block. */
function renderWrappedText(
  doc: jsPDF,
  text: string,
  startY: number,
  onPageBreak: () => number,
  x: number = MARGIN,
  width: number = CONTENT_WIDTH,
): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const wrapped = doc.splitTextToSize(text, width) as string[];
  let y = startY;
  const lineHeight = 12;
  for (const line of wrapped) {
    y = ensureRoomFor(doc, y, lineHeight, onPageBreak);
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** If `y + needed` would overflow the footer, add a page and reset y
 *  via `onPageBreak`. */
function ensureRoomFor(
  doc: jsPDF,
  y: number,
  needed: number,
  onPageBreak: () => number,
): number {
  if (y + needed >= FOOTER_TOP_Y - 10) {
    doc.addPage();
    return onPageBreak();
  }
  return y;
}
