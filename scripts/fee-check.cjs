// Read-only pre-flight for the batched run: what do DogeOS's fee oracle and the node say the two deployments will cost
// right now, and does the deployer's balance cover them with a buffer? Sends nothing.
//
//   node scripts/fee-check.cjs [rpc-url]
//
// Method (see FEES.md): build the deploy transaction, sign a copy with a throwaway key (a dummy-signed copy quotes within
// 0.3% of the real one), and ask the oracle at 0x5300…0002 for getL1Fee. Fees move several-fold within hours, so run this
// right before deploying.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2))
);
const artifact = JSON.parse(fs.readFileSync(path.join(root, "out/TipEscrow.sol/TipEscrow.json"), "utf8"));
const rpc = process.argv[2] || env.RPC_URL || "https://rpc.testnet.dogeos.com/";
const ORACLE = "0x5300000000000000000000000000000000000002";
const oracleIface = new ethers.Interface(["function getL1Fee(bytes) view returns (uint256)", "function l1BaseFee() view returns (uint256)"]);
const abi = ethers.AbiCoder.defaultAbiCoder();
const doge = (v) => Number(ethers.formatEther(v)).toFixed(4);

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc);
  const { chainId } = await provider.getNetwork();
  if (chainId !== 6281971n) throw new Error(`chainId ${chainId}, expected 6281971 (Chikyū)`);
  const deployer = new ethers.Wallet(env.PRIVATE_KEY).address;
  const verifier = ethers.getAddress(env.VERIFIER_ADDRESS);
  const refundDelay = BigInt(env.REFUND_DELAY_SECONDS || 7 * 24 * 3600);
  if (env.MIN_TIP_DOGE !== undefined) throw new Error("MIN_TIP_DOGE is no longer read: set MIN_TIP_WEI (wei; 5 DOGE = 5000000000000000000)");
  const minTip = BigInt(env.MIN_TIP_WEI || "0");

  const fee = await provider.getFeeData();
  const maxFeePerGas = fee.maxFeePerGas ?? fee.gasPrice;
  const nonce = await provider.getTransactionCount(deployer);

  async function quoteDeploy(args) {
    const data = ethers.concat([artifact.bytecode.object, abi.encode(["address", "address", "uint256", "uint256"], args)]);
    const gasLimit = await provider.estimateGas({ from: deployer, data });
    const raw = await ethers.Wallet.createRandom().signTransaction({ type: 2, chainId, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n, data, value: 0n });
    const l1 = oracleIface.decodeFunctionResult("getL1Fee", await provider.call({ to: ORACLE, data: oracleIface.encodeFunctionData("getL1Fee", [raw]) }))[0];
    return { l1, exec: gasLimit * maxFeePerGas, gasLimit };
  }

  const real = await quoteDeploy([deployer, verifier, refundDelay, minTip]);
  const e2e = await quoteDeploy([deployer, verifier, 45n, ethers.parseEther("0.01")]);
  const balance = await provider.getBalance(deployer);
  const l1Base = oracleIface.decodeFunctionResult("l1BaseFee", await provider.call({ to: ORACLE, data: oracleIface.encodeFunctionData("l1BaseFee") }))[0];

  const OTHER_TXS = ethers.parseEther("3"); // e2e's tip/claim/refund/rotate transactions at the e2e-run prices, rounded up
  const quoted = real.l1 + real.exec + e2e.l1 + e2e.exec;
  const needed = (quoted * 3n) / 2n + OTHER_TXS; // x1.5 on the deployments (FEES.md buffer), plus the other transactions

  console.log(`oracle l1BaseFee now      ${l1Base}  (e2e run saw 3.6e13 to 4.8e13; 3.3 h window ranged 6.2e12 to 4.6e13)`);
  console.log(`real deploy (600 s, 5 DOGE) quote ${doge(real.l1 + real.exec)} DOGE   (l1 ${doge(real.l1)} + gas ${doge(real.exec)}; charged 6.8289 at the e2e run)`);
  console.log(`e2e throwaway deploy        quote ${doge(e2e.l1 + e2e.exec)} DOGE`);
  console.log(`other e2e transactions      allow ${doge(OTHER_TXS)} DOGE`);
  console.log(`deployer ${deployer}  balance ${doge(balance)} DOGE`);
  console.log(`needed with x1.5 buffer on the deployments: ${doge(needed)} DOGE  ->  ${balance >= needed ? "OK to run" : `TOP UP by about ${doge(needed - balance)} DOGE, or wait for a cheaper moment`}`);
  console.log("Note: at the e2e run the oracle quoted 2.76x what the previous deploy was actually charged (1.0x for a tip), so deploy quotes are probably pessimistic.");
  console.log(`Likely cost if that ratio holds: about ${doge(((real.l1 + real.exec + e2e.l1 + e2e.exec) * 100n) / 276n + OTHER_TXS)} DOGE in total (one sample, not a guarantee).`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
