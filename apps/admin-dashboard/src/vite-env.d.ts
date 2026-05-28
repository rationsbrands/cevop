/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_CUSTOMER_PWA_URL?: string;
  readonly VITE_ADMIN_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __cevopDeferredInstallPrompt: any;
}
