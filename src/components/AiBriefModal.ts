// AI Brief modal — opens from the toolbar button, shows the latest
// situational brief, and offers copy + download .txt.
//
// Cache hit renders the text immediately. Cache miss runs the generator
// and progressively reveals each paragraph as a perceived "stream" — the
// llm-adapter underneath is non-streaming for now, so this is animated
// on the renderer side rather than via SSE.

import { generateAiBrief, type AiBriefSuccess, type AiBriefError } from '@/services/synthesis/ai-brief-generator';



export class AiBriefModal {
  private element: HTMLElement;
  private contentEl: HTMLElement;
  private metaEl: HTMLElement;
  private copyBtn: HTMLButtonElement;
  private downloadBtn: HTMLButtonElement;
  private currentText = '';
  private currentResult: AiBriefSuccess | null = null;

  constructor() {
 const overlay = document.createElement('div');
 overlay.className = 'ai-brief-modal-overlay';

 const modal = document.createElement('div');
 modal.className = 'ai-brief-modal';
 modal.setAttribute('role', 'dialog');
 modal.setAttribute('aria-modal', 'true');
 modal.setAttribute('aria-labelledby', 'aiBriefTitle');

 const header = document.createElement('div');
 header.className = 'ai-brief-modal-header';
 const title = document.createElement('span');
 title.className = 'ai-brief-modal-title';
 title.id = 'aiBriefTitle';
 title.textContent = '🧠 AI Situation Brief';
 const closeBtn = document.createElement('button');
 closeBtn.className = 'ai-brief-modal-close';
 closeBtn.type = 'button';
 closeBtn.setAttribute('aria-label', 'Close');
 closeBtn.textContent = '×';
 header.append(title, closeBtn);

 const content = document.createElement('div');
 content.className = 'ai-brief-modal-content';

 const footer = document.createElement('div');
 footer.className = 'ai-brief-modal-footer';
 const meta = document.createElement('span');
 meta.className = 'ai-brief-modal-meta';
 const actions = document.createElement('span');
 actions.className = 'ai-brief-modal-actions';
 const copyBtn = document.createElement('button');
 copyBtn.className = 'ai-brief-modal-btn';
 copyBtn.dataset.action = 'copy';
 copyBtn.type = 'button';
 copyBtn.textContent = 'Copy';
 copyBtn.disabled = true;
 const downloadBtn = document.createElement('button');
 downloadBtn.className = 'ai-brief-modal-btn';
 downloadBtn.dataset.action = 'download';
 downloadBtn.type = 'button';
 downloadBtn.textContent = 'Download .txt';
 downloadBtn.disabled = true;
 actions.append(copyBtn, downloadBtn);
 footer.append(meta, actions);

 modal.append(header, content, footer);
 overlay.append(modal);
 document.body.append(overlay);

 this.element = overlay;
 this.contentEl = content;
 this.metaEl = meta;
 this.copyBtn = copyBtn;
 this.downloadBtn = downloadBtn;
 this.wireEvents(closeBtn);
  }

  /** Open the modal and run the generator. Cache hits render synchronously. */
  public async open(): Promise<void> {
 this.element.classList.add('active');
 this.renderLoading();
 const result = await generateAiBrief();
 this.applyResult(result);
  }

  public close(): void {
 this.element.classList.remove('active');
  }

