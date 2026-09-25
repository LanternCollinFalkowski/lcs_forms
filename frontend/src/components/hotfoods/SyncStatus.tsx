import { useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetHeader } from "@/components/ui/sheet";
import { discardHotFood, kick, retryHotFoods, useHotFoodsQueue, type QueuedEntry } from "@/lib/hotFoodsQueue";
import { cn } from "@/lib/utils";

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The header pill for the device's upload queue: green when everything is on
 * the server, amber while entries wait, red when the server refused one and a
 * person has to decide. Tapping it lists what's still on the device.
 */
export function SyncStatus() {
  const q = useHotFoodsQueue();
  const [open, setOpen] = useState(false);
  const waiting = q.pending.length;
  const failed = q.failed.length;

  const pill = failed
    ? { tone: "bg-status-redBg text-status-redText", icon: <AlertTriangle className="h-4 w-4" />, label: `${failed} need${failed === 1 ? "s" : ""} attention` }
    : waiting
      ? {
          tone: "bg-status-amberBg text-status-amberText",
          icon: q.syncing && q.online ? <Loader2 className="h-4 w-4 animate-spin" /> : q.online ? <UploadCloud className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />,
          label: q.online ? `${waiting} uploading` : `Offline · ${waiting} saved here`,
        }
      : q.online
        ? { tone: "bg-status-greenBg text-status-greenText", icon: <CheckCircle2 className="h-4 w-4" />, label: "All uploaded" }
        : { tone: "bg-subtle text-muted", icon: <CloudOff className="h-4 w-4" />, label: "Offline" };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("flex min-h-[36px] items-center gap-1.5 rounded-pill px-3 text-[12.5px] font-bold tabular", pill.tone)}
        aria-label={`Upload status: ${pill.label}`}
      >
        {pill.icon}
        <span className="whitespace-nowrap">{pill.label}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby={undefined} className="md:mx-auto md:max-w-[560px]">
          <SheetHeader
            title="Saved on this device"
            action={
              <SheetClose className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-subtle2" aria-label="Close">
                <X className="h-5 w-5" />
              </SheetClose>
            }
          />
          <SheetBody>
            <p className="text-[13.5px] text-muted">
              Every entry is saved on this device the moment it's signed, then uploaded. If the internet drops, keep serving — entries upload on their own when it's back.
              {!q.durable && <strong className="mt-2 block text-status-redText">This browser can't store entries permanently. Don't close this tab until everything has uploaded.</strong>}
            </p>

            {failed > 0 && (
              <Group title="The server refused these" hint="Usually the resident was moved off this site's roster, or a meal type was removed. Fix that and retry, or discard if it was a mistake.">
                {q.failed.map((i) => <Row key={i.clientId} item={i} failed />)}
              </Group>
            )}
            {waiting > 0 && (
              <Group title={q.online ? "Uploading" : "Waiting for internet"}>
                {q.pending.map((i) => <Row key={i.clientId} item={i} />)}
              </Group>
            )}
            {q.others.length > 0 && (
              <Group title="Recorded by someone else" hint="These upload when the person who recorded them signs in on this device.">
                {q.others.map((i) => <Row key={i.clientId} item={i} readOnly />)}
              </Group>
            )}
            {!failed && !waiting && !q.others.length && (
              <p className="mt-6 flex items-center justify-center gap-2 text-[14px] font-semibold text-status-greenText">
                <CheckCircle2 className="h-5 w-5" /> Everything is uploaded.
              </p>
            )}
          </SheetBody>
          {(failed > 0 || waiting > 0) && (
            <SheetFooter className="pb-3">
              <Button className="min-h-[52px] flex-1 text-[15px]" onClick={() => (failed ? retryHotFoods() : void kick())} disabled={q.syncing}>
                <RefreshCw className={cn("h-4 w-4", q.syncing && "animate-spin")} /> {failed ? "Retry all" : "Upload now"}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{title}</h3>
      {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      <ul className="mt-2 divide-y divide-hairline rounded-card border border-hairline">{children}</ul>
    </section>
  );
}

function Row({ item, failed, readOnly }: { item: QueuedEntry; failed?: boolean; readOnly?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-ink">{item.tenantName}</span>
        <span className="block text-[12.5px] text-muted">
          {item.unit ? `Room ${item.unit} · ` : ""}
          {item.mealCount} meal{item.mealCount === 1 ? "" : "s"} · {time(item.savedAt)}
        </span>
        {failed && item.error && <span className="mt-0.5 block text-[12.5px] font-semibold text-status-redText">{item.error}</span>}
      </span>
      {failed && !readOnly && (
        <button
          type="button"
          onClick={() => {
            if (confirm(`Discard ${item.tenantName}'s signed entry? It will not be recorded anywhere.`)) discardHotFood(item.clientId);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-status-redText hover:bg-status-redBg"
          aria-label={`Discard ${item.tenantName}'s entry`}
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </button>
      )}
    </li>
  );
}
