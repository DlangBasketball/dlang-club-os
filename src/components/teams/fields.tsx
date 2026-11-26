import * as React from "react";
import { cn } from "@/lib/utils";

export const selectClass = "h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink focus-visible:border-maroon/60 focus-visible:outline-none";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(selectClass, className)} {...props} />,
);
Select.displayName = "Select";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("min-h-[80px] w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus-visible:border-maroon/60 focus-visible:outline-none", className)} {...props} />;
}

export function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="text-sm text-danger">{message}</p> : null;
}
