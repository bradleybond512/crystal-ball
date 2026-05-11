// Pure render helpers for DiseaseOutbreakPanel's Wastewater and
// Cross-Referenced tabs. Pulled out of the panel class so they can be
// unit-tested without a DOM.

import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type { WastewaterData, WastewaterLevel, WastewaterTrend } from '@/services/wastewater';
import type { WhoDonAlert, WhoProMedCrossReference } from '@/services/disease-intel';

const LEVEL_RANK: Record<WastewaterLevel, number> = { high: 3, elevated: 2, moderate: 1, low: 0 };
const TREND_RANK: Record<WastewaterTrend, number> = { increasing: 2, stable: 1, decreasing: 0 };

export function levelClass(level: WastewaterLevel): string {
  switch (level) {
    case 'high': { return 'eq-major';
    }
    case 'elevated': { return 'eq-strong';
    }
    case 'moderate': { return 'eq-moderate';
    }
    case 'low': { return '';
    }
  }
}

export function trendArrow(trend: WastewaterTrend): string {
  switch (trend) {
    case 'increasing': { return '↑';
    }
    case 'decreasing': { return '↓';
    }
    case 'stable': { return '→';
    }
  }
}

export function sortWastewaterSignals(data: WastewaterData): WastewaterData['signals'] {
  return [...data.signals].sort((a, b) => {
    const levelDiff = LEVEL_RANK[b.level] - LEVEL_RANK[a.level];
    if (levelDiff !== 0) return levelDiff;
    const trendDiff = TREND_RANK[b.trend] - TREND_RANK[a.trend];
    if (trendDiff !== 0) return trendDiff;
    return a.jurisdiction.localeCompare(b.jurisdiction);
  });
}

export function renderWastewaterTab(data: WastewaterData | null): string {
  if (!data || data.signals.length === 0) {
    if (data?.degraded) {
      return `<div class="panel-empty">Wastewater data unavailable: ${escapeHtml(data.reason ?? 'upstream error')}</div>`;
    }
    return '<div class="panel-empty">No wastewater signals available.</div>';
  }
  const surgeWatchesHtml = data.surgeWatches.map(w => escapeHtml(w)).join(' · ');
  const banner = data.surgeWatches.length > 0
    ? `<div class="eq-row eq-major" style="padding:6px 8px;margin-bottom:6px">⚠ ${surgeWatchesHtml}</div>`
    : '';
  const sorted = sortWastewaterSignals(data);
  const rows = sorted.slice(0, 50).map(signal => {
    const cls = levelClass(signal.level);
    const ptcSign = signal.ptc15d != null && signal.ptc15d > 0 ? '+' : '';
    const ptcStr = signal.ptc15d == null ? '—' : `${ptcSign}${signal.ptc15d.toFixed(0)}%`;
    const pctStr = signal.percentile15d == null ? '—' : `${signal.percentile15d.toFixed(0)}`;
    return `<tr class="eq-row ${cls}">
      <td class="do-sev">${escapeHtml(signal.pathogen)}</td>
      <td class="do-disease">${escapeHtml(signal.jurisdiction)}</td>
      <td class="do-source">${escapeHtml(signal.level)}</td>
      <td class="do-source">${trendArrow(signal.trend)} ${ptcStr}</td>
      <td class="do-age">p${pctStr}</td>
    </tr>`;
  }).join('');
  return `<div class="do-panel-content">
    ${banner}
    <table class="eq-table">
      <thead>
        <tr><th>Pathogen</th><th>State</th><th>Level</th><th>15d Trend</th><th>Pctile</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fires-footer">
      <span class="fires-source">CDC NWSS · ${sorted.length} signals</span>
      <span class="fires-updated">${data.lastUpdated ?? 'never'}</span>
    </div>
  </div>`;
}

export function renderCrossReferencedTab(
  crossRefs: WhoProMedCrossReference[],
  whoDonAlerts: WhoDonAlert[],
): string {
  if (crossRefs.length === 0) {
    return '<div class="panel-empty">No WHO DON × ProMED cross-references in the recent window.</div>';
  }
  const whoById = new Map<string, WhoDonAlert>();
  for (const alert of whoDonAlerts) {
    whoById.set(alert.id, alert);
    whoById.set(alert.title, alert);
  }
  const rows = crossRefs.slice(0, 25).map(ref => {
    const who = whoById.get(ref.whoDonId);
    const safeUrl = who?.url ? sanitizeUrl(who.url) : '';
    const linkHtml = safeUrl
      ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="do-link">${escapeHtml(who?.title ?? ref.whoDonId)}</a>`
      : escapeHtml(who?.title ?? ref.whoDonId);
    const promedList = ref.promedIds.slice(0, 5).map(id => escapeHtml(id)).join(', ');
    return `<tr class="eq-row eq-strong">
      <td class="do-sev">↔</td>
      <td class="do-disease">${linkHtml}</td>
      <td class="do-country">${escapeHtml(who?.country ?? '—')}</td>
      <td class="do-source" title="ProMED post IDs">${promedList}</td>
    </tr>`;
  }).join('');
  return `<div class="do-panel-content">
    <table class="eq-table">
      <thead>
        <tr><th></th><th>WHO DON</th><th>Country</th><th>ProMED IDs</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fires-footer">
      <span class="fires-source">${crossRefs.length} cross-referenced events</span>
    </div>
  </div>`;
}
