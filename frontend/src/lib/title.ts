import { useEffect } from "react";

export const SITE_TITLE = "MuchTip · Trustless DOGE tips";
/** "Send a tip" -> "Send a tip · MuchTip". The separator is a middle dot everywhere. */
export const pageTitle = (page: string) => `${page} · MuchTip`;

/** Sets the tab title and keeps og:title / twitter:title in step (index.html carries the same defaults for crawlers). */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", title);
  }, [title]);
}
