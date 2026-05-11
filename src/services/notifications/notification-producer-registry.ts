export type ProducerSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ProducerNotificationPayload {
  title: string;
  body: string;
  sound: string;
  dedupeKey: string;
  meta?: Record<string, unknown>;
}

export interface ProducerRegistration<T = unknown> {
  domain: string;
  name: string;
  getSeverity(data: T): ProducerSeverity;
  formatNotification(data: T): ProducerNotificationPayload;
}

export interface ProducerFireRecord {
  domain: string;
  at: number;
  severity: ProducerSeverity;
  fired: boolean;
  payload?: ProducerNotificationPayload;
}

export interface ProducerFireOptions {
  threshold?: ProducerSeverity;
  send?: (payload: ProducerNotificationPayload) => Promise<void>;
}

export interface ProducerRegistry {
  register<T>(producer: ProducerRegistration<T>): void;
  shouldFire(domain: string, data: unknown, threshold?: ProducerSeverity): boolean;
  fire(domain: string, data: unknown, options?: ProducerFireOptions): Promise<{ fired: boolean; record: ProducerFireRecord }>;
  history(): readonly ProducerFireRecord[];
}

const RANK: Record<ProducerSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function createProducerRegistry(): ProducerRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const producers = new Map<string, ProducerRegistration<any>>();
  const records: ProducerFireRecord[] = [];

  return {
    register<T>(producer: ProducerRegistration<T>): void {
      producers.set(producer.domain, producer);
    },

    shouldFire(domain: string, data: unknown, threshold: ProducerSeverity = 'medium'): boolean {
      const producer = producers.get(domain);
      if (!producer) return false;
      const severity = producer.getSeverity(data) as ProducerSeverity;
      return RANK[severity] >= RANK[threshold];
    },

    async fire(domain: string, data: unknown, options: ProducerFireOptions = {}): Promise<{ fired: boolean; record: ProducerFireRecord }> {
      const { threshold = 'medium', send } = options;
      const producer = producers.get(domain);
      if (!producer) {
        const record: ProducerFireRecord = { domain, at: Date.now(), severity: 'low', fired: false };
        records.push(record);
        return { fired: false, record };
      }
      const severity = producer.getSeverity(data) as ProducerSeverity;
      const shouldFire = RANK[severity] >= RANK[threshold];
      if (shouldFire) {
        const payload = producer.formatNotification(data) as ProducerNotificationPayload;
        const record: ProducerFireRecord = { domain, at: Date.now(), severity, fired: true, payload };
        records.push(record);
        if (send) await send(payload);
        return { fired: true, record };
      }
      const record: ProducerFireRecord = { domain, at: Date.now(), severity, fired: false };
      records.push(record);
      return { fired: false, record };
    },

    history(): readonly ProducerFireRecord[] {
      return records;
    },
  };
}
