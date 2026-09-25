import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { scopeLabel, stamp, TZ } from "./exportCommon.js";
import type { EntryDetail, EntryFilter, EntryRow, HotFoodReport } from "./hotFoods.js";

/**
 * Hot Foods exports. Entries: one row per distribution (CSV, Excel, PDF), the
 * same pipeline as the roster and attendance exports. Report: the Reports tab
 * as a printable PDF with its charts drawn in, and as an Excel workbook with
 * one sheet per breakdown so the numbers can be re-charted.
 */

export interface ExportMeta {
  filter: EntryFilter;
  isAll: boolean;
  generatedBy: string;
  generatedAt: Date;
}

const INK = "#232a3a";
const MUTED = "#6a7189";
const LINE = "#e2e6ee";
const BAR = "#2d4a86";
/** The avatar color for someone who hasn't picked one (frontend components/ui/avatar.tsx). */
const AVATAR_DEFAULT = "#2c3453";
/**
 * The light-mode values of the validated chart palette in frontend index.css
 * (--viz-*), so a printed report wears the same colors as the screen.
 */
const VIZ = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const VIZ_OTHER = "#898781";
const slotHex = (slot: number | null) => (slot === null ? VIZ_OTHER : VIZ[slot] ?? VIZ_OTHER);
const SITE_TYPE: Record<string, { label: string; color: string }> = {
  supportive: { label: "Supportive housing", color: "#4a3aa7" },
  shelter: { label: "Shelter", color: "#008300" },
  other: { label: "Other", color: "#898781" },
};
const siteType = (t: string) => SITE_TYPE[t] ?? SITE_TYPE.other;
const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

const pretty = (d: Date) => d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
const rangeLabel = (f: { from: string; to: string }) => (f.from === f.to ? dayLabel(f.from) : `${dayLabel(f.from)} – ${dayLabel(f.to)}`);
const scope = (m: ExportMeta) => scopeLabel({ sites: m.filter.sites, isAll: m.isAll });
const itemsText = (e: Pick<EntryRow, "items">) => e.items.map((i) => (i.quantity > 1 ? `${i.itemName} × ${i.quantity}` : i.itemName)).join(", ");
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function filename(kind: "entries" | "report", m: ExportMeta, ext: string) {
  const s = m.filter.sites.length === 1 ? m.filter.sites[0].code : m.isAll ? "all-sites" : `${m.filter.sites.length}-sites`;
  return `lantern-hot-foods-${kind}-${s}-${m.filter.from}-to-${m.filter.to}.${ext}`;
}

// ── Entries ──────────────────────────────────────────────────────────────

interface Column {
  header: string;
  width: number;
  value: (e: EntryRow) => string | number;
}

function columns(m: ExportMeta): Column[] {
  const cols: Column[] = [
    { header: "Date & time", width: 20, value: (e) => pretty(e.occurredAt) },
    { header: "Resident", width: 24, value: (e) => e.tenantName },
    { header: "Room", width: 9, value: (e) => e.unit ?? "" },
    { header: "Items", width: 34, value: itemsText },
    { header: "Meals", width: 8, value: (e) => e.mealCount },
    { header: "Notes", width: 28, value: (e) => e.notes ?? "" },
    { header: "Override reason", width: 24, value: (e) => e.overrideReason ?? "" },
    { header: "Recorded by", width: 20, value: (e) => e.createdByName },
  ];
  if (m.filter.sites.length > 1) cols.splice(1, 0, { header: "Site", width: 20, value: (e) => e.site.name });
  if (m.filter.status !== "active") cols.push({ header: "Voided", width: 30, value: (e) => (e.voidedAt ? `${pretty(e.voidedAt)} — ${e.voidReason ?? ""}` : "") });
  return cols;
}

export function entriesCsv(m: ExportMeta, items: EntryRow[]): Buffer {
  const cols = columns(m);
  const cell = (v: unknown) => {
    const s = safe(v == null ? "" : String(v));
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => cell(c.header)).join(","), ...items.map((e) => cols.map((c) => cell(c.value(e))).join(","))];
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join("\r\n") + "\r\n", "utf8")]);
}

