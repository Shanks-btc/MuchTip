import { ethers } from "./eth.ts";

/** Must match TipEscrow.CLAIM_TYPEHASH: Claim(uint256 xId,address recipient,uint256 nonce,uint256 expiry). */
export const CLAIM_TYPES = {
  Claim: [
    { name: "xId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

export interface ClaimMessage {
  xId: bigint;
  recipient: string;
  nonce: bigint;
  expiry: bigint;
}

/** Must match TipEscrow's domain: name "TipEscrow", version "1", the live chainId and the contract's own address. */
export function claimDomain(chainId: bigint, escrow: string) {
  return { name: "TipEscrow", version: "1", chainId, verifyingContract: escrow };
}

export function claimDigest(chainId: bigint, escrow: string, msg: ClaimMessage): string {
  return ethers.TypedDataEncoder.hash(claimDomain(chainId, escrow), CLAIM_TYPES, msg);
}

export type ClaimSigner = Pick<ethers.Wallet, "address" | "signTypedData">;

// secp256k1n / 2: the contract rejects signatures with a higher s (EIP-2 malleability)
const HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

/** Signs the claim and checks the result before returning it: recovers to the signer, 65 bytes, low-s. */
export async function signClaim(
  signer: ClaimSigner,
  chainId: bigint,
  escrow: string,
  msg: ClaimMessage,
): Promise<{ signature: string; digest: string }> {
  const signature = await signer.signTypedData(claimDomain(chainId, escrow), CLAIM_TYPES, msg);
  const digest = claimDigest(chainId, escrow, msg);
  if (ethers.dataLength(signature) !== 65) throw new Error("signature is not 65 bytes");
  if (BigInt(ethers.Signature.from(signature).s) > HALF_N) throw new Error("signature has a high s value");
  if (ethers.recoverAddress(digest, signature) !== signer.address) throw new Error("signature does not recover to the signer");
  return { signature, digest };
}
