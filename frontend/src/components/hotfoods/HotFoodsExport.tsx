import { Download, FileSpreadsheet, FileText, Loader2, MoreHorizontal, Printer, Sheet as SheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFileExport, type ExportFormat } from "@/lib/exportPipeline";
import { API_BASE } from "@/lib/api";
import { hotFoodParams, type HotFoodView } from "@/lib/queries";

/**
 * Print + Export for the Hot Foods Entries list and the Reports tab. The file
 * is built by the server from the same filter as the screen, so it always
 * matches what's shown, and every export is audited there.
 */

type Kind = "entries" | "report";

const OPTIONS: Record<Kind, { format: ExportFormat; Icon: typeof FileText; label: string; hint: string }[]> = {
  entries: [
    { format: "csv", Icon: SheetIcon, label: "CSV", hint: "Plain spreadsheet data" },
    { format: "xlsx", Icon: FileSpreadsheet, label: "Excel", hint: "Formatted table with filters" },
    { format: "pdf", Icon: FileText, label: "PDF", hint: "Print-ready list" },
  ],
  report: [
    { format: "pdf", Icon: FileText, label: "PDF report", hint: "The charts and totals, ready to share" },
    { format: "xlsx", Icon: FileSpreadsheet, label: "Excel workbook", hint: "One sheet per breakdown, to re-chart" },
  ],
};

function useHotFoodsExport(kind: Kind, view: HotFoodView) {
  return useFileExport((format, inline) => `${API_BASE}/hot-foods/${kind === "report" ? "report/export" : "export"}?${hotFoodParams(view, { format, ...(inline ? { inline: "1" } : {}) })}`);
}

function Items({ kind, download, busy }: { kind: Kind; download: (f: ExportFormat) => void; busy: string | null }) {
  return (
    <>
      {OPTIONS[kind].map(({ format, Icon, label, hint }) => (
        <DropdownMenuItem key={format} onSelect={() => download(format)} disabled={busy !== null} className="min-h-[44px] md:min-h-0">
          {busy === format ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : <Icon className="h-4 w-4 text-muted" />}
          <span className="flex-1">
            <span className="block">{label}</span>
            <span className="block text-micro text-muted">{hint}</span>
          </span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Desktop: Print and an Export menu, side by side. */
export function HotFoodsExportButtons({ kind, view, disabled }: { kind: Kind; view: HotFoodView; disabled?: boolean }) {
  const { download, print, busy } = useHotFoodsExport(kind, view);
  return (
    <>
      <Button variant="secondary" onClick={() => void print()} disabled={disabled || busy !== null}>
        {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={disabled}>
            {busy && busy !== "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[250px]">
          <DropdownMenuLabel>{kind === "report" ? "Export this report" : "Export what's shown"}</DropdownMenuLabel>
          <Items kind={kind} download={download} busy={busy} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Phone: one "…" button holding Print and the formats. */
export function HotFoodsExportMenu({ kind, view, disabled }: { kind: Kind; view: HotFoodView; disabled?: boolean }) {
  const { download, print, busy } = useHotFoodsExport(kind, view);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" disabled={disabled} className="min-h-[44px] w-11 px-0" aria-label="Print or export">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[250px]">
        <DropdownMenuItem onSelect={() => void print()} disabled={busy !== null} className="min-h-[44px]">
          <Printer className="h-4 w-4 text-muted" /> Print
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{kind === "report" ? "Export this report" : "Export what's shown"}</DropdownMenuLabel>
        <Items kind={kind} download={download} busy={busy} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One entry's signed receipt. */
export function HotFoodEntryPrint({ id }: { id: string }) {
  const { print, download, busy } = useFileExport((_format, inline) => `${API_BASE}/hot-foods/${encodeURIComponent(id)}/export${inline ? "?inline=1" : ""}`);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void print()} disabled={busy !== null}>
        {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
      </Button>
      <Button variant="secondary" onClick={() => void download("pdf")} disabled={busy !== null}>
        {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
      </Button>
    </div>
  );
}
