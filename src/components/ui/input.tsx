import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared field chrome — prototype `.field input`. */
export const fieldClass = cn(
  "touch-target w-full rounded border border-border bg-surface-input px-3 text-sm text-text",
  "placeholder:text-text-subtle transition-[border-color,box-shadow] duration-150",
  "hover:border-border-strong",
  "focus-visible:border-brand-primary focus-visible:outline-none focus-visible:shadow-focus",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-[invalid=true]:border-danger",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldClass, "h-10", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClass, "min-h-[88px] py-2.5 leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClass, "h-10 pr-8", className)} {...props} />
));
Select.displayName = "Select";

/** Field label — prototype uppercase eyebrow style. */
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

/** Helper / error text under a field. Pass `error` for the danger tone. */
export function FieldHint({
  className,
  error,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { error?: boolean }) {
  return (
    <p
      role={error ? "alert" : undefined}
      className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-text-muted", className)}
      {...props}
    />
  );
}
