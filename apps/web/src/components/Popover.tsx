import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A disclosure popover (menus, filter pickers). Closes on Escape and on a click
 * outside, returning focus to its button.
 */
export function Popover({
  label,
  button,
  children,
  align = "left",
  className = "",
}: {
  label: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={`popover ${className}`} ref={root}>
      <button ref={btn} type="button" className="btn btn-quiet" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open ? (
        <div id={id} className={`popover-body popover-${align}`} role="group" aria-label={label}>
          {children(() => {
            setOpen(false);
            btn.current?.focus();
          })}
        </div>
      ) : null}
    </div>
  );
}
