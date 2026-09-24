import { type ButtonHTMLAttributes, forwardRef } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "ghost" | "outline" | "primary";
  icon?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "ghost",
      icon = false,
      className = "",
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      data-slot="button"
      data-variant={variant}
      className={`ui-button ${icon ? "ui-button-icon" : ""} ${className}`}
      {...props}
    />
  ),
);
Button.displayName = "Button";
