import { ethers } from "./eth.ts";

/** The parts of TipEscrow the backend touches (see src/TipEscrow.sol). */
export const escrowAbi = [
  "function balanceOf(bytes32 idHash) view returns (uint256)",
  "function verifier() view returns (address)",
  "function owner() view returns (address)",
  "function refundDelay() view returns (uint256)",
  "function minTip() view returns (uint256)",
  "function tipCount() view returns (uint256)",
  "function claimDigest(uint256 xId, address recipient, uint256 nonce, uint256 expiry) view returns (bytes32)",
  "event Tipped(uint256 indexed tipId, bytes32 indexed idHash, address indexed from, uint256 amount)",
  "event Claimed(bytes32 indexed idHash, address indexed recipient, uint256 amount, uint256 nonce, uint256 xId)",
  "event Refunded(uint256 indexed tipId, bytes32 indexed idHash, address indexed tipper, uint256 amount)",
  "event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier)",
] as const;

export const escrowIface = new ethers.Interface(escrowAbi);

/** topic0 of the three events the feed stores. */
export const FEED_TOPICS = ["Tipped", "Claimed", "Refunded"].map((n) => escrowIface.getEvent(n)!.topicHash);