  /** Test seam — let test code drive a result without invoking the generator. */
  public applyResult(result: AiBriefSuccess | AiBriefError): void {
 if ('reason' in result) {
 this.renderError(result);
 return;
 }
 this.currentResult = result;
 this.currentText = result.text;
 this.renderReady(result, !result.cached);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private clearContent(): void {
 while (this.contentEl.firstChild) this.contentEl.firstChild.remove();
  }

  private renderLoading(): void {
 this.clearContent();
 const spinner = document.createElement('div');
 spinner.className = 'ai-brief-spinner';
 spinner.setAttribute('role', 'status');
 spinner.setAttribute('aria-live', 'polite');
 spinner.textContent = 'Generating brief…';
 this.contentEl.append(spinner);
 this.metaEl.textContent = '';
 this.setActionsEnabled(false);
  }

  private renderError(err: AiBriefError): void {
 this.clearContent();
 const errEl = document.createElement('div');
 errEl.className = 'ai-brief-error';
 errEl.textContent = err.reason === 'no-api-key'
 ? 'Configure ANTHROPIC_API_KEY in settings to enable AI briefs. Or configure Ollama for free on-device generation.'
 : err.message;
 this.contentEl.append(errEl);
 this.metaEl.textContent = err.reason;
 this.setActionsEnabled(false);
  }

  private renderReady(result: AiBriefSuccess, progressive: boolean): void {
 this.clearContent();
 const paragraphs = result.text.split(/\n\n+/).filter(p => p.trim().length > 0);
 const elements: HTMLElement[] = [];
 for (const [i, paragraph] of paragraphs.entries()) {
 const p = document.createElement('p');
 p.className = progressive ? 'ai-brief-paragraph is-revealing' : 'ai-brief-paragraph';
 p.dataset.paragraphIndex = String(i);
 p.textContent = paragraph ?? '';
 this.contentEl.append(p);
 elements.push(p);
 }
 if (progressive) {
 // 200ms staggered reveal — the whole brief surfaces inside ~1s.
 // Renderer-side animation; the llm-adapter underneath is non-streaming.
 elements.forEach((el, i) => {
 setTimeout(() => el.classList.add('is-visible'), i * 200);
 });
 }
 const when = formatTime(result.generatedAt);
 const cachedLabel = result.cached ? 'cached' : 'fresh';
 const modelSuffix = result.model ? `, ${result.model}` : '';
 this.metaEl.textContent = `Generated at ${when} · ${cachedLabel} · Powered by Claude (${result.provider}${modelSuffix})`;
 this.setActionsEnabled(true);
  }

  private setActionsEnabled(enabled: boolean): void {
 this.copyBtn.disabled = !enabled;
 this.downloadBtn.disabled = !enabled;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private wireEvents(closeBtn: HTMLButtonElement): void {
 closeBtn.addEventListener('click', () => this.close());
 this.element.addEventListener('click', e => {
 if ((e.target as HTMLElement).classList.contains('ai-brief-modal-overlay')) this.close();
 });
 this.copyBtn.addEventListener('click', () => { void this.copyToClipboard(); });
 this.downloadBtn.addEventListener('click', () => { this.downloadAsText(); });
  }

  private async copyToClipboard(): Promise<void> {
 if (!this.currentText) return;
 try {
 await navigator.clipboard.writeText(this.currentText);
 const original = this.copyBtn.textContent;
 this.copyBtn.textContent = 'Copied';
 setTimeout(() => { this.copyBtn.textContent = original; }, 1200);
 } catch { /* ignore clipboard failures (no permission, etc) */ }
  }

  private downloadAsText(): void {
 if (!this.currentText) return;
 const result = this.currentResult;
 const modelSuffix = result?.model ? ` (${result.model})` : '';
 const meta = result
 ? `# Crystal Ball — AI Situation Brief\n# Generated: ${result.generatedAt}\n# Provider: ${result.provider}${modelSuffix}\n\n`
 : '';
 const blob = new Blob([meta + this.currentText + '\n'], { type: 'text/plain;charset=utf-8' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 const stamp = (result?.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, '-');
 a.href = url;
 a.download = `crystal-ball-brief-${stamp}.txt`;
 document.body.append(a);
 a.click();
 a.remove();
 URL.revokeObjectURL(url);
  }
}

function formatTime(iso: string): string {
  try {
 const d = new Date(iso);
 if (Number.isNaN(d.getTime())) return iso;
 return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
 return iso;
  }
}

// ── Singleton accessor ───────────────────────────────────────────────────────

let _instance: AiBriefModal | null = null;

export function getAiBriefModal(): AiBriefModal {
  _instance ??= new AiBriefModal();
  return _instance;
}
