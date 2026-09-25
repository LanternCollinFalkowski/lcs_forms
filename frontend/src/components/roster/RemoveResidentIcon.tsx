import { Trash2 } from "lucide-react";
import type { SVGProps } from "react";

/** Small, simple trash mark that follows the app's Lucide icon style. */
export function RemoveResidentIcon(props: SVGProps<SVGSVGElement>) {
  return <Trash2 aria-hidden="true" {...props} />;
}
