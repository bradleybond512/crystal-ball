/* eslint-disable sonarjs/no-nested-conditional, sonarjs/function-return-type, sonarjs/no-async-constructor, no-console */
import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { getLocalApiPort, isDesktopRuntime } from '@/services/runtime';
import {
  getDesktopReadinessChecks,
  getKeyBackedAvailabilitySummary,
  getNonParityFeatures,
} from '@/services/desktop-readiness';
import {
  fetchServiceStatuses,
  type ServiceStatusResult as ServiceStatus,
} from '@/services/infrastructure';
import { h, replaceChildren, type DomChild } from '@/utils/dom-utils';

interface LocalBackendStatus {
  enabled?: boolean;
  mode?: string;
  port?: number;
  remoteBase?: string;
}

type CategoryFilter = 'all' | 'cloud' | 'dev' | 'comm' | 'ai' | 'saas';

function getCategoryLabel(category: CategoryFilter): string {
  const labels: Record<CategoryFilter, string> = {
 all: t('components.serviceStatus.categories.all'),
 cloud: t('components.serviceStatus.categories.cloud'),
 dev: t('components.serviceStatus.categories.dev'),
 comm: t('components.serviceStatus.categories.comm'),
 ai: t('components.serviceStatus.categories.ai'),
 saas: t('components.serviceStatus.categories.saas'),
  };
  return labels[category];
}

export class ServiceStatusPanel extends Panel {
  private services: ServiceStatus[] = [];
  private loading = true;
  private error: string | null = null;
  private filter: CategoryFilter = 'all';
  private localBackend: LocalBackendStatus | null = null;
  private cloudReachable: boolean | null = null;

  constructor() {
 super({ id: 'service-status', title: t('panels.serviceStatus'), showCount: false });
 void this.fetchStatus();
 if (!isDesktopRuntime()) void this.probeCloudHealth();
  }