export async function entriesXlsx(m: ExportMeta, items: EntryRow[]): Promise<Buffer> {
  const cols = columns(m);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lantern Forms";
  wb.created = m.generatedAt;
  const ws = wb.addWorksheet("Hot Foods", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.getCell("A1").value = `Hot Foods entries · ${scope(m)} · ${rangeLabel(m.filter)}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = `${items.length} entries · ${items.reduce((n, e) => n + e.mealCount, 0)} meals${m.filter.q ? ` matching “${m.filter.q}”` : ""} · exported ${stamp(m.generatedAt)} by ${m.generatedBy}`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6A7189" } };
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  ws.addTable({
    name: "HotFoods",
    ref: "A3",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows: items.length ? items.map((e) => cols.map((c) => { const v = c.value(e); return typeof v === "string" ? safe(v) : v; })) : [cols.map(() => null)],
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function newDoc(title: string) {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true, info: { Title: title, Author: "Lantern Forms" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, done };
}

function footer(doc: PDFKit.PDFDocument) {
  const range = doc.bufferedPageRange();
  const left = doc.page.margins.left;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const width = doc.page.width - left - doc.page.margins.right;
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - margin + 10;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text("Confidential — resident information. Do not leave unattended.", left, y, { width: width / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: "right", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
}

export function entriesPdf(m: ExportMeta, items: EntryRow[]): Promise<Buffer> {
  const title = `Hot Foods — ${scope(m)} — ${rangeLabel(m.filter)}`;
  const { doc, done } = newDoc(title);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 6;
  const multi = m.filter.sites.length > 1;
  const cols = [
    { header: "Date", w: 100, v: (e: EntryRow) => pretty(e.occurredAt) },
    ...(multi ? [{ header: "Site", w: 95, v: (e: EntryRow) => e.site.name }] : []),
    { header: "Resident", w: 130, v: (e: EntryRow) => e.tenantName },
    { header: "Room", w: 45, v: (e: EntryRow) => e.unit ?? "" },
    { header: "Items", w: 0, v: itemsText },
    { header: "Meals", w: 40, v: (e: EntryRow) => String(e.mealCount) },
    { header: "Recorded by", w: 95, v: (e: EntryRow) => e.createdByName + (e.voidedAt ? " (void)" : "") },
  ];
  const itemsCol = cols.find((c) => c.header === "Items")!;
  itemsCol.w = width - cols.reduce((n, c) => n + c.w, 0);
  const ROW = 17;

  const head = () => {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(15).text(title, left, doc.page.margins.top, { width });
    doc.fillColor(MUTED).font("Helvetica").fontSize(9)
      .text(`${items.length} entries · ${items.reduce((n, e) => n + e.mealCount, 0)} meals${m.filter.q ? ` matching “${m.filter.q}”` : ""} · printed ${stamp(m.generatedAt)} by ${m.generatedBy}`, { width });
    doc.moveDown(0.8);
    const y = doc.y;
    let x = left;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
    for (const c of cols) {
      doc.text(c.header.toUpperCase(), x + 3, y, { width: c.w - 6, lineBreak: false });
      x += c.w;
    }
    doc.moveTo(left, y + 11).lineTo(left + width, y + 11).lineWidth(0.8).strokeColor(MUTED).stroke();
    doc.y = y + 15;
  };

  head();
  if (items.length === 0) doc.fillColor(MUTED).font("Helvetica").fontSize(11).text("No entries match this selection.", left, doc.y + 10);
  items.forEach((e, i) => {
    if (doc.y + ROW > bottom()) {
      doc.addPage();
      head();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(left, y - 3, width, ROW).fill("#f6f8fb");
    let x = left;
    for (const c of cols) {
      doc.fillColor(e.voidedAt ? MUTED : INK).font(c.header === "Resident" ? "Helvetica-Bold" : "Helvetica").fontSize(9)
        .text(c.v(e), x + 3, y, { width: c.w - 6, height: ROW - 4, lineBreak: false, ellipsis: true });
      x += c.w;
    }
    doc.y = y + ROW;
  });
  footer(doc);
  doc.end();
  return done;
}

/** One entry as a signed receipt. */
export function entryPdf(e: EntryDetail): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: `Hot Foods — ${e.tenantName}`, Author: "Lantern Forms" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text("Hot Foods");
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`${e.site.name} · ${pretty(e.occurredAt)} · Recorded by ${e.createdByName}`);
  if (e.voidedAt) doc.moveDown(0.5).fillColor("#b42318").font("Helvetica-Bold").text(`VOID — ${pretty(e.voidedAt)} by ${e.voidedByName ?? "—"}: ${e.voidReason ?? ""}`, { width });
  doc.moveDown(1.2);
  const row = (k: string, v: string) => {
    const y = doc.y;
    doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(k, left, y, { width: 130 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(v || "—", left + 140, y, { width: width - 140 });
    doc.moveDown(0.6);
  };
  row("Resident", e.tenantName);
  row("Room", e.unit ?? "");
  row("Items", e.items.map((i) => `${i.itemName} × ${i.quantity}`).join("\n"));
  row("Meals", String(e.mealCount));
  if (e.notes) row("Notes", e.notes);
  if (e.overrideReason) row("Override reason", e.overrideReason);
  doc.moveDown(1);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text("Resident signature", left);
  const png = Buffer.from(e.signature.slice("data:image/png;base64,".length), "base64");
  const y = doc.y + 6;
  doc.rect(left, y, width, 140).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.image(png, left + 8, y + 8, { fit: [width - 16, 124], align: "center", valign: "center" });
  doc.end();
  return done;
}

// ── Report ───────────────────────────────────────────────────────────────

export async function reportXlsx(m: ExportMeta, r: HotFoodReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Lantern Forms";
  wb.created = m.generatedAt;

  const summary = wb.addWorksheet("Summary");
  summary.getColumn(1).width = 28;
  summary.getColumn(2).width = 18;
  summary.addRow([`Hot Foods report · ${scope(m)}`]).font = { bold: true, size: 14 };
  summary.addRow([rangeLabel(r)]);
  summary.addRow([`Exported ${stamp(m.generatedAt)} by ${m.generatedBy}`]).font = { italic: true, color: { argb: "FF6A7189" } };
  summary.addRow([]);
  const t = r.totals;
  for (const [k, v] of [
    ["Meals served", t.meals], ["Entries", t.entries], ["Residents served", t.residents], ["Average meals per day", Math.round(t.avgMealsPerDay * 10) / 10],
    ["Over-limit overrides", t.overrides], ["Voided entries (not counted)", t.voided], ["Days in range", t.days],
  ] as const) summary.addRow([k, v]);

  const sheet = (name: string, headers: string[], rows: (string | number)[][], widths: number[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.addTable({
      name: name.replace(/\W/g, ""),
      ref: "A1",
      headerRow: true,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: headers.map((h) => ({ name: h, filterButton: true })),
      rows: rows.length ? rows : [headers.map(() => "")],
    });
  };
  sheet("By day", ["Date", "Entries", "Meals"], r.byDay.map((d) => [d.day, d.entries, d.meals]), [14, 10, 10]);
  sheet("By site", ["Site", "Entries", "Meals", "Residents"], r.bySite.map((s) => [s.name, s.entries, s.meals, s.residents]), [26, 10, 10, 12]);
  sheet("By meal type", ["Meal type", "Quantity"], r.byItem.map((i) => [safe(i.name), i.quantity]), [28, 12]);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  sheet("By hour", ["Hour", ...days], Array.from({ length: 24 }, (_, h) => [hourLabel(h), ...days.map((_d, w) => r.heat[w][h])]), [10, 8, 8, 8, 8, 8, 8, 8]);
  sheet("By staff", ["Recorded by", "Entries"], r.byStaff.map((s) => [safe(s.name), s.entries]), [28, 10]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The Reports tab on paper: headline numbers, then each chart redrawn with PDF primitives. */
export function reportPdf(m: ExportMeta, r: HotFoodReport): Promise<Buffer> {
  const title = `Hot Foods report — ${scope(m)}`;
  const { doc, done } = newDoc(title);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 6;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(17).text(title, left, doc.page.margins.top, { width });
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`${rangeLabel(r)} · printed ${stamp(m.generatedAt)} by ${m.generatedBy}`, { width });
  doc.moveDown(1);

  // Stat tiles.
  const t = r.totals;
  const tiles: [string, string][] = [
    ["Meals served", fmt(t.meals)], ["Entries", fmt(t.entries)], ["Residents served", fmt(t.residents)],
    ["Meals per day", (Math.round(t.avgMealsPerDay * 10) / 10).toString()], ["Over-limit overrides", fmt(t.overrides)],
  ];
  const tw = (width - 12 * (tiles.length - 1)) / tiles.length;
  const ty = doc.y;
  tiles.forEach(([k, v], i) => {
    const x = left + i * (tw + 12);
    doc.roundedRect(x, ty, tw, 54, 6).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(k.toUpperCase(), x + 10, ty + 9, { width: tw - 20, lineBreak: false });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(v, x + 10, ty + 23, { width: tw - 20, lineBreak: false });
  });
  doc.y = ty + 72;

  const heading = (text: string, need: number) => {
    if (doc.y + need > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(text, left, doc.y, { width });
    doc.moveDown(0.4);
  };

  /** Swatch + label row; every color on a chart is named. */
  const legend = (items: { label: string; color: string }[]) => {
    let x = left;
    const y = doc.y;
    doc.font("Helvetica").fontSize(8.5);
    for (const it of items) {
      const w = doc.widthOfString(it.label) + 22;
      if (x + w > left + width) break;
      doc.roundedRect(x, y + 1, 8, 8, 1.5).fill(it.color);
      doc.fillColor(MUTED).text(it.label, x + 12, y, { lineBreak: false });
      x += w;
    }
    doc.y = y + 16;
  };

  // Meals per day: vertical bars, stacked by meal type in slot order.
  {
    const h = 170;
    heading("Meals per day", h + 56);
    if (r.series.length > 1) legend(r.series.map((s) => ({ label: s.name, color: slotHex(s.slot) })));
    const top = doc.y;
    const max = Math.max(1, ...r.byDay.map((d) => d.meals));
    const axisW = 34;
    const plotW = width - axisW;
    const step = plotW / Math.max(1, r.byDay.length);
    const barW = Math.max(1, Math.min(22, step - 2));
    const ticks = niceTicks(max);
    doc.font("Helvetica").fontSize(7.5);
    for (const tv of ticks) {
      const y = top + h - (tv / ticks[ticks.length - 1]) * h;
      doc.moveTo(left + axisW, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(LINE).stroke();
      doc.fillColor(MUTED).text(fmt(tv), left, y - 4, { width: axisW - 6, align: "right", lineBreak: false });
    }
    const scaleMax = ticks[ticks.length - 1];
    r.byDay.forEach((d, i) => {
      if (!d.meals) return;
      const x = left + axisW + i * step + (step - barW) / 2;
      let acc = 0;
      const segs = r.series.filter((s) => d.parts[s.key]);
      segs.forEach((s, j) => {
        const v = d.parts[s.key];
        const y0 = top + h - (acc / scaleMax) * h;
        acc += v;
        const y1 = top + h - (acc / scaleMax) * h;
        // A 1pt paper-white gap between segments, so neighbours never merge.
        const gap = j === segs.length - 1 ? 0 : 1;
        doc.rect(x, y1 + gap, barW, Math.max(0.3, y0 - y1 - gap)).fill(slotHex(s.slot));
      });
    });
    // Label about eight days along the axis, never every bar.
    const every = Math.max(1, Math.ceil(r.byDay.length / 8));
    r.byDay.forEach((d, i) => {
      if (i % every) return;
      doc.fillColor(MUTED).fontSize(7.5).text(dayLabel(d.day, { month: "short", day: "numeric" }), left + axisW + i * step - 20 + step / 2, top + h + 4, { width: 40, align: "center", lineBreak: false });
    });
    doc.y = top + h + 24;
  }

  // Horizontal bar lists.
  const hbars = (label: string, rows: { name: string; value: number; note?: string; color?: string }[], legendItems?: { label: string; color: string }[]) => {
    if (rows.length === 0) return;
    const ROW = 16;
    heading(label, 46 + Math.min(rows.length, 6) * ROW);
    if (legendItems && legendItems.length > 1) legend(legendItems);
    const max = Math.max(1, ...rows.map((x) => x.value));
    const nameW = 150;
    const valW = 90;
    const barMax = width - nameW - valW;
    for (const row of rows) {
      if (doc.y + ROW > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
      const y = doc.y;
      doc.fillColor(INK).font("Helvetica").fontSize(9).text(row.name, left, y + 2, { width: nameW - 8, lineBreak: false, ellipsis: true });
      doc.rect(left + nameW, y + 2, Math.max(1, (row.value / max) * barMax), ROW - 6).fill(row.color ?? BAR);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(`${fmt(row.value)}${row.note ? ` · ${row.note}` : ""}`, left + nameW + barMax + 6, y + 2, { width: valW - 6, lineBreak: false });
      doc.y = y + ROW;
    }
    doc.moveDown(0.8);
  };
  if (r.sites.length > 1) {
    const shown = r.bySite.filter((s) => s.meals > 0);
    const types = [...new Set(shown.map((s) => siteType(s.siteType)))];
    hbars("Meals by site", shown.map((s) => ({ name: s.name, value: s.meals, note: `${fmt(s.residents)} res.`, color: siteType(s.siteType).color })), types.map((t) => ({ label: t.label, color: t.color })));
  }
  hbars("Meals by type", r.byItem.map((i) => ({ name: i.name, value: i.quantity, color: slotHex(i.slot) })));

  // When meals are served: weekday × hour heat grid over the hours in use.
  {
    const used = Array.from({ length: 24 }, (_, h) => h).filter((h) => r.heat.some((row) => row[h] > 0));
    if (used.length) {
      const hours = Array.from({ length: used[used.length - 1] - used[0] + 1 }, (_, i) => used[0] + i);
      const cell = Math.min(34, (width - 40) / hours.length);
      heading("When meals are served", 7 * 18 + 54);
      doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text("Meals by weekday and hour. Darker blue means more meals (scale below).", left, doc.y, { width });
      doc.moveDown(0.4);
      const top = doc.y;
      const max = Math.max(1, ...r.heat.flat());
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      days.forEach((d, w) => {
        const y = top + w * 18;
        doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(d, left, y + 4, { width: 34, lineBreak: false });
        hours.forEach((h, i) => {
          const v = r.heat[w][h];
          const x = left + 40 + i * cell;
          doc.rect(x + 1, y + 1, cell - 2, 16).fill(v ? SEQ[Math.min(SEQ.length - 1, Math.max(0, Math.ceil((v / max) * SEQ.length) - 1))] : "#f3f5f9");
        });
      });
      hours.forEach((h, i) => {
        if (i % 2) return;
        doc.fillColor(MUTED).fontSize(7).text(hourLabel(h), left + 40 + i * cell - 6, top + 7 * 18 + 3, { width: cell + 12, align: "center", lineBreak: false });
      });
      // Scale key: Fewer ▢▢▢▢▢▢▢ More (max).
      const ky = top + 7 * 18 + 18;
      doc.fillColor(MUTED).fontSize(7.5).text("Fewer", left + 40, ky + 1, { lineBreak: false });
      SEQ.forEach((c, i) => doc.rect(left + 70 + i * 14, ky, 12, 9).fill(c));
      doc.fillColor(MUTED).fontSize(7.5).text(`More (${fmt(max)} meals an hour)`, left + 70 + SEQ.length * 14 + 4, ky + 1, { lineBreak: false });
      doc.y = ky + 22;
    }
  }

  // Each person's bar wears their profile color (the avatar default navy when none is set).
  hbars("Entries by staff member", r.byStaff.map((s) => ({ name: s.name, value: s.entries, color: s.avatarColor ?? AVATAR_DEFAULT })));
  if (t.voided) doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(`${fmt(t.voided)} voided ${t.voided === 1 ? "entry is" : "entries are"} excluded from every figure.`, left, doc.y, { width });

  footer(doc);
  doc.end();
  return done;
}

/** 0 and three or four round steps up to at least `max`. */
function niceTicks(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Whole meals only: a scale of 0, 0.25, 0.5… would print as 0, 0, 1.
  const step = Math.max(1, [1, 2, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag);
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}
