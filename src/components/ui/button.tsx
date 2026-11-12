import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Button — prototype `.btn` family. All colours come from design tokens so a
 * tenant re-brand flows through automatically. Every size keeps a 44px hit
 * area on touch devices (`touch-target`).
 */
const buttonVariants = cva(
  [
    "touch-target relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap",
    "rounded border font-medium tracking-[-0.005em]",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-wait",
    "active:translate-y-px motion-reduce:transform-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "border-brand-primary bg-brand-primary text-on-brand hover:border-brand-primary-dark hover:bg-brand-primary-dark hover:shadow-glow-strong",
        secondary:
          "border-border bg-surface text-text hover:border-brand-primary hover:bg-surface-elevated",
        ghost:
          "border-transparent bg-transparent text-text-muted hover:bg-surface hover:text-text",
        danger:
          "border-danger bg-danger text-on-brand hover:brightness-110 hover:shadow-glow",
        outline:
          "border-brand-primary/50 bg-transparent text-brand-primary hover:border-brand-primary hover:bg-brand-primary-soft",
        accent:
          "border-transparent bg-gradient-to-br from-brand-accent to-brand-accent-dark text-on-accent hover:shadow-md",
        success:
          "border-success bg-success text-on-brand hover:brightness-110",
        link: "h-auto border-transparent px-0 text-brand-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[12.5px]",
        md: "h-10 px-[18px] text-sm",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-10 w-10 p-0",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
export { buttonVariants };
