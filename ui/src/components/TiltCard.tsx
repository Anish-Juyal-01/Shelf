import { useEffect, useRef, type ReactNode } from "react";

/**
 * A card that turns in 3D toward the cursor, wherever it is on the page, with a glare that slides across its face
 * like light catching glossy print. Follows the cursor across the card, or across the whole window more gently, in
 * every direction; settles back flat when the cursor leaves the window. Driven by CSS variables, so moving the mouse
 * never re-renders React.
 */
export function TiltCard({ children, rest = { x: 0, y: 0 }, max = 16, className }: {
  children: ReactNode;
  /** Resting angle in degrees. */
  rest?: { x: number; y: number };
  /** Furthest it turns from rest, in degrees. */
  max?: number;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = card.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const set = (rx: number, ry: number, gx: number, gy: number, glare: number) => {
      el.style.setProperty("--rx", `${rx}deg`);
      el.style.setProperty("--ry", `${ry}deg`);
      el.style.setProperty("--gx", `${gx}%`);
      el.style.setProperty("--gy", `${gy}%`);
      el.style.setProperty("--glare", String(glare));
    };
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        // Over the card: follow the cursor across the card itself, fully. Anywhere else: follow where the cursor is
        // in the window (left half turns it left, right half right), more gently. Either way it's symmetric.
        const cx = over ? clamp(((e.clientX - r.left) / r.width) * 2 - 1) : clamp((e.clientX / window.innerWidth) * 2 - 1);
        const cy = over ? clamp(((e.clientY - r.top) / r.height) * 2 - 1) : clamp((e.clientY / window.innerHeight) * 2 - 1);
        const k = over ? 1 : 0.5;
        set(rest.x - cy * max * k, rest.y + cx * max * k, 50 + cx * 55, 50 + cy * 55, over ? 0.55 : 0.25);
      });
    };
    const leave = () => set(rest.x, rest.y, 30, 20, 0.18);
    leave();
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [rest.x, rest.y, max]);

  return (
    <div className={className} style={{ perspective: 1100 }}>
      <div
        ref={card}
        className="relative rounded-[20px]"
        style={{
          transform: `rotateX(var(--rx, ${rest.x}deg)) rotateY(var(--ry, ${rest.y}deg))`,
          transformStyle: "preserve-3d",
          transition: "transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      >
        {children}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light transition-opacity duration-300"
          style={{
            opacity: "var(--glare, 0.18)",
            background: "radial-gradient(circle at var(--gx, 30%) var(--gy, 20%), rgb(255 255 255 / 0.95), rgb(255 255 255 / 0.25) 28%, transparent 60%)",
          }}
        />
      </div>
    </div>
  );
}
