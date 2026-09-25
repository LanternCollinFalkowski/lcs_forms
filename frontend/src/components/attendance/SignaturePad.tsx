import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SignaturePadHandle {
  clear: () => void;
  /** PNG data URL, or null if nothing has been drawn. */
  toDataURL: () => string | null;
  isEmpty: () => boolean;
}

/**
 * A signature capture surface: draw with a finger, mouse or pen and get a PNG
 * data URL back. Plain canvas + Pointer Events rather than a library — one
 * event model covers touch, mouse and pen, and a signature is just a stroke,
 * nothing a dedicated package earns its weight for.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { className?: string; onChangeEmpty?: (empty: boolean) => void }>(
  function SignaturePad({ className, onChangeEmpty }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);
    const [empty, setEmptyState] = useState(true);
    const setEmpty = (v: boolean) => {
      setEmptyState(v);
      onChangeEmpty?.(v);
    };

  // Size the backing store to the element's real pixels (including device
  // pixel ratio) so strokes stay crisp instead of blurring on a phone.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return;
      const old = document.createElement("canvas");
      old.width = canvas.width;
      old.height = canvas.height;
      if (old.width && old.height) old.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#232a3a";
        if (old.width && old.height) ctx.drawImage(old, 0, 0, old.width, old.height, 0, 0, rect.width, rect.height);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      setEmpty(true);
    },
    toDataURL() {
      return empty ? null : (canvasRef.current?.toDataURL("image/png") ?? null);
    },
    isEmpty() {
      return empty;
    },
  }));

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.25, 0, Math.PI * 2);
      ctx.fillStyle = "#232a3a";
      ctx.fill();
      setEmpty(false);
    }
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = point(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      setEmpty(false);
    }
    last.current = p;
  }
  function onUp() {
    drawing.current = false;
    last.current = null;
  }

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
      className={cn("touch-none rounded-card border border-hairline bg-white", className)}
    />
  );
});
