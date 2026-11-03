// Small shared pieces: Skeleton, Avatar.

export function Skeleton({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <span aria-hidden="true" className={`${dark ? "mt-skel-dark" : "mt-skel"} block rounded-[6px] ${className}`} />;
}

/** Initials in a circle: ink on gold by default (the spec's "XD" avatars are gold on ink). */
export function Avatar({ text, size = 38, className = "" }: { text: string; size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-ink font-bold text-gold ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {text}
    </span>
  );
}
