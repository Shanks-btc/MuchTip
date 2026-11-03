// Icons with the exact paths and strokes used in the design spec. All decorative: aria-hidden; label the control instead.
type P = { size?: number; className?: string; strokeWidth?: number };
const svg = (size: number, className: string | undefined, strokeWidth: number, children: React.ReactNode, fill = false) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? undefined : "currentColor"}
    strokeWidth={fill ? undefined : strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 ${className ?? ""}`}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const CheckIcon = ({ size = 18, className, strokeWidth = 2.5 }: P) => svg(size, className, strokeWidth, <path d="M20 6 9 17l-5-5" />);
export const CloseIcon = ({ size = 18, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <path d="M18 6 6 18M6 6l12 12" />);
export const PlusIcon = ({ size = 14, className, strokeWidth = 2.4 }: P) => svg(size, className, strokeWidth, <path d="M12 5v14M5 12h14" />);
export const MenuIcon = ({ size = 18, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <path d="M4 7h16M4 12h16M4 17h16" />);
export const ArrowIcon = ({ size = 16, className, strokeWidth = 2.2 }: P) => svg(size, className, strokeWidth, <path d="M5 12h14M13 6l6 6-6 6" />);
export const WalletIcon = ({ size = 15, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M16 12.5h2M3 10h18" /></>);
export const ClockIcon = ({ size = 12, className, strokeWidth = 2.2 }: P) => svg(size, className, strokeWidth, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const RefundIcon = ({ size = 12, className, strokeWidth = 2.2 }: P) => svg(size, className, strokeWidth, <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></>);
export const PeopleIcon = ({ size = 12, className, strokeWidth = 2.2 }: P) =>
  svg(size, className, strokeWidth, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5s6.5 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2.2.6 3.5 2.4 3.5 5.2" /></>);

// the four app tabs: Send, Claim, My tips, Activity
export const SendIcon = ({ size = 16, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />);
export const ClaimIcon = ({ size = 16, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />);
export const TipsIcon = ({ size = 16, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h6" /></>);
export const PulseIcon = ({ size = 16, className, strokeWidth = 2 }: P) => svg(size, className, strokeWidth, <path d="M3 12h4l3 8 4-16 3 8h4" />);

export const XLogo = ({ size = 15, className }: P) => svg(size, className, 0, <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.3l4.4 5.8L17.8 3z" />, true);

/** The spec's spinner: a 3/4 arc in the current colour. */
export const Spinner = ({ size = 16, className = "", strokeWidth = 3 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} className={`mt-spin shrink-0 ${className}`} aria-hidden="true">
    <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
  </svg>
);

/** The MuchTip mark: a D in a rounded gold square. `fill` is the square, `outline` draws the ink border. */
export const Logo = ({ size = 28, fill = "#F2B824", outline = true }: { size?: number; fill?: string; outline?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
    <rect x="1" y="1" width="30" height="30" rx="9" fill={fill} {...(outline ? { stroke: "#0E0F14", strokeWidth: 2 } : {})} />
    <path d="M10 21V11h5.2c3.1 0 5.3 2 5.3 5s-2.2 5-5.3 5H10z" fill="none" stroke="#0E0F14" strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M8 16h7" stroke="#0E0F14" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
