import { Link } from "react-router-dom";
import { explorerAddr, ESCROW_ADDRESS, SOURCE_URL } from "../../chain/config";
import { Logo } from "../ui/Icons";

/** Spec L0 gold footer. */
export function Footer() {
  const link = "mt-link text-gold-on";
  return (
    <footer className="bg-gold">
      <div className="mx-auto max-w-site px-8 pb-10 pt-[88px] max-[480px]:px-4">
        <div className="flex flex-wrap items-end justify-between gap-8 border-b border-ink/20 pb-16">
          <h2 data-reveal className="m-0 max-w-[720px] text-[clamp(40px,5vw,76px)] leading-[0.98]">Give your DOGE a reason to move.</h2>
          <div className="flex flex-wrap gap-2.5">
            <Link to="/app" className="mt-btn inline-flex h-[54px] items-center rounded-btn bg-ink px-7 text-[16px] font-semibold text-white no-underline">Send a tip</Link>
            <Link to="/app/claim" className="mt-btn inline-flex h-[54px] items-center rounded-btn border border-ink px-[26px] text-[16px] font-semibold text-ink no-underline">Claim tips</Link>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-8 pt-10 text-[14px]">
          <div>
            <div className="flex items-center gap-2.5"><Logo size={26} fill="#FFFFFF" /><span className="text-[17px] font-bold">MuchTip</span></div>
            <p className="m-0 mt-3 max-w-[220px] text-gold-on">Trustless DOGE tips to any X handle.</p>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-2.5">
            <div className="font-semibold">Product</div>
            <Link className={link} to="/app">Open the app</Link>
            <Link className={link} to="/app">Send a tip</Link>
            <Link className={link} to="/app/claim">Claim tips</Link>
            <a className={link} href="#activity">Live activity</a>
            <a className={link} href="#start">Get started</a>
          </nav>
          <nav aria-label="Verify" className="flex flex-col gap-2.5">
            <div className="font-semibold">Verify</div>
            <a className={link} href={explorerAddr(ESCROW_ADDRESS)} target="_blank" rel="noreferrer">Contract on explorer ↗</a>
            <a className={link} href={SOURCE_URL} target="_blank" rel="noreferrer">Source code ↗</a>
          </nav>
          <div className="flex flex-col gap-2.5">
            <div className="font-semibold">Built for</div>
            <span className="text-gold-on">Vibe Code on DOGE</span>
            <span className="text-gold-on">with Noah AI</span>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-2 text-[12px] text-gold-on">
          <span>Non-custodial · Refundable · Built on DogeOS</span>
          <span>Testnet only. Tips use test DOGE.</span>
        </div>
      </div>
    </footer>
  );
}
