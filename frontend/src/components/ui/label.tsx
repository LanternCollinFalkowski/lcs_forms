import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("block text-[12px] font-semibold text-muted mb-1.5", className)} {...props} />
  )
);
Label.displayName = "Label";

/** A form field wrapper: label + control. */
export function Field({ label, children, hint, className }: { label?: React.ReactNode; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <div className={className}>
      {label && <Label>{label}</Label>}
      {children}
      {hint && <p className="mt-1 text-micro text-muted">{hint}</p>}
    </div>
  );
}
