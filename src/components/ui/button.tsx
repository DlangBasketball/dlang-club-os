import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-medium transition-all focus-visible:outline-none focus-visible:shadow-ring-red disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-maroon text-inverse hover:bg-maroon-dark shadow-glow-red active:translate-y-px",
        secondary:
          "bg-surface-elevated text-ink border border-line hover:border-maroon/60 hover:text-inverse",
        ghost: "text-ink-2 hover:text-ink hover:bg-surface-elevated",
        danger: "bg-danger/90 text-inverse hover:bg-danger",
        outline:
          "border border-maroon/50 text-maroon hover:bg-maroon-soft",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
export { buttonVariants };
