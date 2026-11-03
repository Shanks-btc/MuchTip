import type { Config } from "tailwindcss";

// Tokens from docs/design/MuchTip-design-spec-v5.html (the approved spec; values verbatim from its markup).
// Use the token, not the hex, in components. Type roles (h1 to h3, eyebrow, lead, button) live in src/index.css.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Dogecoin gold #BA9F33 (the coin colour in dogecoin/dogecoin share/pixmaps); hover / pressed and spinners #988430
        gold: { DEFAULT: "#BA9F33", hover: "#988430", ink: "#7A6620", text: "#2B2410", on: "#3A2E08", banner: "#EDE2B4", wash: "#FFFBEB", line: "#F4E3A8", spin: "#988430" },
        ink: { DEFAULT: "#0E0F14", 2: "#3D3D45", 3: "#4A4A52" },
        paper: { DEFAULT: "#FAFAF7", app: "#F4F3EE", stage: "#F3F2EE" },
        muted: { DEFAULT: "#6B6A64", 2: "#8B8A84", 3: "#77766F" },
        line: { DEFAULT: "#E7E5DE", 2: "#E0DED6", soft: "#ECEAE3", faint: "#F0EFEA", input: "#DDDAD0", wallet: "#D9D7CF", dash: "#B9B6AA", bezel: "#D3D0C6", icon: "#E6E4DD", badge: "#E0DED6" },
        surface: { chip: "#F2F1EC", well: "#F7F6F1", track: "#EFEEE8", row: "#FBF8EE", skel: "#EFEEE9" },
        tile: { waiting: "#F1E7C2", refund: "#F6DDD3", claimed: "#DCEBDD", people: "#E6E1F1", info: "#DCE8F2" },
        success: { DEFAULT: "#16A34A", ink: "#0F6A31", bg: "#E7F6EC", wash: "#F3FAF5", line: "#CDEBD6" },
        error: { DEFAULT: "#B42318", bg: "#FDECEA", line: "#F3C9C4", wash: "#FDF6F5" },
        warning: { DEFAULT: "#8A3B0A", bg: "#FFF7ED", line: "#F5D9B8", strong: "#B45309", sep: "#C9A27C" },
        tipped: { bg: "#F5EEC0", ink: "#5E4F17", dot: "#BA9F33" },
        refunded: { bg: "#F0EFEA", ink: "#4A4A52", dot: "#8B8A84" },
        night: { DEFAULT: "#0E0F14", card: "#17181F", well: "#17181E", line: "#2B2C35", text: "#B8B7B0", muted: "#8E8D86", input: "#111218", dash: "#2C2D35", chip: "#24252C", edge: "#34353D", arrow: "#1F2027", soft: "#A4A39C", pale: "#C9C7BF", cents: "#5E5D58", warm: "#F5B26B", mist: "#E9E7DF" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        // spec "Type": lead paragraph and button labels
        lead: ["18px", { lineHeight: "1.7" }],
        "lead-sm": ["17px", { lineHeight: "1.7" }],
        btn: ["15px", { lineHeight: "1.2", fontWeight: "600" }],
        eyebrow: ["13px", { letterSpacing: "0.1em", fontWeight: "500" }],
        "eyebrow-sm": ["12px", { letterSpacing: "0.1em", fontWeight: "500" }],
      },
      letterSpacing: { heading: "-0.045em", hero: "-0.055em", eyebrow: "0.1em" },
      maxWidth: { site: "1240px", app: "1160px" },
      borderRadius: { badge: "7px", ctl: "10px", btn: "12px", card: "16px", panel: "18px", ticket: "28px" },
      boxShadow: {
        tab: "0 1px 2px rgba(14,15,20,0.12)",
        persona: "0 1px 2px rgba(14,15,20,.08), 0 6px 16px -8px rgba(14,15,20,.25)",
        ticket: "0 40px 80px -30px rgba(14,15,20,.55)",
        draft: "0 24px 50px -28px rgba(14,15,20,.55)",
        focus: "0 0 0 3px rgba(186,159,51,0.45)",
      },
    },
  },
  plugins: [],
} satisfies Config;
