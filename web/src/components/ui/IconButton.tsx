import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { Button } from "./Button";

type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  /** Required: an icon-only control needs an accessible name and tooltip. */
  label: string;
  icon: ReactNode;
  tone?: "neutral" | "danger";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, tone = "neutral", title, ...props }, ref) => (
    <Button
      ref={ref}
      icon
      aria-label={label}
      title={title ?? label}
      data-tone={tone}
      {...props}
    >
      {icon}
    </Button>
  ),
);
IconButton.displayName = "IconButton";
