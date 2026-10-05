import { OUTCOME_HELP, OUTCOME_LABELS, type Outcome } from "@myself-dashboard/core";
import { Icon, type IconName } from "../Icon";

/** Session detail (../SessionDetail.tsx): what happened to one question, as shape + words + colour. */

const OUTCOME_ICON: Record<Outcome, IconName> = {
  answered: "check",
  declined: "circle",
  invalid: "alert",
  skipped: "skipNext",
  no_response: "half",
  not_reached: "pause",
  eligible_not_shown: "alert",
  hidden_branching: "eye",
  answered_hidden: "eye",
  undetermined: "help",
};

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return (
    <span className={`badge outcome-${outcome}`} title={OUTCOME_HELP[outcome]}>
      <Icon name={OUTCOME_ICON[outcome]} size={13} />
      {OUTCOME_LABELS[outcome]}
    </span>
  );
}
