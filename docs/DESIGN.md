# MuchTip design system

**Source of truth:** [`docs/design/MuchTip-design-spec-v3.html`](design/MuchTip-design-spec-v3.html), every approved screen and
state (L0–L5, F1–F4, S1, C-*, M1–M2). It replaces [`landing.reference.html`](design/landing.reference.html) and
[`landing.reference-2.html`](design/landing.reference-2.html), which are kept for history; the spec wins on any conflict.
Tokens live in [`frontend/tailwind.config.ts`](../frontend/tailwind.config.ts), motion in
[`frontend/src/index.css`](../frontend/src/index.css). Use the token, not the hex.

Every number, balance, X ID, hash and count in the spec is illustrative. The app reads each one from its real source
(table at the end) and labels anything that isn't live yet as **Demo**, the way the spec does.

## Colour

| Token | Hex | Use |
|---|---|---|
| `gold` | `#F2B824` | hero, final CTA, primary action (send card CTA, Claim all) |
| `ink` | `#0E0F14` | text, borders on key surfaces (send card, /tip and /claim cards), dark sections, primary buttons |
| `paper` | `#FAFAF7` | page; cards are white |
| `line` / `line-2` | `#E7E5DE` / `#E0DED6` | dividers, card borders; `line-soft` `#ECEAE3` inside cards, `line-input` `#DDDAD0` presets and secondary buttons, `line-wallet` `#D9D7CF` wallet chip |
| `gold-ink` | `#8A6400` | eyebrows and links on light |
| `gold-deep` / `gold-text` | `#5A4307` / `#2B2410` | hero second line and labels / hero body on gold |
| `gold-wash`, `gold-line`, `gold-track` | `#FFFBEB`, `#F4E3A8`, `#F1E8C8` | escrow surfaces, the refund note, the escrow progress track |
| `success` | `#16A34A`, `#0F6A31` on `#E7F6EC` | found recipient, Claimed, live dot; `success-wash` `#F3FAF5`, `success-line` `#CDEBD6` |
| `error` | `#B42318` on `#FDECEA` | not found, failed; alert box `#FDF6F5` / `#F3C9C4` |
| `warning` | `#8A3B0A` on `#FFF7ED` | wrong network, not enough DOGE, refund deadlines; `warning-line` `#F5D9B8`, `warning-border` `#B45309` |
| `tipped` / `refunded` | `#FFF6D6`·`#6B4E00`·dot `#E0A800` / `#F0EFEA`·`#4A4A52`·dot `#8B8A84` | event badges |
| `ink-2`, `ink-3`, `muted`, `muted-2` | `#3D3D45`, `#4A4A52`, `#6B6A64`, `#8B8A84` | text steps; `muted-2` only for decoration and disabled text |
| `surface-*` | chip `#F2F1EC`, well `#F7F6F1`, track `#EFEEE8`, row hover `#FBF8EE` | chips, fee box, tab track, table hover |
| `night-*` | card `#17181F`, line `#2B2C35`, text `#B8B7B0`, muted `#8E8D86` | the creators section |

## Type

Inter 700 for headlines (−0.035 to −0.045em), 400–600 for UI and body (15–19 px). JetBrains Mono for amounts, hashes,
addresses and eyebrows (11–14 px, 0.06em). Numbered eyebrows: "01 — HOW THE MONEY MOVES".

## Components (`frontend/src/components/ui`)

| Component | Spec |
|---|---|
| `Button` | 40 px in the nav, 48–54 px for primary actions, radius 10–12 px, never pills. Variants: primary (ink), gold, outline, secondary, warning, ghost |
| `Input` (send card fields) | 48–50 px, 1 px ink border (green when found, red when not), gold focus ring 3 px (`.mt-input`) |
| `Card` | radius 14–16 px, 1 px border; key surfaces have an ink border and the deep send-card shadow |
| `EventBadge`, `StatusChip`, `Tag` | 24–26 px, radius 6–7 px, dot + label |
| `Stat`, `Skeleton`, `Toast`, `TxSteps`/`TxRow`, `WalletButton`, `AddressChip`, `CopyButton`/`TxHash` | as in the spec frames |

Layout: max width 1280 px (app pages 1180), 32 px gutter, 16 px on phones.

## Motion

Fast and functional only: spinner, skeleton shimmer, 300 ms fade-in on resolve, live-dot pulse, dashed flow line. Hover: 1 px
lift on buttons, row tint on tables, border darken on cards. All of it is off under `prefers-reduced-motion`.

## Responsive

Below 768 px the spec's mobile layouts (M1) render: card-first hero with a compact send card, the compact money flow,
activity as cards with pill filters, the compact creators block and footer. Below 1024 px the nav collapses to the M1 header
(Connect + menu) and the M2 menu. M1 omits the trust, steps, FAQ and final-CTA sections, but M2's menu links to two of them, so
they stay on phones in the M1 type scale. Checked with no horizontal overflow on every route at 320–1920 px.

## Where each number comes from

| On screen | Source |
|---|---|
| Wallet, balance, network | wagmi (`useAccount`, `useBalance` on Chikyū), `switchChain` |
| Min tip, refund window | `TipEscrow.minTip()`, `refundDelay()` |
| Network fee, "total, at most" | DogeOS L1 fee oracle `getL1Fee` on a throwaway-signed copy of the real call, × 1.5 buffer; fixed ceilings if the oracle fails (FEES.md §5) |
| Recipient | Supabase `resolve` (cached for the card, **fresh** on /tip before signing) |
| Activity, totals | `feed()` every 10 s |
| Ready to claim | `TipEscrow.balanceOf(idHash)` |
| Pending tips, refund countdowns, /me | `tips(i)` + `tipStatus(i)` via Multicall3; tx hashes from `Tipped` logs |
| Claim history | `Claimed` logs for the account's idHash |
| Fee paid | raw receipt: `l1Fee + gasUsed × effectiveGasPrice` |

## Deliberate differences from the spec

| Spec | Build | Why |
|---|---|---|
| "covered by 54 tests" | 56 | `test/TipEscrow.t.sol` has 49 unit, 4 fuzz and 3 invariant tests |
| F3 "We couldn't reach the DogeOS RPC" | "We couldn't reach the activity feed" | the feed answers from its index even when the RPC is down; failing to reach the feed is what the state means |
| Found card "Developers @XDevelopers" | the account's real display name ("X Developers") | the spec's name is illustrative |
| Fee "0.02 – 0.03" (two decimals) | two decimals, more when the estimate would read 0.00 | Chikyū fees currently drop below a cent |
| M2 shows only the landing links | /tip, /claim, /me use the same header with Send / Claim / My tips | the app nav of the C-* frames, on a phone |
