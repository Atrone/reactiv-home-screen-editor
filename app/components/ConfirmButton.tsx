import { useEffect, useState, type ReactNode } from "react";

type ConfirmButtonProps = {
  /** Accessible name before arming, e.g. "Remove section". */
  label: string;
  /** Accessible name and visible text once armed, e.g. "Confirm remove". */
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * A destructive button that needs two clicks: the first arms it (and changes its label), the
 * second performs the action. It disarms after a few seconds or when focus leaves. Cheaper
 * than an undo stack and less jarring than a blocking `window.confirm` dialog.
 *
 * @param props - Labels, the action and the idle content (usually an icon).
 * @returns The button.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, children, className = "" }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    // Disarm automatically so a stray click minutes later cannot delete anything.
    if (!armed) {
      return;
    }
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      aria-label={armed ? confirmLabel : label}
      title={armed ? confirmLabel : label}
      // First click arms, second click confirms.
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={`${className} ${armed ? "bg-red-600 px-2 text-xs font-semibold text-white hover:bg-red-700" : ""}`}
    >
      {armed ? "Confirm" : children}
    </button>
  );
}
