import { useState } from "react";
import { useToast } from "./Toast";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A labelled button that copies `value` and reads "Copied" for a moment. */
export function CopyButton({ value, label, className = "", children }: { value: string; label: string; className?: string; children?: React.ReactNode }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const onClick = async () => {
    const ok = await copyText(value);
    toast(ok ? "Copied" : "Couldn't copy. Select the text and copy it instead", ok ? "info" : "error");
    if (ok) {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }
  };
  return (
    <button type="button" onClick={onClick} aria-label={label} className={className}>
      {done ? "Copied" : children ?? "Copy"}
    </button>
  );
}
