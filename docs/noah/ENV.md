# Noah environment variables

Set these in the Noah project: **Project Settings (gear icon) → Env. Variables → Add Variables**. Type the **bare
names** below; Noah adds the `VITE_REACT_APP_` prefix itself (docs.trynoah.ai/integrations/environment-variables:
"All environment variables are automatically prefixed with VITE_REACT_APP_"). The app reads both spellings
(`frontend/src/env.ts`: `VITE_X`, then `VITE_REACT_APP_X`), so the same code runs on Vercel and in Noah.

All values are **public**: they end up in the browser bundle. Never add a service-role key, the verifier key, the X
token or any private key here.

Paste this block in the dialog (it accepts one `KEY=VALUE` per line):

```
SUPABASE_URL=https://pztyjrxfdieleucryskj.supabase.co
SUPABASE_ANON_KEY=sb_publishable_5bRe_SqKFSKDa_GjLemhhg_tda_nfAf
APP_ORIGIN=https://REPLACE-WITH-YOUR-NETLIFY-SITE.netlify.app
```

| Name you type | Noah stores it as | Value | Required |
|---|---|---|---|
| `SUPABASE_URL` | `VITE_REACT_APP_SUPABASE_URL` | `https://pztyjrxfdieleucryskj.supabase.co` | yes |
| `SUPABASE_ANON_KEY` | `VITE_REACT_APP_SUPABASE_ANON_KEY` | the publishable key above (meant for browsers) | yes |
| `APP_ORIGIN` | `VITE_REACT_APP_APP_ORIGIN` | the Netlify URL once Noah has published (step 8 of [STEPS.md](STEPS.md)); until then leave it out and share links use the page's own origin | after publishing |

Not needed (the code's defaults are the live deployment, from `deployment.json`):

| Name | Default |
|---|---|
| `CHAIN_ID` | `6281971` |
| `RPC_URL` | `https://rpc.testnet.dogeos.com/` |
| `EXPLORER_URL` | `https://blockscout.testnet.dogeos.com` |
| `ESCROW_ADDRESS` | `0x207652b0767F9f19d24B5300E2123D415167aCeF` |
| `ESCROW_DEPLOY_BLOCK` | `9065839` |
| `FUNCTIONS_URL` | derived: `<SUPABASE_URL>/functions/v1` |
| `REOWN_PROJECT_ID` | unset: WalletConnect is hidden |

Variables are compiled into the bundle at build time: after changing one, **Redeploy** in Publish → Web App.