  private async probeCloudHealth(): Promise<void> {
 // Cheap HEAD/GET probe to whatever the `/api/*` redirect resolves to in
 // this deployment. Uses a short timeout so a loading panel never hangs
 // on a slow or offline network.
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 4000);
 try {
 const res = await fetch('/api/health', { method: 'GET', signal: controller.signal });
 this.cloudReachable = res.ok || res.status === 404; // 404 still means the edge answered
 } catch {
 this.cloudReachable = false;
 } finally {
 clearTimeout(timer);
 this.render();
 }
  }

  private lastServicesJson = '';

  public async fetchStatus(): Promise<boolean> {
 try {
 const data = await fetchServiceStatuses();
 if (!data.success) throw new Error('Failed to load status');

 const fingerprint = data.services.map(s => `${s.name}:${s.status}`).join(',');
 const changed = fingerprint !== this.lastServicesJson;
 this.lastServicesJson = fingerprint;
 this.services = data.services;
 this.error = null;
 return changed;
 } catch (error) {
 if (this.isAbortError(error)) return false;
 this.error = error instanceof Error ? error.message : 'Failed to fetch';
 console.error('[ServiceStatus] Fetch error:', error);
 return true;
 } finally {
 this.loading = false;
 this.render();
 }
  }

  private setFilter(filter: CategoryFilter): void {
 this.filter = filter;
 this.render();
  }

  private getFilteredServices(): ServiceStatus[] {
 if (this.filter === 'all') return this.services;
 return this.services.filter(s => s.category === this.filter);
  }

  protected render(): void {
 if (this.loading) {
 replaceChildren(this.content,
 h('div', { className: 'service-status-loading' },
 h('div', { className: 'loading-spinner' }),
 h('span', null, t('components.serviceStatus.checkingServices')),
 ),
 );
 return;
 }

 if (this.error) {
 replaceChildren(this.content,
 h('div', { className: 'service-status-error' },
 h('span', { className: 'error-text' }, this.error),
 h('button', {
 className: 'retry-btn',
 onClick: () => { this.loading = true; this.render(); void this.fetchStatus(); },
 }, t('common.retry')),
 ),
 );
 return;
 }

 const filtered = this.getFilteredServices();
 const issues = filtered.filter(s => s.status !== 'operational');

 replaceChildren(this.content,
 this.buildBackendStatus(),
 this.buildDesktopReadiness(),
 this.buildSummary(filtered),
 this.buildFilters(),
 h('div', { className: 'service-status-list' },
 ...this.buildServiceItems(filtered),
 ),
 issues.length === 0 ? h('div', { className: 'all-operational' }, t('components.serviceStatus.allOperational')) : false,
 );
  }

  private buildBackendStatus(): DomChild {
 if (!isDesktopRuntime()) {
 const reachable = this.cloudReachable;
 const label = reachable === null
 ? 'Checking cloud API…'
 : (reachable
 ? 'Cloud API reachable'
 : 'Cloud API unreachable — features that rely on server proxying may fail.');
 const stateClass = reachable === false ? 'service-status-backend warning' : 'service-status-backend';
 return h('div', { className: stateClass },
 label, ' · ', h('strong', null, 'api.crystalball.app'),
 );
 }

 if (!this.localBackend?.enabled) {
 return h('div', { className: 'service-status-backend warning' },
 t('components.serviceStatus.backendUnavailable'),
 );
 }

 const port = this.localBackend.port ?? getLocalApiPort();
 const remote = this.localBackend.remoteBase ?? 'https://crystalball.app';

 return h('div', { className: 'service-status-backend' },
 'Local backend active on ', h('strong', null, `127.0.0.1:${port}`),
 ' · cloud fallback: ', h('strong', null, remote),
 );
  }

  private buildSummary(services: ServiceStatus[]): HTMLElement {
 const operational = services.filter(s => s.status === 'operational').length;
 const degraded = services.filter(s => s.status === 'degraded').length;
 const outage = services.filter(s => s.status === 'outage').length;

 return h('div', { className: 'service-status-summary' },
 h('div', { className: 'summary-item operational' },
 h('span', { className: 'summary-count' }, String(operational)),
 h('span', { className: 'summary-label' }, t('components.serviceStatus.ok')),
 ),
 h('div', { className: 'summary-item degraded' },
 h('span', { className: 'summary-count' }, String(degraded)),
 h('span', { className: 'summary-label' }, t('components.serviceStatus.degraded')),
 ),
 h('div', { className: 'summary-item outage' },
 h('span', { className: 'summary-count' }, String(outage)),
 h('span', { className: 'summary-label' }, t('components.serviceStatus.outage')),
 ),
 );
  }

  private buildDesktopReadiness(): DomChild {
 if (!isDesktopRuntime()) return false;

 const checks = getDesktopReadinessChecks(Boolean(this.localBackend?.enabled));
 const keySummary = getKeyBackedAvailabilitySummary();
 const nonParity = getNonParityFeatures();

 return h('div', { className: 'service-status-desktop-readiness' },
 h('div', { className: 'service-status-desktop-title' }, t('components.serviceStatus.desktopReadiness')),
 h('div', { className: 'service-status-desktop-subtitle' },
 t('components.serviceStatus.acceptanceChecks', { ready: String(checks.filter(check => check.ready).length), total: String(checks.length), available: String(keySummary.available), featureTotal: String(keySummary.total) }),
 ),
 h('ul', { className: 'service-status-desktop-list' },
 ...checks.map(check =>
 h('li', null, `${check.ready ? '✅' : '⚠️'} ${check.label}`),
 ),
 ),
 h('details', { className: 'service-status-non-parity' },
 h('summary', null, t('components.serviceStatus.nonParityFallbacks', { count: String(nonParity.length) })),
 h('ul', null,
 ...nonParity.map(feature =>
 h('li', null, h('strong', null, feature.panel), `: ${feature.fallback}`),
 ),
 ),
 ),
 );
  }

  private buildFilters(): HTMLElement {
 const categories: CategoryFilter[] = ['all', 'cloud', 'dev', 'comm', 'ai', 'saas'];
 return h('div', { className: 'service-status-filters' },
 ...categories.map(key =>
 h('button', {
 className: `status-filter-btn ${this.filter === key ? 'active' : ''}`,
 dataset: { filter: key },
 onClick: () => this.setFilter(key),
 }, getCategoryLabel(key)),
 ),
 );
  }

  private buildServiceItems(services: ServiceStatus[]): HTMLElement[] {
 return services.map(service =>
 h('div', { className: `service-status-item ${service.status}` },
 h('span', { className: 'status-icon' }, this.getStatusIcon(service.status)),
 h('span', { className: 'status-name' }, service.name),
 h('span', { className: `status-badge ${service.status}` }, service.status.toUpperCase()),
 ),
 );
  }

  private getStatusIcon(status: string): string {
 switch (status) {
 case 'operational': { return '●';
 }
 case 'degraded': { return '◐';
 }
 case 'outage': { return '○';
 }
 default: { return '?';
 }
 }
  }

}
