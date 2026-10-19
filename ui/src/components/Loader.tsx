import { useEffect, useRef, useState } from "react";
import { useApp } from "../store/store";
import { Cover } from "./Cover";

/**
 * Start-up curtain. While Shelf connects and reads the library, a counter rolls 000 → 100 like an odometer (it
 * only reaches 100 once the real data has arrived) and a hand of covers is dealt up from below, flips face-up and
 * fans into an arch. Then the curtain lifts onto the sky. Skipped entirely with reduced motion.
 */
export function Loader() {
  const connected = useApp((s) => s.connected);
  const games = useApp((s) => s.state?.games);
  const [value, setValue] = useState(0);
  const [phase, setPhase] = useState<"count" | "fan" | "lift" | "gone">(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "gone" : "count",
  );
  const shown = useRef(0);

  // Counter: eases toward 92 while waiting, then runs to 100 once connected.
  useEffect(() => {
    if (phase === "gone") return;
    let raf = 0;
    const tick = () => {
      const target = connected ? 100 : 92;
      shown.current += (target - shown.current) * (connected ? 0.09 : 0.025);
      if (connected && target - shown.current < 0.6) shown.current = 100;
      setValue(Math.floor(shown.current));
      if (shown.current < 100) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, phase]);

  useEffect(() => {
    if (value >= 100 && phase === "count") setPhase("fan");
  }, [value, phase]);

  // Fan for a beat, then lift the curtain. Keyed on the phase itself so a re-render can't cancel it.
  useEffect(() => {
    if (phase === "fan") {
      const t = setTimeout(() => setPhase("lift"), 1100);
      return () => clearTimeout(t);
    }
    if (phase === "lift") {
      const t = setTimeout(() => setPhase("gone"), 850);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (phase === "gone") return null;
  const hand = (games ?? []).filter((g) => g.installed && !g.hidden).slice(0, 9);
  const n = Math.max(hand.length, 1);

  return (
    <div
      aria-live="polite"
      aria-label={`Loading your shelf, ${value}%`}
      className="fixed inset-0 z-[60] overflow-hidden bg-bg"
      style={{
        clipPath: phase === "lift" ? "inset(0 0 100% 0 round 0 0 40px 40px)" : "inset(0 0 0 0)",
        transition: "clip-path .8s cubic-bezier(.7,0,.2,1)",
      }}
    >
      <div className="font-display absolute top-6 left-8 text-[30px] leading-none text-ink">
        Shelf<span className="text-u-red">.</span>
      </div>
      <div className="absolute top-5 right-10 flex items-start text-ink">
        <Odometer value={value} />
        <span className="font-display mt-2 text-[28px]">%</span>
      </div>
      <p className="typed absolute right-10 top-[132px] text-[11px] text-ink-3">
        {connected ? "library ready" : "reading launchers and folders"}
      </p>

      {/* The hand of covers: dealt up, flipped, fanned. */}
      <div className="absolute left-1/2 bottom-[18%]" style={{ perspective: 1200 }}>
        {hand.map((g, i) => {
          const fan = phase !== "count";
          const spread = Math.min(16, 120 / n);
          const angle = (i - (n - 1) / 2) * spread;
          const delay = i * 70;
          return (
            <div
              key={g.id}
              className="absolute"
              style={{
                width: 120,
                left: -60,
                bottom: 0,
                transformOrigin: "50% 260%",
                transform: fan
                  ? `rotate(${angle}deg) translateY(-30px) rotateY(0deg)`
                  : value > 8 + i * 6
                    ? `rotate(${(i % 2 ? 1 : -1) * 2}deg) translateY(0) rotateY(180deg)`
                    : "translateY(110vh) rotateY(180deg)",
                transition: `transform ${fan ? 700 : 650}ms cubic-bezier(.2,.8,.2,1) ${fan ? delay : 0}ms`,
                transformStyle: "preserve-3d",
                zIndex: i,
              }}
            >
              {/* face */}
              <div style={{ backfaceVisibility: "hidden" }}>
                <Cover title={g.title} url={g.coverUrl} className="rounded-[9px] ring-1 ring-black/10" />
              </div>
              {/* back */}
              <div
                className="absolute inset-0 rounded-[9px] ring-1 ring-black/10"
                style={{
                  backfaceVisibility: "hidden",
                  transform: "rotateY(180deg)",
                  background: "repeating-linear-gradient(45deg, var(--u-red) 0 6px, var(--surface) 6px 12px)",
                  boxShadow: "inset 0 0 0 6px var(--surface)",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Three digit wheels that roll to the value, like a mechanical counter. */
function Odometer({ value }: { value: number }) {
  const digits = String(Math.min(100, value)).padStart(3, "0").split("").map(Number);
  return (
    <div className="font-display flex text-[104px] leading-none tabular-nums" aria-hidden>
      {digits.map((d, i) => (
        <span key={i} className="relative block h-[1em] w-[0.52em] overflow-hidden">
          <span className="absolute left-0 block transition-transform duration-300 ease-out" style={{ transform: `translateY(${-d}em)` }}>
            {Array.from({ length: 10 }, (_, k) => (
              <span key={k} className="block h-[1em] text-center">{k}</span>
            ))}
          </span>
        </span>
      ))}
    </div>
  );
}
