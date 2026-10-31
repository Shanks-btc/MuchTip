# FEES.md: what a transaction costs on Chikyū, and how the UI should show it

Source data: two live runs on the DogeOS Chikyū testnet (chain ID 6281971). (1) The e2e run of the previous contract
revision, 2026-10-30; hashes in `e2e-result.testnet-v1.json` (blocks 9039602 to 9039628), plus read-only measurements of
DogeOS's fee oracle taken afterwards (sections 2 to 4). (2) The final batched run of the final contract, 2026-10-31
(blocks 9065839 to 9065879, section 2b), which added the `setVerifier` fee. The two runs were charged about 10× apart for
the same kind of transaction (section 3). Everything below is VERIFIED unless marked UNVERIFIED.

## 1. The cost model (VERIFIED)

```
fee paid = l1Fee + gasUsed × effectiveGasPrice
```

Confirmed to the wei for all five transactions against the sender's on-chain balance change. `l1Fee` is a field on the
**raw** `eth_getTransactionReceipt` result. It is not part of `eth_estimateGas` or the gas price, and ethers v6's receipt
object drops it, so read it with `provider.send("eth_getTransactionReceipt", [hash])`.
[DogeOS docs](https://docs.dogeos.com/en/developers/transaction-fees-on-dogeos): the fee is split into an execution fee and a
"Data and Finality fee"; "the transaction fee shown in the wallet isn't the whole picture unless the software is
specifically aware of DogeOS's fee calculations"; once the sequencer processes a transaction its L1 fee is locked in.

## 2. Measured fees (previous contract revision)

| Action | Raw tx size | gasUsed | Execution fee (DOGE) | `l1Fee` (DOGE) | **Total (DOGE)** |
|---|---|---|---|---|---|
| Deploy (7.6 KB) | 7,576 B | 1,554,309 | 0.000024 | 6.828893 | **6.8289** |
| Tip (first) | 152 B | 136,441 | 0.000002 | 0.218136 | **0.2181** |
| Tip (second) | 152 B | 119,341 | 0.000002 | 0.218136 | **0.2181** |
| Claim | 404 B | 116,625 | 0.000002 | 0.350375 | **0.3504** |
| Refund | 144 B | 44,439 | 0.0000007 | 0.241043 | **0.2410** |
| `setVerifier`, claim with the final contract | | | | | measured in the final run: section 2b |
| Tip to an account that already holds a balance | | | | | *not measured* (the final run's third tip went to an account whose balance had just been claimed to 0). Only the gas part would change, and it is negligible. |

- The **execution part is negligible** (at most 0.00003 DOGE); the fee is essentially all `l1Fee`.
- **A wallet that shows only gas will under-quote by a factor of about 100,000.** How MetaMask and MyDoge actually display a
  DogeOS fee is UNVERIFIED; plan for them to show the tiny number.
- The two tips paid the same `l1Fee` to the wei, so a given transaction shape costs the same while the network inputs
  do not change.

## 2b. Measured fees: final contract, final batched run (2026-10-31, ~13:15 UTC)

Read from the raw receipts; every transaction is `status=ok` on Blockscout. Fee = `l1Fee` + gasUsed × effectiveGasPrice.
The 9 fees sum to 1.710134 DOGE and, with the 0.02 DOGE the two claims paid to the throwaway recipient, equal the
deployer's balance change to the wei. `l1BaseFee` was 3.64e12 before and after the run (about 10× below the 2026-10-30
run), so **these totals are low-fee-window numbers; compare them with section 2 only through the oracle ratio column.**

| Action | Raw tx size | gasUsed | Execution fee (DOGE) | `l1Fee` (DOGE) | **Total (DOGE)** | Oracle quote ÷ `l1Fee` |
|---|---|---|---|---|---|---|
| Deploy, final contract (8.6 KB), the real deployment | 8,612 B | 1,749,129 | 0.000027 | 0.768161 | **0.7682** | 2.975 |
| Deploy, e2e throwaway copy | 8,612 B | 1,749,105 | 0.000027 | 0.763591 | **0.7636** | 2.976 |
| Tip (first tip ever on the contract) | 152 B | 136,466 | 0.0000021 | 0.021879 | **0.0219** | 1.000 |
| Tip (new account) | 152 B | 119,366 | 0.0000019 | 0.021879 | **0.0219** | 1.000 |
| Tip (account whose balance was just claimed) | 152 B | 119,366 | 0.0000019 | 0.022699 | **0.0227** | 1.000 |
| Claim (first claim for an account) | 404 B | 118,752 | 0.0000019 | 0.035143 | **0.0351** | 1.696 |
| Claim (second claim, after a verifier rotation) | 404 B | 76,652 | 0.0000012 | 0.036460 | **0.0365** | 1.696 |
| Refund | 144 B | 44,461 | 0.0000007 | 0.018768 | **0.0188** | 1.145 |
| **`setVerifier`** | 144 B | 28,762 | 0.00000045 | 0.021488 | **0.0215** | 1.000 |

- **`setVerifier` costs 0.0215 DOGE** at this window's prices (tx `0xbb41d012…a91e`), about the same as a tip. At the
  previous run's prices (about 10× higher) it would be roughly 0.2 DOGE; that scaling is an estimate, not a measurement.
  It is owner-only and rare, so it does not affect the UI's buffer rule.
- A tip costs about 10× less than last time (0.2181 to 0.0219) and a claim 10× less (0.3504 to 0.0351); a refund 12.8× less
  (0.2410 to 0.0188). The ratio is not uniform, which fits the refund being charged below its oracle quote (below).
- `setVerifier` and `refund` are both 144 bytes but were charged differently (0.021488 vs 0.018768): the refund was charged
  less than the oracle's quote, the `setVerifier` exactly the quote. Why is UNVERIFIED.

## 3. These fees are NOT stable (this changes the UI design)

DogeOS has a pre-deployed fee oracle at `0x5300000000000000000000000000000000000002` (a Scroll `L1GasPriceOracle`; the docs
tell you to use its `getL1Fee(signed RLP transaction)` to estimate). I read it at historical blocks.

| Window | What I measured |
|---|---|
| 3.3 hours (41 samples, 100 blocks apart) | `l1BaseFee` ranged 6.2e12 to 4.6e13, a **7.4× swing**. The oracle's quote for the *same* tip transaction ranged **0.038 to 0.278 DOGE** (median 0.117); claim **0.102 to 0.757** (median 0.318); refund **0.036 to 0.263** (median 0.111). |
| 1 hour (121 samples, 10 blocks / ~30 s apart) | The tip quote ranged 0.101 to 0.292 (2.9×). Change between consecutive readings: median 0%, 90th percentile +0.6%, **largest rise +33.6%**, largest fall −11%. Only 54 of 120 readings differed from the previous one. |
| At the e2e run | `l1BaseFee` was about 3.6e13 to 4.8e13, in the upper part of the 3.3-hour range. The tip (0.218) and refund (0.241) were charged near that window's maximum; the claim (0.350) near its middle. |
| At the final run, a day later | `l1BaseFee` was **3.64e12** (read by `fee-check` before the run and again after it, same value), below the minimum of the 3.3-hour window. The same tip was charged **0.0219**, 10× less. Within the run it moved once: the tip and claim `l1Fee` rose 3.7% between block 9065853 and 9065874. |

So the numbers in section 2 are one snapshot. **Fees on this testnet can be roughly 2 to 5 times lower or higher an hour
later, and were 10× lower a day later; the `l1BaseFee` values seen span 3.6e12 to 4.8e13, a 13× range.** A hard-coded range
would be wrong. (UNVERIFIED how long this behaviour lasts or whether mainnet behaves the same.)

### How accurate is the oracle?

| Action | Oracle quote for the exact signed tx at the block before inclusion ÷ `l1Fee` actually charged |
|---|---|
| Tip | **1.0000** (exact; the quote was identical for blocks 9039597 to 9039606) |
| Claim | 1.696 |
| Refund | 1.145 |
| Deploy | 2.756 |

Final run (section 2b), same measurement: tip 1.000 (three tips), `setVerifier` 1.000, claim 1.696 (twice), refund 1.145,
deploy 2.975 and 2.976.

- The oracle matched every tip and the `setVerifier` to the wei and **quoted more than was charged** for claim, refund and
  deploy. Across both runs that is 12 of 12 transactions with quote ≥ charge, and the claim (1.696) and refund (1.145)
  ratios repeated to three digits a day apart, so the gap looks like a property of the transaction shape, not noise.
  That supports treating the oracle quote as an upper bound for these shapes, but it is still an observation over six
  shapes, not a guarantee; keep the 1.5× buffer. Why claim, refund and deploy are charged below the quote is UNVERIFIED.
- **A quote can be made before the wallet signs:** re-signing each mined transaction with a throwaway key changed the quote
  by at most 0.3% (claim 0.9974 to 1.0000; tip, refund 1.0000; deploy 1.0002), six random keys each. So the UI can build
  the transaction, sign a copy with any throwaway key, and call `getL1Fee`.

## 4. What this means for the hackathon deployment (5 DOGE minimum tip, 600 s refund delay)

| Who | Action | Network fee: oracle-quote range over 3.3 h (charged at the e2e run) |
|---|---|---|
| Tipper | tip (minimum 5 DOGE) | the tip + about 0.04 to 0.28 (0.218) |
| Recipient | claim | about 0.10 to 0.76 (0.350), from their own wallet |
| Tipper | refund | about 0.04 to 0.26 (0.241) |
| You | deploy | once: the final contract was charged **0.768** at the final run (6.83 for the previous contract at the earlier run, when `l1Fee` prices were about 10× higher). `fee-check` quoted 2.29 for it, 2.98× the charge, so its quote is pessimistic for deploys. |

- At the worst quote seen, a claim (0.757) is about 15% of the 5 DOGE minimum, so the minimum still protects recipients
  from dust tips.
- **Decision needed: the recipient must already hold DOGE to claim.** The claim transaction costs a fee, and a brand-new
  wallet has none. The contract lets *anyone* submit a valid claim signature, so a relayer (our server, with a funded key)
  can submit it and pay the fee, with no contract change. Cost to us: roughly 0.1 to 0.8 DOGE per claim, so rate-limit
  per X account. The alternative (the contract deducts a fee from the payout) changes the signed message and the
  contract; I have not done it. Telling recipients to get faucet DOGE first works but is a bad first experience.

## 5. How the UI should show fees

**Ask the oracle live, show one clear "network fee" line before the wallet prompt, and keep a buffer.**

1. **Build the quote.** Populate the transaction (`to`, `data`, `value`, nonce, gas limit, fee fields, chain ID), sign a copy
   with a throwaway key, and call `getL1Fee(signedCopy)` on the oracle at `0x5300…0002`. Add `gasLimit × maxFeePerGas`
   (negligible). This is the **estimate**.
2. **Refresh** it every 10 to 15 s while the form is open, and once more right before sending. DogeOS locks the fee when the
   sequencer includes the transaction, and blocks are about 3 s, so the exposure after the last refresh is a few seconds.
3. **Display a range, not a point:** "Network fee about X DOGE, up to Y" next to the amount, where X is the estimate and Y is
   `high` from step 4. Tell users the wallet may show a much smaller number.
4. **Buffer.** Let `high = estimate × 1.5`. This covers the largest 30-second rise I saw (+33.6%) with margin.
   - Enable the Tip button only if `balance ≥ tipAmount + high`; otherwise show "You need X DOGE: the tip plus up to Y
     network fee".
   - "Max" sets the amount to `balance − high`, never the full balance.
   - Same for refund and for claim (the claimant's wallet needs `high` before Claim is enabled, unless a relayer submits it).
5. **If the oracle call fails,** fall back to fixed ceilings taken from the worst values in section 3 plus about 10%:
   **tip 0.35, claim 0.85, refund 0.30 DOGE**, and say "up to". These are generous on purpose.
6. **After sending,** show the real fee, `l1Fee + gasUsed × effectiveGasPrice`, from the raw receipt.
7. Read `minTip()` and `refundDelay()` from the contract; never hard-code 5 DOGE or 10 minutes.
8. Show wallet `insufficient funds` errors as "not enough DOGE to cover the tip and the network fee".

Whether the sequencer rejects a transaction up front when the balance cannot cover `l1Fee`, or lets it fail later, is
UNVERIFIED; the buffer avoids finding out.

## 6. Final batched run: done (2026-10-31)

`node scripts/tipescrow-e2e.cjs live …` ends with a **fee report**: for each transaction, `l1Fee`, execution fee, gas used,
and the oracle's quote for that exact signed transaction at the previous block, with the ratio. It is also saved in
`e2e-result.json` under `fees`. Its first run produced section 2b. What it settled:

1. The *pending* rows are filled, except one: `setVerifier` is **0.0215 DOGE**; the claim with the final contract is 0.0351
   (first claim) and 0.0365 (second); a tip to an account that already holds a balance was **not measured**.
2. Quote ÷ charged was ≥ 1.000 for all nine new transactions (section 3, "How accurate is the oracle?"). That supports
   treating the oracle quote as an upper bound for these shapes; the 1.5× buffer in section 5 stays.
3. Fees moved a lot between runs: `l1Fee` prices were about 10× lower a day later (section 3).
4. Still open: how MetaMask and MyDoge display a DogeOS fee, and whether the sequencer rejects a transaction up front when
   the balance cannot cover `l1Fee`.
