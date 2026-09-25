import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

/** The color of an avatar whose person hasn't chosen one (also used for their bar in reports). */
export const AVATAR_DEFAULT = "#2c3453";

export function Avatar({ name, color, size = 32, className, style }: { name: string; color?: string | null; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full text-center font-heading font-bold leading-none text-white", className)}
      // Caller's style last, so a layout tweak that depends on `size` — the
      // overlap in a stack of viewers, say — can be passed in without this
      // component growing a prop for it.
      style={{ width: size, height: size, backgroundColor: color || AVATAR_DEFAULT, fontSize: size * 0.4, ...style }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
