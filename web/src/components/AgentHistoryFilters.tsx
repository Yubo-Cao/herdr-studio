import {
  HISTORY_CATEGORIES,
  type HistoryCategory,
  type HistoryFilters,
} from "./agentHistory";
import { msg, t } from "../i18n";
import "./AgentHistoryFilters.css";

const labels: Record<HistoryCategory, string> = {
  user: msg("User"),
  agent: msg("Agent"),
  tool: msg("Tool"),
};

export function AgentHistoryFilters({
  filters,
  counts,
  onToggle,
}: {
  filters: HistoryFilters;
  counts: Record<HistoryCategory, number>;
  onToggle: (category: HistoryCategory) => void;
}) {
  return (
    <div
      className="agent-history-filters"
      role="group"
      aria-label={t("Filter history by message type")}
    >
      {HISTORY_CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          className={`agent-history-filter is-${category}`}
          aria-label={t(labels[category])}
          aria-pressed={filters[category]}
          title={
            filters[category]
              ? t("Hide {category} entries", {
                  category: t(labels[category]),
                })
              : t("Show {category} entries", {
                  category: t(labels[category]),
                })
          }
          onClick={() => onToggle(category)}
        >
          {t(labels[category])}
          <span>{counts[category]}</span>
        </button>
      ))}
    </div>
  );
}
