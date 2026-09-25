import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { AttendanceListItem } from "./attendance.js";
import type { loadAttendanceDetail } from "./attendance.js";
import { scopeLabel, stamp, TZ } from "./exportCommon.js";

/**
 * Attendance exports: CSV, Excel and a print-ready PDF — the same pipeline as
 * `rosterExport.ts` (see `exportCommon.ts` for the shared parts), one row per
 * event rather than one row per person.
 */

export interface ExportContext {
  sites: { id: string; code: string; name: string }[];
  isAll: boolean;
  q: string;
  items: AttendanceListItem[];
  generatedBy: string;
  generatedAt: Date;
}

export type AttendanceDetail = Awaited<ReturnType<typeof loadAttendanceDetail>>;

export { scopeLabel };

export function exportFilename(ctx: ExportContext, ext: string) {
  const scope = ctx.sites.length === 1 ? ctx.sites[0].code : ctx.isAll ? "all-sites" : `${ctx.sites.length}-sites`;
  return `lantern-attendance-${scope}-${ctx.generatedAt.toISOString().slice(0, 10)}.${ext}`;
}

const pretty = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

interface Column {
  header: string;
  value: (e: AttendanceListItem) => string | number | Date | null;
  width: number;
}

function columns(ctx: ExportContext): Column[] {
  const cols: Column[] = [
    { header: "Date & time", value: (e) => pretty(e.occurredAt), width: 20 },
    { header: "Title", value: (e) => e.title, width: 28 },
    { header: "Description", value: (e) => e.description, width: 36 },
    { header: "Present", value: (e) => e.presentCount, width: 10 },
    { header: "Signed", value: (e) => e.signedCount, width: 10 },
    { header: "Taken by", value: (e) => e.createdByName, width: 20 },
  ];
  if (ctx.sites.length > 1) cols.splice(1, 0, { header: "Site", value: (e) => e.site.name, width: 22 });
  return cols;
}

// ── CSV ──────────────────────────────────────────────────────────────────

