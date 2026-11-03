import { Link } from "react-router-dom";
import { SiteHeader } from "../components/landing/SiteHeader";
import { pageTitle, useTitle } from "../lib/title";

export default function NotFound() {
  useTitle(pageTitle("Page not found"));
  return (
    <div className="flex min-h-screen flex-col bg-paper font-sans text-ink antialiased">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[520px] flex-1 px-4 py-16 text-center">
        <p className="mt-eyebrow m-0 text-gold-ink">404</p>
        <h1 className="m-0 mt-3 text-[32px]">Much empty. No page here.</h1>
        <p className="m-0 mt-3 text-[15px] text-ink-3">The link may be mistyped. Tip links look like /@handle.</p>
        <Link to="/" className="mt-btn mt-btn-text mt-6 inline-flex h-[52px] items-center rounded-full bg-ink px-7 text-white no-underline">Back to MuchTip</Link>
      </main>
    </div>
  );
}
