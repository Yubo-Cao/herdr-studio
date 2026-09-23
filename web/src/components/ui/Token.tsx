import type { HTMLAttributes, ReactNode } from "react";

export type TokenTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "info";

type TokenProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: TokenTone;
  /** Render as monospaced identifier text, e.g. a pane ID or branch. */
  code?: boolean;
  icon?: ReactNode;
};

/**
 * The one chip used for identifiers, statuses, counts, and traits. Every
 * token shares `--ui-token-height`, so rows and bars align regardless of
 * which tokens they carry.
 */
export function Token({
  tone = "neutral",
  code = false,
  icon,
  className = "",
  children,
  ...props
}: TokenProps) {
  const Element = code ? "code" : "span";
  return (
    <Element
      data-tone={tone}
      className={`ui-token ${code ? "is-code" : ""} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </Element>
  );
}
