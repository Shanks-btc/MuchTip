import { useState } from "react";
import { Link } from "react-router-dom";
import { SOURCE_URL } from "../../chain/config";
import { CloseIcon, Logo, MenuIcon } from "../ui/Icons";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#activity", label: "Activity" },
  { href: "#story", label: "Why trustless" },
  { href: "#faq", label: "FAQ" },
];

/** Landing header (L0): logo, section links, GitHub, Open app. Under 900px the links fold into a menu (L0m). */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/[0.94] backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-[68px] max-w-site items-center justify-between gap-6 px-8 max-[480px]:px-4">
        <div className="flex items-center gap-11">
          <a href="#top" className="mt-link flex items-center gap-2.5 text-ink">
            <Logo size={28} />
            <span className="text-[19px] font-bold tracking-[-0.02em]">MuchTip</span>
          </a>
          <div className="flex gap-[30px] text-[14px] font-medium max-[900px]:hidden">
            {LINKS.map((l) => <a key={l.href} className="mt-link text-ink-2" href={l.href}>{l.label}</a>)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a className="mt-link px-3.5 py-2.5 text-[14px] font-medium text-ink-2 max-[900px]:hidden" href={SOURCE_URL} target="_blank" rel="noreferrer">GitHub</a>
          <Link to="/app" className="mt-btn inline-flex h-10 items-center rounded-ctl bg-ink px-[18px] text-[14px] font-semibold text-white no-underline">Open app</Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mt-menu"
            onClick={() => setOpen((o) => !o)}
            className="mt-btn hidden h-10 w-10 cursor-pointer items-center justify-center rounded-ctl border border-line-wallet bg-white text-ink max-[900px]:inline-flex"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </nav>
      {open && (
        <div id="mt-menu" className="mt-in border-t border-line bg-paper px-4 pb-4 min-[901px]:hidden">
          {[...LINKS, { href: SOURCE_URL, label: "GitHub" }].map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="mt-link flex min-h-11 items-center border-b border-line-soft text-[15px] font-medium text-ink last:border-b-0" {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}
