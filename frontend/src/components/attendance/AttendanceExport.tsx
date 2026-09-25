import { Download, FileSpreadsheet, FileText, Loader2, MoreHorizontal, Printer, Sheet as SheetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFileExport, type ExportFormat } from "@/lib/exportPipeline";
import { API_BASE } from "@/lib/api";

/** What's on screen: the site selection and the search box, or a specific multi-select. */
export interface AttendanceView {
  site?: string;
  q: string;
  /** A multi-selected set of entries — exported instead of the filtered view when present. */
  ids?: string[];
}

function exportUrl(view: AttendanceView, format: ExportFormat, inline = false) {
  const p = new URLSearchParams({ format });
  if (view.ids && view.ids.length > 0) {
    p.set("ids", view.ids.join(","));
  } else {
    if (view.site) p.set("site", view.site);
    if (view.q.trim()) p.set("q", view.q.trim());
  }
  if (inline) p.set("inline", "1");
  return `${API_BASE}/attendance/export?${p}`;
}

export function useAttendanceExport(view: AttendanceView) {
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
export function AttendanceExportButtons({ view, disabled }: { view: AttendanceView; disabled?: boolean }) {
  const { download, print, busy } = useAttendanceExport(view);
  const label = view.ids && view.ids.length > 0 ? `Export ${view.ids.length} selected` : "Export what's shown";
  return (
    <>
      <Button variant="secondary" onClick={() => void print()} disabled={disabled || busy !== null} title="Print attendance">
        {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={disabled}>
            {busy && busy !== "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <ExportItems download={download} busy={busy} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Phone: one "…" button beside Take attendance, holding Print and the three formats. */
export function AttendanceExportMenu({ view, disabled }: { view: AttendanceView; disabled?: boolean }) {
  const { download, print, busy } = useAttendanceExport(view);
  const label = view.ids && view.ids.length > 0 ? `Export ${view.ids.length} selected` : "Export what's shown";
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
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <ExportItems download={download} busy={busy} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Export the selected session's attendee sheet, including signatures in its PDF. */
export function AttendanceDetailExport({ id }: { id: string }) {
  const { download, print, busy } = useFileExport((format, inline) =>
    `${API_BASE}/attendance/${encodeURIComponent(id)}/export?${new URLSearchParams({ format, ...(inline ? { inline: "1" } : {}) })}`
  );
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => void print()} disabled={busy !== null}>
        {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print sheet
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" disabled={busy !== null}><Download className="h-4 w-4" /> Export sheet</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          <DropdownMenuLabel>Export this attendance</DropdownMenuLabel>
          <ExportItems download={download} busy={busy} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
