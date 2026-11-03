import { explorerAddr, ESCROW_ADDRESS, SOURCE_URL } from "../../chain/config";

const POINTS = [
  { title: "We never hold your DOGE", body: "It moves from your wallet to the contract to theirs.", link: { href: explorerAddr(ESCROW_ADDRESS), label: "View contract ↗", external: true } },
  { title: "Unclaimed means refundable", body: "Nothing gets stuck. After the window, it's yours again.", link: { href: "#faq", label: "How refunds work", external: false } },
  { title: "Open and tested", body: __CONTRACT_TEST_COUNT__ === null ? "Public source, tested with fuzzing and invariants." : `Public source, ${__CONTRACT_TEST_COUNT__} tests including fuzzing and invariants.`, link: { href: SOURCE_URL, label: "Read the code ↗", external: true } },
];

/** Spec L0 "Why trustless matters": the 2014 story. */
export function Story() {
  return (
    <section id="story" className="border-b border-line bg-white">
      <div data-reveal="group" className="mx-auto max-w-[860px] px-8 pb-[104px] pt-[120px] max-[480px]:px-4">
        <p className="mt-eyebrow m-0 text-gold-ink">Why trustless matters</p>
        <h2 className="m-0 mt-[18px] text-[clamp(26px,3vw,40px)] leading-[1.18]">
          In 2014, a Reddit bot made Dogecoin the internet's favourite way to say thanks. One company held every balance. When it ran out of money, users' coins went with it.
        </h2>
        <p className="m-0 mt-7 text-[19px] leading-[1.6] text-ink-2">MuchTip keeps the part people loved and removes the part that failed. There is no company balance to lose, because there is no company balance.</p>
        <div className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-8 border-t border-ink pt-8">
          {POINTS.map((p) => (
            <div key={p.title}>
              <h3 className="m-0 text-[18px]">{p.title}</h3>
              <p className="m-0 mt-2 text-[15px] leading-[1.55] text-ink-3">{p.body}</p>
              <a className="mt-link mt-2.5 inline-block font-mono text-[12px] font-medium text-gold-ink" href={p.link.href} {...(p.link.external ? { target: "_blank", rel: "noreferrer" } : {})}>{p.link.label}</a>
            </div>
          ))}
        </div>
        <p className="m-0 mt-10 text-[12px] text-muted">Sources: Benzinga, CoinDesk, Gizmodo.</p>
      </div>
    </section>
  );
}
