import type { AlertSeverity, AlertSource, UnifiedAlert } from './unified-alerts';

export interface WarningDisposition {
  heldDuringCooldown: boolean;
  updatedTo?: AlertSeverity;
}

interface Resident extends WarningDisposition {
  source: AlertSource;
  generation: number;
  latestIssue?: number;
  highest?: AlertSeverity;
}

const ranks: Record<AlertSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export class WarningInboxSession {
  private residents = new Map<string, Resident>();
  heldCount = 0;

  constructor(private readonly limit: number) {}

  observe(alert: UnifiedAlert, changedRevision: boolean, live: boolean, issue: number | undefined): void {
    let row = this.residents.get(alert.id);
    if (row && row.source !== alert.source) {
      this.residents.delete(alert.id);
      row = undefined;
    }
    if (!row) {
      if (!live || this.residents.size >= this.limit) return;
      row = { source: alert.source, generation: 0, heldDuringCooldown: false };
      this.residents.set(alert.id, row);
    } else if (changedRevision) {
      row.generation++;
      if (row.updatedTo !== alert.severity) delete row.updatedTo;
    }
    if (!live || issue === undefined || (row.latestIssue !== undefined && issue <= row.latestIssue)) return;
    row.latestIssue = issue;
    if (row.highest && ranks[alert.severity] <= ranks[row.highest]) return;
    if (row.highest) row.updatedTo = alert.severity;
    row.highest = alert.severity;
  }

  guard(alert: UnifiedAlert): (() => boolean) | undefined {
    const row = this.residents.get(alert.id);
    if (row?.source !== alert.source) return;
    const generation = row.generation;
    return () => this.residents.get(alert.id) === row
      && row.generation === generation;
  }

  hold(alert: UnifiedAlert): void {
    const row = this.residents.get(alert.id);
    if (row?.source === alert.source && !row.heldDuringCooldown) {
      row.heldDuringCooldown = true;
      this.heldCount++;
    }
  }

  disposition(alert: UnifiedAlert): WarningDisposition | undefined {
    const row = this.residents.get(alert.id);
    if (row?.source !== alert.source || (!row.updatedTo && !row.heldDuringCooldown)) return;
    return { heldDuringCooldown: row.heldDuringCooldown, ...(row.updatedTo && { updatedTo: row.updatedTo }) };
  }

  revoke(id: string): void {
    const row = this.residents.get(id);
    if (row) row.generation++;
  }

  remove(id: string): void { this.residents.delete(id); }

  reset(): void {
    this.residents.clear();
    this.heldCount = 0;
  }
}