export function toCsv(ctx: ExportContext): Buffer {
  const cols = columns(ctx);
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => cell(c.header)).join(","), ...ctx.items.map((e) => cols.map((c) => cell(c.value(e))).join(","))];
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([BOM, Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

// ── Excel ────────────────────────────────────────────────────────────────

export async function toXlsx(ctx: ExportContext): Promise<Buffer> {
  const cols = columns(ctx);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lantern Forms";
  wb.created = ctx.generatedAt;
  const ws = wb.addWorksheet("Attendance", { views: [{ state: "frozen", ySplit: 3 }] });

  ws.getCell("A1").value = `Lantern Forms — Attendance · ${scopeLabel(ctx)}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `${ctx.items.length} ${ctx.items.length === 1 ? "entry" : "entries"}${ctx.q ? ` matching “${ctx.q}”` : ""} · exported ${stamp(ctx.generatedAt)} by ${ctx.generatedBy}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6A7189" } };

  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

  const rows = ctx.items.length ? ctx.items.map((e) => cols.map((c) => c.value(e))) : [cols.map(() => null)];
  ws.addTable({
    name: "Attendance",
    ref: "A3",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows,
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────

/** Print layout: US Letter, grouped by site, a heading and column header repeated on every page. */
export function toPdf(ctx: ExportContext): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 40, bufferPages: true, info: { Title: `Lantern Forms — Attendance — ${scopeLabel(ctx)}`, Author: "Lantern Forms" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const INK = "#232a3a";
  const MUTED = "#6a7189";
  const LINE = "#e2e6ee";
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 18;

  const grouped = ctx.sites.length > 1;
  type PdfCol = { header: string; w: number; value: (e: AttendanceListItem) => string };
  const cols: PdfCol[] = [
    { header: "Date", w: 90, value: (e) => pretty(e.occurredAt) },
    { header: "Title", w: 140, value: (e) => e.title },
    { header: "Description", w: width - 90 - 140 - 60 - 60 - 90, value: (e) => e.description },
    { header: "Present", w: 60, value: (e) => String(e.presentCount) },
    { header: "Signed", w: 60, value: (e) => String(e.signedCount) },
    { header: "Taken by", w: 90, value: (e) => e.createdByName },
  ];
  const ROW = 18;

  function pageTitle() {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(`Lantern Forms — Attendance — ${scopeLabel(ctx)}`, left, doc.page.margins.top, { width });
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `${ctx.items.length} ${ctx.items.length === 1 ? "entry" : "entries"}${ctx.q ? ` matching “${ctx.q}”` : ""} · printed ${stamp(ctx.generatedAt)} by ${ctx.generatedBy}`,
        { width }
      );
    doc.moveDown(0.8);
  }

  function columnHeader() {
    const y = doc.y;
    let x = left;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.header.toUpperCase(), x + 3, y, { width: c.w - 6, lineBreak: false });
      x += c.w;
    }
    doc.moveTo(left, y + 12).lineTo(left + width, y + 12).lineWidth(0.8).strokeColor(MUTED).stroke();
    doc.y = y + 16;
  }

  function newPage() {
    doc.addPage();
    pageTitle();
  }

  function siteHeading(name: string, count: number, continued = false) {
    if (doc.y + 22 + ROW * 2 > bottom()) newPage();
    const y = doc.y;
    doc.rect(left, y, width, 20).fill("#eef1f6");
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(`${name}${continued ? " (continued)" : ""}`, left + 6, y + 5.5, { width: width - 80, lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${count}`, left + width - 70, y + 6, { width: 64, align: "right", lineBreak: false });
    doc.y = y + 26;
    columnHeader();
  }

  pageTitle();
  if (ctx.items.length === 0) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(11).text("No attendance entries match this selection.", left, doc.y + 10);
  }

  const groups: { name: string; items: AttendanceListItem[] }[] = grouped
    ? ctx.sites.map((site) => ({ name: site.name, items: ctx.items.filter((e) => e.site.id === site.id) })).filter((group) => group.items.length > 0)
    : [{ name: scopeLabel(ctx), items: ctx.items }];
  if (!grouped) columnHeader();

  for (const g of groups) {
    if (grouped) siteHeading(g.name, g.items.length);
    g.items.forEach((e, i) => {
      if (doc.y + ROW > bottom()) {
        newPage();
        if (grouped) siteHeading(g.name, g.items.length, true);
        else columnHeader();
      }
      const y = doc.y;
      if (i % 2 === 1) doc.rect(left, y - 3, width, ROW).fill("#f6f8fb");
      let x = left;
      for (const c of cols) {
        doc
          .fillColor(INK)
          .font(c.header === "Title" ? "Helvetica-Bold" : "Helvetica")
          .fontSize(9.5)
          .text(c.value(e), x + 3, y, { width: c.w - 6, height: ROW - 4, lineBreak: false, ellipsis: true });
        x += c.w;
      }
      doc.moveTo(left, y + ROW - 3).lineTo(left + width, y + ROW - 3).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.y = y + ROW;
    });
    doc.y += 8;
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margin - 8;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text("Confidential — resident information. Do not leave unattended.", left, y, { width: width / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  return done;
}

/** A saved session is exported as its actual sign-in sheet, one resident per row. */
export function detailFilename(event: AttendanceDetail, ext: string) {
  return `lantern-attendance-${event.site.code}-${event.occurredAt.toISOString().slice(0, 10)}-${event.id}.${ext}`;
}

export function detailCsv(event: AttendanceDetail): Buffer {
  const escape = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    ["Site", event.site.name], ["Title", event.title], ["Description", event.description],
    ["Date & time", stamp(event.occurredAt)], ["Taken by", event.createdByName],
    [], ["Resident", "Signed", "Signed at"],
    ...event.entries.map((entry) => [entry.tenantName, entry.signature ? "Yes" : "No", entry.signedAt ? stamp(entry.signedAt) : ""]),
  ];
  return Buffer.from("\ufeff" + rows.map((row) => row.map(escape).join(",")).join("\r\n") + "\r\n", "utf8");
}

export async function detailXlsx(event: AttendanceDetail): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lantern Forms";
  const ws = wb.addWorksheet("Attendance", { views: [{ state: "frozen", ySplit: 8 }] });
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 40;
  ws.getColumn(3).width = 25;
  ws.addRow(["Site", event.site.name]);
  ws.addRow(["Title", event.title]);
  ws.addRow(["Description", event.description]);
  ws.addRow(["Date & time", stamp(event.occurredAt)]);
  ws.addRow(["Taken by", event.createdByName]);
  ws.addRow(["Present", event.entries.length]);
  ws.addRow([]);
  const header = ws.addRow(["Resident", "Signed", "Signed at"]);
  header.font = { bold: true };
  for (const entry of event.entries) {
    const row = ws.addRow([entry.tenantName, entry.signature ? "Yes" : "No", entry.signedAt ? stamp(entry.signedAt) : ""]);
    // Prevent spreadsheet formulas in names copied from a roster.
    if (/^[=+\-@\t\r]/.test(entry.tenantName)) row.getCell(1).value = `'${entry.tenantName}`;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function detailPdf(event: AttendanceDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 42, bufferPages: true, info: { Title: `Attendance — ${event.title}`, Author: "Lantern Forms" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const header = () => {
    doc.font("Helvetica-Bold").fontSize(17).fillColor("#232a3a").text(event.title, { width });
    doc.font("Helvetica").fontSize(10).fillColor("#6a7189")
      .text(`${event.site.name} · ${stamp(event.occurredAt)} · Taken by ${event.createdByName}`);
    doc.moveDown(0.8);
    doc.fillColor("#232a3a").fontSize(11).text(event.description, { width });
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).text(`${event.entries.length} present · ${event.entries.filter((e) => e.signature).length} signed`);
    doc.moveDown(1);
  };
  header();
  if (event.entries.length === 0) doc.font("Helvetica").text("Nobody was marked present.");
  event.entries.forEach((entry, index) => {
    const height = entry.signature ? 84 : 38;
    if (doc.y + height > bottom()) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    if (index % 2) doc.rect(left, y, width, height).fill("#f6f8fb");
    doc.fillColor("#232a3a").font("Helvetica-Bold").fontSize(11)
      .text(`${index + 1}. ${entry.tenantName}`, left + 8, y + 8, { width: width * 0.5 - 16, lineBreak: false, ellipsis: true });
    doc.font("Helvetica").fontSize(9).fillColor("#6a7189")
      .text(entry.signature ? `Signed ${entry.signedAt ? stamp(entry.signedAt) : ""}` : "No signature", left + 8, y + 24, { width: width * 0.5 - 16 });
    if (entry.signature) {
      const png = Buffer.from(entry.signature.slice("data:image/png;base64,".length), "base64");
      doc.image(png, left + width * 0.52, y + 6, { fit: [width * 0.46, height - 12] });
    }
    doc.moveTo(left, y + height).lineTo(left + width, y + height).strokeColor("#e2e6ee").lineWidth(0.5).stroke();
    doc.y = y + height;
  });
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font("Helvetica").fontSize(8).fillColor("#6a7189")
      .text(`Confidential — resident information · Page ${i + 1} of ${range.count}`, left, doc.page.height - 28, { width, lineBreak: false });
  }
  doc.end();
  return done;
}
