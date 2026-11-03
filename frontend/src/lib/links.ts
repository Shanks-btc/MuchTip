import { ENV } from "../env";

/** The site's public origin for shareable links (VITE_APP_ORIGIN, else the page's own origin). */
export function publicOrigin(): { origin: string; host: string } {
  const origin = (ENV.appOrigin ?? window.location.origin).replace(/\/$/, "");
  return { origin, host: origin.replace(/^https?:\/\//, "") };
}

/** A tip link for an X handle (wiring-spec W3.5): <origin>/app?to=<handle> opens Send with the handle filled in. */
export const tipLink = (handle: string) => `${publicOrigin().origin}/app?to=${encodeURIComponent(handle)}`;
/** The same link as shown on screen, without the scheme. */
export const tipLinkText = (handle: string) => `${publicOrigin().host}/app?to=${handle}`;

/** Where a tipped account goes to collect: the app's Claim tab. */
export const claimLink = () => `${publicOrigin().origin}/app/claim`;

/**
 * X's web intent, prefilled (opens X in a new tab; nothing is posted without the user). X's documentation lists only
 * /intent/tweet (docs.x.com, "Post button / Web intent"); /intent/post also redirects to login when signed out but
 * isn't documented, so the documented one is used (checked 2026-11-02).
 */
export const xIntent = (text: string) => `https://x.com/intent/tweet?${new URLSearchParams({ text })}`;
