/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_VARIANT__: 'full' | 'tech' | 'finance' | 'happy';
declare const __BUILD_TAG__: string;
declare const __BUILD_COMMIT_SHA__: string;
declare const __BUILD_TIMESTAMP__: string;
declare const __BUILD_ARCH__: string;

interface ImportMetaEnv {
  readonly VITE_VARIANT?: 'full' | 'tech' | 'finance' | 'happy';
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_WS_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
