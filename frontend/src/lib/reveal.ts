/**
 * Sets data-in on [data-reveal] elements once they scroll into view, which plays their rise (index.css). An attribute
 * rather than a class, because React rewrites className on re-render but leaves attributes it didn't set alone.
 * One observer for the whole page; a MutationObserver picks up elements React renders later (route changes, data).
 * Does nothing unless index.html enabled motion (html.mt-motion).
 */
export function installReveal() {
  if (!document.documentElement.classList.contains("mt-motion")) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute("data-in", "");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  const scan = () => {
    document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal-seen])").forEach((el) => {
      el.setAttribute("data-reveal-seen", "");
      io.observe(el);
    });
  };
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}
