// Deploys TipEscrow to DogeOS Chikyū testnet and records it in deployment.json.
//
//   node scripts/deploy.cjs [rpc-url]
//
// Reads .env: PRIVATE_KEY (funded deployer), VERIFIER_ADDRESS (public address of the key the Edge Function signs with),
// optional OWNER_ADDRESS (who may rotate the verifier; default = the deployer),
// optional REFUND_DELAY_SECONDS (default 604800 = 7 days; the hackathon deployment sets 600 in .env),
// optional MIN_TIP_WEI (smallest accepted tip in wei; default 0 = no minimum; the hackathon deployment sets 5 DOGE = 5000000000000000000 in .env).
// Needs `forge build` first (reads out/).
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const CHIKYU_CHAIN_ID = 6281971n;
const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((l) => /^\w+=/.test(l)).map((l) => l.split(/=(.*)/s).slice(0, 2))
);
const rpc = process.argv[2] || env.RPC_URL || "https://rpc.testnet.dogeos.com/";
const DEFAULT_REFUND_DELAY = 7 * 24 * 3600;
const refundDelay = BigInt(env.REFUND_DELAY_SECONDS || DEFAULT_REFUND_DELAY);
if (env.MIN_TIP_DOGE !== undefined) throw new Error("MIN_TIP_DOGE is no longer read: set MIN_TIP_WEI (wei; 5 DOGE = 5000000000000000000)");
const minTip = BigInt(env.MIN_TIP_WEI || "0");
const artifact = JSON.parse(fs.readFileSync(path.join(root, "out/TipEscrow.sol/TipEscrow.json"), "utf8"));

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc);
  const { chainId } = await provider.getNetwork();
  if (chainId !== CHIKYU_CHAIN_ID) throw new Error(`refusing to deploy: chainId ${chainId}, expected ${CHIKYU_CHAIN_ID}`);
  if (!ethers.isAddress(env.VERIFIER_ADDRESS)) throw new Error("VERIFIER_ADDRESS missing/invalid in .env");
  const verifierAddr = ethers.getAddress(env.VERIFIER_ADDRESS);

  const deployer = new ethers.Wallet(env.PRIVATE_KEY, provider);
  const owner = ethers.getAddress(env.OWNER_ADDRESS || deployer.address); // throws if invalid
  console.log(`minTip ${ethers.formatEther(minTip)} DOGE${minTip === 0n ? " (no minimum)" : ""}`);
  console.log(`refundDelay ${refundDelay}s${refundDelay === BigInt(DEFAULT_REFUND_DELAY) ? " (code default, 7 days)" : " (NOT the 7-day default; hackathon setting)"}`);
  const balance = await provider.getBalance(deployer.address);
  console.log(`deployer ${deployer.address}  balance ${ethers.formatEther(balance)} DOGE`);
  if (balance === 0n) throw new Error("deployer has no DOGE - claim from https://faucet.testnet.dogeos.com first");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  const escrow = await factory.deploy(owner, verifierAddr, refundDelay, minTip);
  const receipt = await escrow.deploymentTransaction().wait();
  const address = await escrow.getAddress();
  console.log(`deployed TipEscrow ${address}`);
  console.log(`  tx    ${receipt.hash}  block ${receipt.blockNumber}  gasUsed ${receipt.gasUsed}`);
  const [gotOwner, gotVerifier, gotDelay, gotMin] = await Promise.all([escrow.owner(), escrow.verifier(), escrow.refundDelay(), escrow.minTip()]);
  console.log(`  owner ${gotOwner}  verifier ${gotVerifier}  refundDelay ${gotDelay}s  minTip ${ethers.formatEther(gotMin)} DOGE`);
  if (gotOwner !== owner || gotVerifier !== verifierAddr || gotDelay !== refundDelay || gotMin !== minTip) throw new Error("deployed contract does not match requested parameters");
  console.log(`  explorer https://blockscout.testnet.dogeos.com/address/${address}`);

  fs.writeFileSync(
    path.join(root, "deployment.json"),
    JSON.stringify({ chainId: Number(chainId), contract: address, owner, verifier: verifierAddr, refundDelaySeconds: Number(refundDelay), minTipWei: minTip.toString(), deployTx: receipt.hash, deployBlock: receipt.blockNumber }, null, 2)
  );
})().catch((e) => { console.error(e.message || e); process.exit(1); });
