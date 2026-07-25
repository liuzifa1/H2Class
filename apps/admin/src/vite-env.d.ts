/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CORE_URL: string;
  readonly VITE_AGENT_URL: string;
  readonly VITE_AGENT_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
