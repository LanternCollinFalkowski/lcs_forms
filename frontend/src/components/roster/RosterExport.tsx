import { Download, FileSpreadsheet, FileText, Loader2, MoreHorizontal, Printer, Sheet as SheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFileExport, type ExportFormat } from "@/lib/exportPipeline";
import { API_BASE } from "@/lib/api";

export type { ExportFormat };

/** What's on screen: the site selection, the tab, and the search box. */
export interface RosterView {
  site?: string;
  status: "active" | "attention" | "archived";
  q: string;
}

function exportUrl(view: RosterView, format: ExportFormat, inline = false) {
  const p = new URLSearchParams({ format, status: view.status });
  if (view.site) p.set("site", view.site);
  if (view.q.trim()) p.set("q", view.q.trim());
  if (inline) p.set("inline", "1");
  return `${API_BASE}/tenants/export?${p}`;
}

/**
 * Download (CSV / Excel / PDF) and Print for the current roster view.
 * Everything comes from the server, so the file matches the screen and the
 * export is audited there.
 */
export function useRosterExport(view: RosterView) {
  return useFileExport((format, inline) => exportUrl(view, format, inline));
}

function ExportItems({ download, busy }: { download: (f: ExportFormat) => void; busy: string | null }) {
  const item = (format: ExportFormat, Icon: typeof FileText, label: string, hint: string) => (
    <DropdownMenuItem onSelect={() => download(format)} disabled={busy !== null} className="min-h-[44px] md:min-h-0">
      {busy === format ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : <Icon className="h-4 w-4 text-muted" />}
      <span className="flex-1">
        <span className="block">{label}</span>
        <span className="block text-micro text-muted">{hint}</span>
      </span>
    </DropdownMenuItem>
  );
  return (
    <>
      {item("csv", SheetIcon, "CSV", "Plain spreadsheet data")}
      {item("xlsx", FileSpreadsheet, "Excel", "Formatted table with filters")}
      {item("pdf", FileText, "PDF", "Print-ready, grouped by site")}
    </>
  );
}

/** Desktop: a Print button and an Export menu, side by side. */
export function RosterExportButtons({ view, disabled }: { view: RosterView; disabled?: boolean }) {
  const { download, print, busy } = useRosterExport(view);
  return (
    <>
      <Button variant="secondary" onClick={() => void print()} disabled={disabled || busy !== null} title="Print this roster">
        {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={disabled}>
            {busy && busy !== "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuLabel>Export what's shown</DropdownMenuLabel>
          <ExportItems download={download} busy={busy} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Phone: one "…" button beside Add, holding Print and the three formats. */
export function RosterExportMenu({ view, disabled }: { view: RosterView; disabled?: boolean }) {
  const { download, print, busy } = useRosterExport(view);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" disabled={disabled} className="min-h-[44px] w-11 px-0" aria-label="Print or export">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[240px]">
        <DropdownMenuItem onSelect={() => void print()} disabled={busy !== null} className="min-h-[44px]">
          <Printer className="h-4 w-4 text-muted" /> Print
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Export what's shown</DropdownMenuLabel>
        <ExportItems download={download} busy={busy} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
