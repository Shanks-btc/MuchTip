import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { authConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "./api";

// Sign in with X through Supabase Auth (provider "x", as in spike/supabase/test.cjs). Only the public anon key is used here;
// sign-claim verifies the session server-side and reads the X id from the identity, never from user-editable metadata.
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!authConfigured) return null;
  client ??= createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, { auth: { persistSession: true, detectSessionInUrl: true } });
  return client;
}

export interface XAccount {
  xId: string;
  handle: string | null;
  name: string | null;
}

/** The X account behind a session, mirroring the backend's claim gate: exactly one identity, provider "x". */
export function xAccountOf(session: Session | null): XAccount | null {
  const ids = session?.user.identities ?? [];
  if (ids.length !== 1 || ids[0].provider !== "x") return null;
  const d = (ids[0].identity_data ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { xId: ids[0].id, handle: str(d.user_name) ?? str(d.preferred_username), name: str(d.full_name) ?? str(d.name) };
}

export function useXSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!authConfigured);
  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const account = xAccountOf(session);
  return {
    ready,
    session,
    account,
    /** Signed in, but not with exactly one X identity: the backend would refuse to sign a claim. */
    unsupportedIdentity: Boolean(session && !account),
    signIn: () => supabase()?.auth.signInWithOAuth({ provider: "x", options: { redirectTo: `${window.location.origin}/app/claim` } }),
    signOut: () => supabase()?.auth.signOut(),
  };
}
