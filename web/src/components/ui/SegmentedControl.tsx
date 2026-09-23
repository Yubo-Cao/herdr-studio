import type { ReactNode } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is abbreviated or visual only. */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
};

/** One exclusive choice among a few peers, e.g. view modes or scopes. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  className = "",
  stretch = false,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Share the available width equally between options. */
  stretch?: boolean;
  "aria-label": string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`ui-segmented ${stretch ? "is-stretched" : ""} ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          aria-label={option.ariaLabel}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
