import { ethers } from "./eth.ts";
import { escrowIface, FEED_TOPICS } from "./abi.ts";
import type { ChainConfig } from "./env.ts";

export class ChainError extends Error {}

export interface ClaimContext {
  chainId: bigint;
  /** Timestamp of the latest block: the contract compares `expiry` with block.timestamp. */
  chainTime: bigint;
  /** What the contract currently holds for this X account (`balanceOf(idHash)`). */
  unclaimed: bigint;
  /** `verifier()` on the contract. */
  verifier: string;
}

export interface ChainSettings {
  refundDelay: bigint;
  minTip: bigint;
  verifier: string;
  owner: string;
}

export interface RawLog {
  blockNumber: string;
  logIndex: string;
  transactionHash: string;
  topics: string[];
  data: string;
  address: string;
  removed?: boolean;
}

/** Read-only view of the escrow contract over JSON-RPC. */
export interface Chain {
  readonly escrow: string;
  readonly chainId: bigint;
  claimContext(idHash: string): Promise<ClaimContext>;
  settings(): Promise<ChainSettings>;
  headBlock(): Promise<number>;
  getLogs(from: number, to: number): Promise<RawLog[]>;
  blockTimes(blocks: number[]): Promise<Map<number, number>>;
  /** The contract's native balance at `atBlock` (default: latest). */
  balanceWei(atBlock?: number): Promise<bigint>;
}

type RpcCall = { method: string; params: unknown[] };

export function createChain(cfg: ChainConfig, fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Chain {
  const escrow = cfg.escrow;
  let nextId = 1;

  async function post(body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(cfg.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ChainError(`RPC request failed: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) throw new ChainError(`RPC HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ChainError("RPC returned invalid JSON");
    }
  }

  /** One JSON-RPC batch; results come back in call order, any per-call error throws. */
  async function batch(calls: RpcCall[]): Promise<unknown[]> {
    const ids = calls.map(() => nextId++);
    const out = await post(calls.map((c, i) => ({ jsonrpc: "2.0", id: ids[i], method: c.method, params: c.params })));
    if (!Array.isArray(out)) throw new ChainError("RPC did not answer the batch with an array");
    const byId = new Map<number, { result?: unknown; error?: { message?: string } }>(out.map((r) => [r.id, r]));
    return ids.map((id, i) => {
      const r = byId.get(id);
      if (!r) throw new ChainError(`RPC batch is missing the answer to ${calls[i].method}`);
      if (r.error) throw new ChainError(`RPC ${calls[i].method}: ${r.error.message ?? "error"}`);
      return r.result;
    });
  }

  async function single(method: string, params: unknown[]): Promise<unknown> {
    const out = (await post({ jsonrpc: "2.0", id: nextId++, method, params })) as { result?: unknown; error?: { message?: string } };
    if (out?.error) throw new ChainError(`RPC ${method}: ${out.error.message ?? "error"}`);
    return out?.result;
  }

  const ethCall = (fn: string, args: unknown[] = []): RpcCall => ({
    method: "eth_call",
    params: [{ to: escrow, data: escrowIface.encodeFunctionData(fn, args) }, "latest"],
  });
  // Undecodable data (e.g. "0x" from an address with no contract) is a chain problem like any other, so callers that
  // degrade on ChainError keep working instead of failing with an unexpected error.
  const decode = (fn: string, raw: unknown) => {
    try {
      return escrowIface.decodeFunctionResult(fn, String(raw));
    } catch {
      throw new ChainError(`unexpected result for ${fn}() from the RPC`);
    }
  };

  return {
    escrow,
    chainId: cfg.chainId,

    async claimContext(idHash) {
      const [cid, block, bal, ver] = await batch([
        { method: "eth_chainId", params: [] },
        { method: "eth_getBlockByNumber", params: ["latest", false] },
        ethCall("balanceOf", [idHash]),
        ethCall("verifier"),
      ]);
      const ts = (block as { timestamp?: string } | null)?.timestamp;
      if (!ts) throw new ChainError("RPC returned no latest block");
      return {
        chainId: BigInt(String(cid)),
        chainTime: BigInt(ts),
        unclaimed: decode("balanceOf", bal)[0] as bigint,
        verifier: ethers.getAddress(decode("verifier", ver)[0] as string),
      };
    },

    async settings() {
      const [rd, mt, ver, own] = await batch([ethCall("refundDelay"), ethCall("minTip"), ethCall("verifier"), ethCall("owner")]);
      return {
        refundDelay: decode("refundDelay", rd)[0] as bigint,
        minTip: decode("minTip", mt)[0] as bigint,
        verifier: ethers.getAddress(decode("verifier", ver)[0] as string),
        owner: ethers.getAddress(decode("owner", own)[0] as string),
      };
    },

    async headBlock() {
      return Number(BigInt(String(await single("eth_blockNumber", []))));
    },

    async getLogs(from, to) {
      const logs = await single("eth_getLogs", [{
        address: escrow,
        fromBlock: ethers.toQuantity(from),
        toBlock: ethers.toQuantity(to),
        topics: [FEED_TOPICS],
      }]);
      if (!Array.isArray(logs)) throw new ChainError("eth_getLogs did not return an array");
      return logs as RawLog[];
    },

    async blockTimes(blocks) {
      const times = new Map<number, number>();
      const unique = [...new Set(blocks)];
      for (let i = 0; i < unique.length; i += 50) {
        const part = unique.slice(i, i + 50);
        const res = await batch(part.map((n) => ({ method: "eth_getBlockByNumber", params: [ethers.toQuantity(n), false] })));
        res.forEach((b, j) => {
          const ts = (b as { timestamp?: string } | null)?.timestamp;
          if (!ts) throw new ChainError(`RPC returned no block ${part[j]}`);
          times.set(part[j], Number(BigInt(ts)));
        });
      }
      return times;
    },

    async balanceWei(atBlock) {
      return BigInt(String(await single("eth_getBalance", [escrow, atBlock === undefined ? "latest" : ethers.toQuantity(atBlock)])));
    },
  };
}
