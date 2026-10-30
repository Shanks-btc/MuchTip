// End-to-end check of TipEscrow on a live chain, with the claim signed off-chain by ethers v6
// (the same library a Supabase Edge Function would use).
//
//   node scripts/tipescrow-e2e.cjs simulate <rpc>   eth_call with state override, no funds needed
//   node scripts/tipescrow-e2e.cjs live <rpc>       throwaway short-refund-delay deploy -> min-tip check -> tip -> claim -> refund -> verifier rotation (needs funded PRIVATE_KEY)
//
// Requires `forge build` (reads out/TipEscrow.sol/TipEscrow.json) and .env with PRIVATE_KEY, VERIFIER_PRIVATE_KEY.
// `live` writes e2e-result.json (separate from deployment.json, which belongs to the real deployment).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const [mode, rpc] = process.argv.slice(2);
if (!["simulate", "live"].includes(mode) || !rpc) {
  console.error("usage: node scripts/tipescrow-e2e.cjs <simulate|live> <rpc-url>");
  process.exit(1);
}
const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2))
);
const artifact = JSON.parse(fs.readFileSync(path.join(root, "out/TipEscrow.sol/TipEscrow.json"), "utf8"));
const iface = new ethers.Interface(artifact.abi);
const abi = ethers.AbiCoder.defaultAbiCoder();

