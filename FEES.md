# FEES.md: what a transaction costs on Chikyū, and how the UI should show it

Source data: the live e2e run of the previous contract revision on the DogeOS Chikyū testnet (chain ID 6281971).
Hashes are in `e2e-result.testnet-v1.json` (blocks 9039602 to 9039628), plus read-only measurements of DogeOS's fee oracle
taken afterwards. Everything below is VERIFIED unless marked UNVERIFIED. Rows marked *pending* get measured in the final
batched run, which now prints a fee report (section 6).

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
| `setVerifier` | | | | | *pending* |
| Tip to an account that already holds a balance | | | | | *pending* |
| Claim with the final contract | | | | | *pending* |

- The **execution part is negligible** (at most 0.00003 DOGE); the fee is essentially all `l1Fee`.
- **A wallet that shows only gas will under-quote by a factor of about 100,000.** How MetaMask and MyDoge actually display a
  DogeOS fee is UNVERIFIED; plan for them to show the tiny number.
- The two tips paid the same `l1Fee` to the wei, so a given transaction shape costs the same while the network inputs
  do not change.

## 3. These fees are NOT stable (this changes the UI design)

DogeOS has a pre-deployed fee oracle at `0x5300000000000000000000000000000000000002` (a Scroll `L1GasPriceOracle`; the docs
tell you to use its `getL1Fee(signed RLP transaction)` to estimate). I read it at historical blocks.

| Window | What I measured |
|---|---|
| 3.3 hours (41 samples, 100 blocks apart) | `l1BaseFee` ranged 6.2e12 to 4.6e13, a **7.4× swing**. The oracle's quote for the *same* tip transaction ranged **0.038 to 0.278 DOGE** (median 0.117); claim **0.102 to 0.757** (median 0.318); refund **0.036 to 0.263** (median 0.111). |
| 1 hour (121 samples, 10 blocks / ~30 s apart) | The tip quote ranged 0.101 to 0.292 (2.9×). Change between consecutive readings: median 0%, 90th percentile +0.6%, **largest rise +33.6%**, largest fall −11%. Only 54 of 120 readings differed from the previous one. |
| At the e2e run | `l1BaseFee` was about 3.6e13 to 4.8e13, in the upper part of the 3.3-hour range. The tip (0.218) and refund (0.241) were charged near that window's maximum; the claim (0.350) near its middle. |

So the numbers in section 2 are one snapshot. **Fees on this testnet can be roughly 2 to 5 times lower or higher an hour
later.** A hard-coded range would be wrong. (UNVERIFIED how long this behaviour lasts or whether mainnet behaves the same.)

### How accurate is the oracle?

| Action | Oracle quote for the exact signed tx at the block before inclusion ÷ `l1Fee` actually charged |
|---|---|
| Tip | **1.0000** (exact; the quote was identical for blocks 9039597 to 9039606) |
| Claim | 1.696 |
| Refund | 1.145 |
| Deploy | 2.756 |

- The oracle matched the tip to the wei and **quoted more than was charged** for the other three. With four samples, "the
  oracle is an upper bound" is a hypothesis, not a finding. Why claim, refund and deploy differ is UNVERIFIED. The
  final run records quote vs charge for every transaction (section 6).
- **A quote can be made before the wallet signs:** re-signing each mined transaction with a throwaway key changed the quote
  by at most 0.3% (claim 0.9974 to 1.0000; tip, refund 1.0000; deploy 1.0002), six random keys each. So the UI can build
  the transaction, sign a copy with any throwaway key, and call `getL1Fee`.

## 4. What this means for the hackathon deployment (5 DOGE minimum tip, 600 s refund delay)

| Who | Action | Network fee: oracle-quote range over 3.3 h (charged at the e2e run) |
|---|---|---|
| Tipper | tip (minimum 5 DOGE) | the tip + about 0.04 to 0.28 (0.218) |
| Recipient | claim | about 0.10 to 0.76 (0.350), from their own wallet |
| Tipper | refund | about 0.04 to 0.26 (0.241) |
| You | deploy | once: 6.83 charged for the previous contract at the e2e run. The oracle's quote for the final contract's deploy is about 11 now (it quoted 2.76× what the previous deploy was actually charged, so that is probably pessimistic). Run `node scripts/fee-check.cjs` before deploying. |

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

## 6. Final batched run: what it will add

`node scripts/tipescrow-e2e.cjs live …` now ends with a **fee report**: for each transaction, `l1Fee`, execution fee, gas
used, and the oracle's quote for that exact signed transaction at the previous block, with the ratio. It is also saved in
`e2e-result.json` under `fees`. After that run:

1. Fill the *pending* rows in section 2 (`setVerifier`, a tip to an account with a balance, the final claim).
2. Check the quote ÷ charged ratio for every new transaction. If the quote is never below the charge, section 5 can say
   the estimate is an upper bound; if it is, widen the buffer.
3. Re-read the oracle's `l1BaseFee` and note whether fees are still moving as much.
