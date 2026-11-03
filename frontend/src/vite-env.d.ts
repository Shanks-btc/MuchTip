/// <reference types="vite/client" />

// Every variable here ends up in the browser bundle. Public values only (wiring-spec section 1); src/env.ts validates them.
interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_ESCROW_ADDRESS?: string;
  readonly VITE_ESCROW_DEPLOY_BLOCK?: string;
  /** https://<ref>.supabase.co, needed for Sign in with X and the chain_events / x_handles reads. */
  readonly VITE_SUPABASE_URL?: string;
  /** The project's anon / publishable key (meant for browsers). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Edge Functions base URL; defaults to <VITE_SUPABASE_URL>/functions/v1. */
  readonly VITE_FUNCTIONS_URL?: string;
  /** WalletConnect (Reown) project id; the WalletConnect option is hidden when empty. */
  readonly VITE_REOWN_PROJECT_ID?: string;
  /** Public origin for share links, e.g. https://muchtip.vercel.app. Defaults to the page's own origin. */
  readonly VITE_APP_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Counted from ../test/*.t.sol at build time (vite.config.ts); null when the contract tests aren't in the build. */
declare const __CONTRACT_TEST_COUNT__: number | null;
