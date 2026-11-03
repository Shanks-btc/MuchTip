import { useEscrowConfig } from "../../chain/hooks";
import { SAMPLE_RECEIPT } from "../../data/samples";
import { formatDoge } from "../../lib/format";
import { claimLink } from "../../lib/links";
import { ReceiptTicket } from "../ReceiptTicket";

const STEPS = [
  { title: "You tip a handle", body: "We look up the account and tie your tip to its permanent X ID, so a renamed or recycled handle can't take it.", dot: "bg-ink text-gold" },
  { title: "The contract holds it", body: "Not MuchTip, not a company wallet. The DOGE sits in TipEscrow, where anyone can check it.", dot: "border border-ink bg-gold" },
  { title: "They claim it, or you get it back", body: "They sign in with X and collect every waiting tip in one transaction. If they don't, the refund unlocks for you.", dot: "border-2 border-ink bg-white" },
];

/** Spec H1 / H1m: three steps and the receipt ticket. */
export function HowItWorks() {
  // Wiring-spec section 5: a static sample (frame H1's values), labelled "Sample receipt". Only the refund time is live.
  const { refundDelaySeconds } = useEscrowConfig();
  const sent = new Date();
  sent.setHours(SAMPLE_RECEIPT.sentAt.hours, SAMPLE_RECEIPT.sentAt.minutes, 0, 0);
  const sentAt = Math.floor(sent.getTime() / 1000);

  return (
    <section id="how" className="border-b border-line bg-white">
      <div data-reveal="group" className="mx-auto flex max-w-site flex-wrap items-center gap-20 px-8 py-28 max-[480px]:px-4">
        <div className="flex-[1_1_420px]">
          <h2 className="m-0 text-[clamp(36px,4vw,56px)] leading-[1.02]">A tip is a promise the contract keeps.</h2>
          <ol data-reveal="group" className="relative m-0 mt-11 list-none p-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`relative flex gap-5 ${i < 2 ? "pb-[34px]" : ""}`}>
                {i < 2 && <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-[34px] w-0.5 bg-line" />}
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-semibold ${s.dot}`}>{i + 1}</span>
                <div>
                  <h3 className="m-0 mb-1.5 mt-1 text-[20px]">{s.title}</h3>
                  <p className="m-0 text-[15px] leading-[1.55] text-ink-3">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-[1_1_400px] justify-center">
          <figure className="m-0 w-full max-w-[430px]">
            <div className="relative">
              <div aria-hidden="true" className="absolute bottom-[-14px] left-3.5 right-[-10px] top-[18px] rotate-[3.5deg] rounded-ticket bg-gold max-[480px]:hidden" />
              <ReceiptTicket
                status="waiting"
                amount={SAMPLE_RECEIPT.amountWei}
                from={SAMPLE_RECEIPT.from}
                to={SAMPLE_RECEIPT.to}
                sentAt={sentAt}
                refundAt={refundDelaySeconds === undefined ? null : sentAt + refundDelaySeconds}
                txHash={SAMPLE_RECEIPT.txHash}
                notch="#FFFFFF"
                link={claimLink()}
                shareText={`I just tipped ${SAMPLE_RECEIPT.to} ${formatDoge(SAMPLE_RECEIPT.amountWei)} DOGE on MuchTip. Claim it with your X account: ${claimLink()}`}
              />
            </div>
            <figcaption className="mt-[30px] text-center text-[13px] text-muted">Sample receipt. Share yours so they know a tip is waiting.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
