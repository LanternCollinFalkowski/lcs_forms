import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full min-h-9 rounded-input border border-hairline bg-surface px-3 py-1.5 text-[14px] text-ink placeholder:text-muted",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy focus-visible:border-navy",
        "disabled:opacity-60 disabled:bg-subtle",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full min-h-[90px] rounded-input border border-hairline bg-surface px-3 py-2 text-[14px] text-ink placeholder:text-muted resize-y",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy focus-visible:border-navy",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