// X numeric user ids. BigInt only: ids above 2^53 lose precision as JS Numbers. X's API returns them as strings.
const X_ID = 2244994945n; // @XDevelopers (from X's docs)
const X_ID_B = 1850123456789012345n; // 19-digit id, above 2^53
const TIP = ethers.parseEther("0.01");
const E2E_REFUND_DELAY = 45n; // seconds; throwaway instance only
const E2E_MIN_TIP = ethers.parseEther("0.01"); // throwaway instance only (hackathon deployment: 5 DOGE); equals TIP so "exactly the minimum" is exercised
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signClaim(verifier, chainId, contract, xId, recipient, nonce, expiry) {
  const domain = { name: "TipEscrow", version: "1", chainId, verifyingContract: contract };
  const types = { Claim: [
    { name: "xId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ] };
  const value = { xId, recipient, nonce, expiry };
  return { sig: await verifier.signTypedData(domain, types, value), digest: ethers.TypedDataEncoder.hash(domain, types, value) };
}

const revertName = (e) => {
  const data = e.error?.data ?? e.data ?? e.info?.error?.data;
  try { return data ? iface.parseError(data)?.name : e.revert?.name ?? e.shortMessage ?? e.message; } catch { return e.shortMessage ?? e.message; }
};

async function simulate(provider) {
  const verifier = new ethers.Wallet(env.VERIFIER_PRIVATE_KEY);
  // Constructor run via eth_call returns the runtime code with immutables (owner, refundDelay) baked in.
  // Storage written by the constructor (the verifier, slot 5) is NOT part of that code, so it is seeded below.
  const initCode = ethers.concat([artifact.bytecode.object, abi.encode(["address", "address", "uint256", "uint256"], [ethers.Wallet.createRandom().address, verifier.address, 7n * 86400n, 0n])]);
  const runtime = await provider.call({ data: initCode });
  const { chainId } = await provider.getNetwork();
  const block = await provider.getBlock("latest");

  const contract = "0x0000000000000000000000000000000000007195"; // arbitrary override address
  const recipient = ethers.Wallet.createRandom().address;
  const idKey = ethers.keccak256(abi.encode(["uint256"], [X_ID]));
  const slot = ethers.keccak256(abi.encode(["bytes32", "uint256"], [idKey, 0])); // balanceOf is storage slot 0
  const override = { [contract]: { code: runtime, balance: ethers.toQuantity(TIP), stateDiff: { [slot]: ethers.zeroPadValue(ethers.toBeHex(TIP), 32), [ethers.zeroPadValue("0x05", 32)]: ethers.zeroPadValue(verifier.address, 32) } } };
  const ethCall = (data) => provider.send("eth_call", [{ to: contract, data }, "latest", override]);

  const expiry = BigInt(block.timestamp) + 3600n;
  const { sig, digest } = await signClaim(verifier, chainId, contract, X_ID, recipient, 1n, expiry);
  const onchain = iface.decodeFunctionResult("claimDigest", await ethCall(iface.encodeFunctionData("claimDigest", [X_ID, recipient, 1n, expiry])))[0];
  console.log(`chainId            ${chainId}`);
  console.log(`ethers digest      ${digest}`);
  console.log(`contract digest    ${onchain}  match=${digest === onchain}`);
  console.log(`idHash(${X_ID}) = ${iface.decodeFunctionResult("idHash", await ethCall(iface.encodeFunctionData("idHash", [X_ID])))[0]} expected ${idKey}`);
  console.log(`claim (valid sig)    -> ${await ethCall(iface.encodeFunctionData("claim", [X_ID, recipient, 1n, expiry, sig]))} (0x = success)`);
  const bad = await signClaim(ethers.Wallet.createRandom(), chainId, contract, X_ID, recipient, 1n, expiry);
  try {
    await ethCall(iface.encodeFunctionData("claim", [X_ID, recipient, 1n, expiry, bad.sig]));
    console.log("claim (wrong signer) -> UNEXPECTED SUCCESS");
  } catch (e) {
    console.log(`claim (wrong signer) -> reverted ${revertName(e)}`);
  }
}

async function live(provider) {
  const deployer = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const verifier = new ethers.Wallet(env.VERIFIER_PRIVATE_KEY);
  const { chainId } = await provider.getNetwork();
  const balance = await provider.getBalance(deployer.address);
  console.log(`chainId ${chainId}  deployer ${deployer.address}  balance ${ethers.formatEther(balance)}`);
  if (balance === 0n) throw new Error("deployer has no DOGE - claim from https://faucet.testnet.dogeos.com first");

  const result = { chainId: Number(chainId), refundDelaySeconds: Number(E2E_REFUND_DELAY), minTipWei: E2E_MIN_TIP.toString() };
  const receipts = [];
  const step = (name, receipt, extra = "") => { result[name] = receipt.hash; receipts.push([name, receipt]); console.log(`${name.padEnd(8)} tx ${receipt.hash}  block ${receipt.blockNumber}  gas ${receipt.gasUsed} ${extra}`); };
  const events = (receipt) => receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).filter(Boolean);

  // 1. deploy
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  const escrow = await factory.deploy(deployer.address, verifier.address, E2E_REFUND_DELAY, E2E_MIN_TIP);
  const addr = await escrow.getAddress();
  step("deploy", await escrow.deploymentTransaction().wait(), `contract ${addr}`);
  result.contract = addr;

  // 2. below-minimum tip must revert; exactly the minimum works; then claim
  const hashA = await escrow.idHash(X_ID);
  try { await escrow.tip.staticCall(hashA, { value: E2E_MIN_TIP - 1n }); console.log("below-min tip UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`below-min tip (min - 1 wei) reverted ${revertName(e)}`); }
  const tipA = await (await escrow.tip(hashA, { value: TIP })).wait();
  step("tipA", tipA, `balanceOf=${ethers.formatEther(await escrow.balanceOf(hashA))}`);
  const recipient = ethers.Wallet.createRandom().address;
  const expiry = BigInt((await provider.getBlock("latest")).timestamp) + 3600n;
  const { sig } = await signClaim(verifier, chainId, addr, X_ID, recipient, 1n, expiry);
  const claim = await (await escrow.claim(X_ID, recipient, 1n, expiry, sig)).wait();
  step("claim", claim, `recipient ${recipient} received ${ethers.formatEther(await provider.getBalance(recipient))}`);
  try { await escrow.claim.staticCall(X_ID, recipient, 1n, expiry, sig); console.log("replay   UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`replay   reverted ${revertName(e)}`); }

  // 3. tip then refund
  const hashB = await escrow.idHash(X_ID_B);
  const tipB = await (await escrow.tip(hashB, { value: TIP })).wait();
  const tipBId = events(tipB).find((e) => e.name === "Tipped").args.tipId;
  step("tipB", tipB, `tipId ${tipBId}`);
  try { await escrow.refund.staticCall(tipBId); console.log("early refund UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`early refund reverted ${revertName(e)}`); }
  const readyAt = Number(await escrow.refundableAt(tipBId));
  for (;;) {
    const now = (await provider.getBlock("latest")).timestamp;
    if (now >= readyAt) break;
    console.log(`  waiting for chain time ${now} -> ${readyAt} (${readyAt - now}s)`);
    await sleep(Math.min((readyAt - now) * 1000 + 1500, 15000));
  }
  const before = await provider.getBalance(deployer.address);
  const refund = await (await escrow.refund(tipBId)).wait();
  step("refund", refund, `status=${await escrow.tipStatus(tipBId)} (3=Refunded) escrow balance=${ethers.formatEther(await provider.getBalance(addr))}`);
  // claim-after-refund must fail: the refunded money is no longer claimable
  const exp2 = BigInt((await provider.getBlock("latest")).timestamp) + 3600n;
  const late = await signClaim(verifier, chainId, addr, X_ID_B, recipient, 1n, exp2);
  try { await escrow.claim.staticCall(X_ID_B, recipient, 1n, exp2, late.sig); console.log("claim-after-refund UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`claim-after-refund reverted ${revertName(e)}`); }
  // refund-after-claim must fail: tip A was already paid out
  try { await escrow.refund.staticCall(1n); console.log("refund-after-claim UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`refund-after-claim reverted ${revertName(e)}`); }
  // verifier rotation: owner swaps the key; an old-key signature must stop working, a new-key one must work
  const tipC = await (await escrow.tip(await escrow.idHash(X_ID), { value: TIP })).wait();
  step("tipC", tipC, `balanceOf=${ethers.formatEther(await escrow.balanceOf(await escrow.idHash(X_ID)))}`);
  const newVerifier = ethers.Wallet.createRandom();
  try { await escrow.connect(newVerifier.connect(provider)).setVerifier.staticCall(newVerifier.address); console.log("non-owner setVerifier UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`non-owner setVerifier reverted ${revertName(e)}`); }
  const exp3 = BigInt((await provider.getBlock("latest")).timestamp) + 3600n;
  const oldSigC = await signClaim(verifier, chainId, addr, X_ID, recipient, 2n, exp3);
  step("rotate", await (await escrow.setVerifier(newVerifier.address)).wait(), `verifier now ${await escrow.verifier()}`);
  try { await escrow.claim.staticCall(X_ID, recipient, 2n, exp3, oldSigC.sig); console.log("old-key claim UNEXPECTED SUCCESS"); }
  catch (e) { console.log(`old-key claim after rotation reverted ${revertName(e)}`); }
  const newSigC = await signClaim(newVerifier, chainId, addr, X_ID, recipient, 2n, exp3);
  const claimC = await (await escrow.claim(X_ID, recipient, 2n, exp3, newSigC.sig)).wait();
  step("claimC", claimC, `recipient now ${ethers.formatEther(await provider.getBalance(recipient))}`);
  result.refundNetToTipper = ethers.formatEther((await provider.getBalance(deployer.address)) - before);

  for (const r of [tipA, claim, tipB, refund, tipC, claimC]) for (const ev of events(r)) console.log(`event    ${ev.name}(${ev.args.map(String).join(", ")})`);
  // Fee report (see FEES.md): what each tx really paid, and what DogeOS's own fee oracle quoted for the exact signed tx
  // at the previous block. Informational only; failures here never fail the run.
  const ORACLE = "0x5300000000000000000000000000000000000002";
  const oracleIface = new ethers.Interface(["function getL1Fee(bytes) view returns (uint256)"]);
  console.log("--- fee report (fee = l1Fee + gasUsed x effectiveGasPrice)");
  result.fees = {};
  for (const [name, rc] of receipts) {
    try {
      const rawRc = await provider.send("eth_getTransactionReceipt", [rc.hash]);
      const l1Fee = BigInt(rawRc.l1Fee ?? 0), exec = BigInt(rawRc.gasUsed) * BigInt(rawRc.effectiveGasPrice);
      let quote = "n/a";
      try {
        const tx = await provider.getTransaction(rc.hash);
        const q = oracleIface.decodeFunctionResult("getL1Fee", await provider.call({ to: ORACLE, data: oracleIface.encodeFunctionData("getL1Fee", [ethers.Transaction.from(tx).serialized]), blockTag: rc.blockNumber - 1 }))[0];
        quote = `${ethers.formatEther(q)} (${l1Fee === 0n ? "n/a" : (Number(q) / Number(l1Fee)).toFixed(3) + "x of charged"})`;
        result.fees[name] = { oracleQuote: q.toString() };
      } catch {}
      result.fees[name] = { ...(result.fees[name] || {}), l1Fee: l1Fee.toString(), execFee: exec.toString(), totalFee: (l1Fee + exec).toString(), gasUsed: String(rawRc.gasUsed) };
      console.log(`fee      ${name.padEnd(8)} l1Fee ${ethers.formatEther(l1Fee)} + exec ${ethers.formatEther(exec)} = ${ethers.formatEther(l1Fee + exec)} DOGE | oracle getL1Fee@block-1: ${quote}`);
    } catch (e) { console.log(`fee      ${name.padEnd(8)} report unavailable: ${e.shortMessage || e.message}`); }
  }
  fs.writeFileSync(path.join(root, "e2e-result.json"), JSON.stringify(result, null, 2));
  console.log("wrote e2e-result.json");
}

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc);
  await (mode === "simulate" ? simulate(provider) : live(provider));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
