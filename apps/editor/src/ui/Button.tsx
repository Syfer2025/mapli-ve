import type { ButtonHTMLAttributes, ReactNode } from "react";
import "./Button.css";

export type ButtonVariant = "default" | "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Botão só de ícone: vira quadrado e exige `aria-label`. */
  readonly iconOnly?: boolean;
  readonly children?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  iconOnly = false,
  type = "button",
  children,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type={type}
      className="ui-button"
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
