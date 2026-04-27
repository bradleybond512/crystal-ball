import { RUNTIME_FEATURES, type RuntimeSecretKey } from './runtime-config';

const INDEX = new Map<RuntimeSecretKey, string[]>();

for (const feature of RUNTIME_FEATURES) {
  for (const key of feature.requiredSecrets) {
    const list = INDEX.get(key) ?? [];
    if (!list.includes(feature.name)) list.push(feature.name);
    INDEX.set(key, list);
  }
}

export function featuresFor(key: RuntimeSecretKey): string[] {
  return INDEX.get(key) ?? [];
}
