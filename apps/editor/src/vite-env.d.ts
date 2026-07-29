/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Inclui sondas CDP somente no build estático usado pelos verificadores locais. */
  readonly VITE_THEATRUM_VERIFY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
