import { STATUS_HELP, STATUS_LABELS, type DisplayStatus, type StatusView } from "@myself-dashboard/core";
import { Icon, type IconName } from "./Icon";

/**
 * Status is always shape + words + colour, never colour alone. The colour is on
 * the icon and a light wash; the words are black (style guide: all text is black).
 */
export const STATUS_ICON: Record<DisplayStatus, IconName> = {
  complete: "check",
  incomplete: "half",
  abandoned: "pause",
  in_progress: "clock",
  not_started: "circle",
  needs_review: "flag",
  invalid: "ban",
  test: "beaker",
};

export function StatusBadge({ status, compact = false }: { status: StatusView | DisplayStatus; compact?: boolean }) {
  const s: StatusView = typeof status === "string" ? { display: status, lifecycle: status as never, markers: [], signals: [], openFlags: 0 } : status;
  const secondary = s.display !== s.lifecycle && typeof status !== "string" ? STATUS_LABELS[s.lifecycle] : null;
  return (
    <span className={`badge status-${s.display}`} title={STATUS_HELP[s.display]}>
      <Icon name={STATUS_ICON[s.display]} size={14} />
      <span>{STATUS_LABELS[s.display]}</span>
      {secondary && !compact ? <span className="badge-sub">· {secondary}</span> : null}
    </span>
  );
}

export function StatusDot({ status }: { status: DisplayStatus }) {
  return (
    <span className={`status-dot status-${status}`} aria-hidden="true">
      <Icon name={STATUS_ICON[status]} size={12} />
    </span>
  );
}
