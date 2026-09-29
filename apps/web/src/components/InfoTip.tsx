import { useId, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * A definition behind an ⓘ: a real button, so it is reachable by keyboard and
 * announced; the text is also exposed through aria-describedby.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={`Definition: ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <Icon name="info" size={15} />
      </button>
      <span id={id} role="tooltip" className={`infotip-body ${open ? "open" : ""}`}>
        {children}
      </span>
    </span>
  );
}
