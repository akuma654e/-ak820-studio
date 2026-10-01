import { useEffect, useRef } from "react";
import { SIZE } from "../lib/imaging";

type Props = {
  previews: ImageData[];
  delays: number[];
  playing?: boolean;
  /** Arrastar para mover a imagem (deltas em pixels da tela de 128). */
  onPan?: (dx: number, dy: number) => void;
  onWheel?: (delta: number) => void;
  className?: string;
};

/** Desenha os quadros 128×128 em escala, com animação no tempo real. */
export function ScreenPreview({ previews, delays, playing = true, onPan, onWheel, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || previews.length === 0) return;
    const ctx = c.getContext("2d")!;
    let i = 0;
    let timer: number | undefined;
    const draw = () => {
      ctx.putImageData(previews[i], 0, 0);
      if (!playing || previews.length < 2) return;
      timer = window.setTimeout(() => {
        i = (i + 1) % previews.length;
        draw();
      }, Math.max(16, delays[i] ?? 100));
    };
    draw();
    return () => window.clearTimeout(timer);
  }, [previews, delays, playing]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !onWheel) return;
    const h = (ev: WheelEvent) => {
      ev.preventDefault();
      onWheel(ev.deltaY);
    };
    c.addEventListener("wheel", h, { passive: false });
    return () => c.removeEventListener("wheel", h);
  }, [onWheel]);

  return (
    <canvas
      ref={ref}
      width={SIZE}
      height={SIZE}
      className={className}
      style={{ cursor: onPan ? "grab" : undefined, touchAction: "none" }}
      onPointerDown={(ev) => {
        if (!onPan) return;
        (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
        drag.current = { x: ev.clientX, y: ev.clientY };
      }}
      onPointerMove={(ev) => {
        if (!onPan || !drag.current) return;
        const rect = (ev.target as HTMLElement).getBoundingClientRect();
        const scale = SIZE / rect.width;
        onPan((ev.clientX - drag.current.x) * scale, (ev.clientY - drag.current.y) * scale);
        drag.current = { x: ev.clientX, y: ev.clientY };
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
