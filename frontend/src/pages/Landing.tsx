import { Activity } from "../components/landing/Activity";
import { Creators } from "../components/landing/Creators";
import { Faq } from "../components/landing/Faq";
import { Footer } from "../components/landing/Footer";
import { GetStarted } from "../components/landing/GetStarted";
import { Hero } from "../components/landing/Hero";
import { HowItWorks } from "../components/landing/HowItWorks";
import { SiteHeader } from "../components/landing/SiteHeader";
import { Story } from "../components/landing/Story";
import { SITE_TITLE, useTitle } from "../lib/title";

/** The marketing site at / (spec L0): hero, activity, how it works, get started, the 2014 story, creators, FAQ, footer. */
export default function Landing() {
  useTitle(SITE_TITLE);
  return (
    <div className="w-full overflow-x-clip bg-paper font-sans text-ink antialiased">
      <SiteHeader />
      <main>
        <Hero />
        <Activity />
        <HowItWorks />
        <GetStarted />
        <Story />
        <Creators />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
