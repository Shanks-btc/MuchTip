import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiErrorMessage, backendConfigured, demoMode, fetchFeed, HANDLE_RE, normalizeHandle, resolveHandle } from "./api";
import { handleFor } from "../lib/handleBook";
import { shortHash } from "../lib/format";
import { demoFeed } from "./samples";
import type { EventType, FeedResponse, ResolvedHandle } from "./types";

export type FeedFilter = "All" | EventType;
export type FeedState =
  | { kind: "loading" }
  | { kind: "error"; lastSync: number | null; retry: () => void; data: FeedResponse | null }
  | { kind: "ready"; data: FeedResponse; source: "live" | "demo"; /** the index is behind the chain (sync.complete false) */ syncing: boolean };

/** Wiring-spec W4.2: poll every 5 s; react-query pauses the interval while the tab is hidden. */
export const FEED_POLL_MS = 5_000;

/**
 * The activity feed (W4.2): feed?limit=&type= every 5 s while the tab is visible. States: loading (F2), ready (F1, or
 * F3 when there are no events), error (F4), which keeps the last good rows in `data` with the time of the last
 * successful update. In development without a backend the labelled demo rows stand in; production builds never show
 * them, so there the feed is simply unreachable until the backend is configured.
 */
export function useFeed(filter: FeedFilter, limit = 25): FeedState {
  const q = useQuery({
    queryKey: ["feed", filter, limit],
    queryFn: ({ signal }) => fetchFeed({ limit, type: filter === "All" ? undefined : filter, signal }),
    enabled: backendConfigured,
    refetchInterval: FEED_POLL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  if (demoMode) {
    const events = filter === "All" ? demoFeed.events : demoFeed.events.filter((e) => e.type === filter);
    return { kind: "ready", data: { ...demoFeed, events: events.slice(0, limit) }, source: "demo", syncing: false };
  }
  if (!backendConfigured) return { kind: "error", lastSync: null, retry: () => undefined, data: null };
  if (q.isError) return { kind: "error", lastSync: q.dataUpdatedAt || null, retry: () => void q.refetch(), data: q.data ?? null };
  if (q.data) return { kind: "ready", data: q.data, source: "live", syncing: !q.data.sync.complete };
  return { kind: "loading" };
}

/**
 * "@handle" for an idHash: remembered in this browser when the user tipped it, else from feed() events, else a short
 * hash (the chain stores X ids, not handles).
 */
export function useHandleNames() {
  const feed = useFeed("All", 25);
  const events = feed.kind === "ready" ? feed.data.events : feed.kind === "error" ? feed.data?.events ?? [] : [];
  const fromFeed = new Map(events.filter((e) => e.handle).map((e) => [e.idHash.toLowerCase(), e.handle as string]));
  return (idHash: string) => {
    const h = handleFor(idHash) ?? fromFeed.get(idHash.toLowerCase());
    return h ? `@${h}` : shortHash(idHash); // W4.1: the short idHash when the handle is unknown
  };
}

export type LookupState =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "checking"; handle: string }
  | { kind: "found"; who: ResolvedHandle }
  | { kind: "missing"; handle: string }
  | { kind: "error"; handle: string; message: string };

/** Debounced display lookup for the send card (cached resolve). The tip flow re-resolves with `fresh` before signing. */
export function useHandleLookup(input: string, delayMs = 400): LookupState {
  const handle = normalizeHandle(input);
  const [debounced, setDebounced] = useState(handle);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(handle), delayMs);
    return () => clearTimeout(t);
  }, [handle, delayMs]);
  const valid = HANDLE_RE.test(debounced);
  const q = useQuery({
    queryKey: ["resolve", debounced.toLowerCase()],
    queryFn: ({ signal }) => resolveHandle(debounced, { signal }),
    enabled: valid,
    staleTime: 60_000,
    retry: false,
  });
  if (!handle) return { kind: "idle" };
  if (!HANDLE_RE.test(handle)) return { kind: "invalid" };
  if (debounced !== handle || q.isFetching || q.isPending) return { kind: "checking", handle };
  if (q.isError) return { kind: "error", handle, message: apiErrorMessage(q.error, { handle }) };
  return q.data ? { kind: "found", who: q.data } : { kind: "missing", handle };
}

/** The tip flow's lookup: always fresh from X, never the cache (docs/backend.md, "Why the tip flow must use fresh"). */
export function useFreshResolve(handle: string | null) {
  return useQuery({
    queryKey: ["resolve-fresh", handle?.toLowerCase() ?? null],
    queryFn: ({ signal }) => resolveHandle(handle as string, { fresh: true, signal }),
    enabled: Boolean(handle && HANDLE_RE.test(handle)),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
