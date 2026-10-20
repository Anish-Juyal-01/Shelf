import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GameView } from "../../bridge/protocol";
import { Cover } from "../../components/Cover";
import { bytes } from "../../lib/format";
import { isOverdue } from "../../lib/library";
import { daysSince, type EndingProps } from "./shared";

// Fill the drive: every game is a cover that drops into a glass box — your C: drive — and piles up. The meter shows
// how full it is. Grab a cover and fling it out over the rim to "uninstall" it, or toss everything you haven't played
// in 90 days at once, and watch the space come back. A tiny hand-rolled physics loop: covers are circles to each
// other, the box is three walls, and the loop sleeps once the pile is still.

const GB = 1024 ** 3;
const DISK = 1200 * GB;
const SYSTEM = 170 * GB; // Windows, apps, everything that isn't a game
// Card width and collision radius: smaller on phones so the whole library still fits in the box.
let CW = 66;
let R = 37;
const GRAVITY = 2200;

interface Body { g: GameView; x: number; y: number; vx: number; vy: number; tilt: number; out: boolean; born: number }

/** Half the width and height a tilted card actually covers, so walls and floor stop the card, not just its middle. */
function extents(tiltDeg: number) {
  const t = (Math.abs(tiltDeg) * Math.PI) / 180, w = CW, h = CW * 1.5;
  return { hx: (w * Math.cos(t) + h * Math.sin(t)) / 2, hy: (w * Math.sin(t) + h * Math.cos(t)) / 2 };
}
const angle = (b: Body) => b.tilt + Math.max(-8, Math.min(8, b.vx * 0.02));

export function FillTheDrive({ games, faller, landed, slotRef, onOpen }: EndingProps) {
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<number, HTMLDivElement>());
  const bodies = useRef<Body[]>([]);
  const size = useRef({ w: 0, h: 0 });
  const drag = useRef<{ b: Body; px: number; py: number; t: number; moved: number } | null>(null);
  const wake = useRef<() => void>(() => {});
  const [ids, setIds] = useState<number[]>([]);
  const [freed, setFreed] = useState<GameView[]>([]);
  // The background is the colours of a game: the newcomer once it lands, then whichever game last left the drive.
  // Each new one fades in on top of the last (which stays put underneath), so it shifts straight from one to the
  // next and never through black.
  const [tints, setTints] = useState<{ g: GameView; k: number }[]>([]);
  const tintKey = useRef(0);
  const showTint = (g: GameView) => setTints((t) => (t.at(-1)?.g.id === g.id ? t : [...t, { g, k: ++tintKey.current }]));
  // Once a wash has fully faded in, everything under it is hidden and can go.
  const covered = (k: number) => setTints((t) => t.slice(Math.max(0, t.findIndex((x) => x.k === k))));
  useEffect(() => {
    if (landed) showTint(faller);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  const [, force] = useState(0);

  const jar = () => {
    const { w, h } = size.current;
    const small = w < 640;
    const jw = small ? w - 32 : Math.min(620, w * 0.72);
    return { l: w / 2 - jw / 2, r: w / 2 + jw / 2, top: h * (small ? 0.36 : 0.3), bottom: h - 24 };
  };

  const spawn = (g: GameView, x: number, y: number, vy = 0) => {
    bodies.current.push({ g, x, y, vx: (Math.random() - 0.5) * 60, vy, tilt: (Math.random() - 0.5) * 30, out: false, born: performance.now() });
  };

  // Fill the box with everything except the newcomer, staggered so they rain in.
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
      const small = el.clientWidth < 640;
      CW = small ? 44 : 66;
      R = small ? 25 : 37;
      if (bodies.current.length === 0 && size.current.w > 0) {
        const j = jar();
        games.filter((g) => g.id !== faller.id).forEach((g, i) => spawn(g, j.l + R + Math.random() * (j.r - j.l - 2 * R), j.top - 80 - i * 70));
        setIds(bodies.current.map((b) => b.g.id));
      }
      wake.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The newcomer drops in from the landing spot once it arrives.
  useEffect(() => {
    if (!landed || bodies.current.some((b) => b.g.id === faller.id) || size.current.w === 0) return;
    spawn(faller, size.current.w / 2, jar().top - 70, 200);
    setIds(bodies.current.map((b) => b.g.id));
    wake.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);

  // Physics loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let still = 0;
    const tick = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      const j = jar();
      const list = bodies.current;
      let energy = 0;
      for (const b of list) {
        if (drag.current?.b === b) continue;
        b.vy += GRAVITY * dt;
        b.vx *= 0.995;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < list.length; i++) {
          const a = list[i];
          if (a.out) continue;
          for (let k = i + 1; k < list.length; k++) {
            const c = list[k];
            if (c.out) continue;
            const dx = c.x - a.x, dy = c.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 >= 4 * R * R || d2 === 0) continue;
            const d = Math.sqrt(d2), push = (2 * R - d) / 2, nx = dx / d, ny = dy / d;
            const ad = drag.current?.b === a, cd = drag.current?.b === c;
            if (!ad) { a.x -= nx * push * (cd ? 2 : 1); a.y -= ny * push * (cd ? 2 : 1); }
            if (!cd) { c.x += nx * push * (ad ? 2 : 1); c.y += ny * push * (ad ? 2 : 1); }
            const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = rel * 0.55;
              if (!ad) { a.vx += imp * nx; a.vy += imp * ny; }
              if (!cd) { c.vx -= imp * nx; c.vy -= imp * ny; }
            }
          }
          // The box: floor and two walls (only for covers that are inside it).
          if (drag.current?.b === a) continue;
          const { hx, hy } = extents(angle(a));
          const pad = 6; // keep clear of the glass
          if (a.y + hy > j.bottom - pad) { a.y = j.bottom - pad - hy; a.vy *= -0.15; a.vx *= 0.9; }
          if (a.y + hy > j.top) {
            if (a.x - hx < j.l + pad) { a.x = j.l + pad + hx; a.vx *= -0.3; }
            if (a.x + hx > j.r - pad) { a.x = j.r - pad - hx; a.vx *= -0.3; }
          }
        }
      }
      for (const b of list) {
        if (!b.out && drag.current?.b !== b) energy += b.vx * b.vx + b.vy * b.vy;
        const el = els.current.get(b.g.id);
        if (el) el.style.transform = `translate(${b.x - CW / 2}px, ${b.y - CW * 0.75}px) rotate(${angle(b)}deg)`;
      }
      // Covers that left the drive fall away and are gone.
      const gone = list.filter((b) => b.out && b.y > size.current.h + 160);
      if (gone.length) {
        bodies.current = list.filter((b) => !gone.includes(b));
        setIds(bodies.current.map((b) => b.g.id));
      }
      still = energy < 400 * list.length && !drag.current && !list.some((b) => b.out) ? still + 1 : 0;
      raf = still > 90 ? 0 : requestAnimationFrame(tick);
    };
    wake.current = () => {
      if (!raf) { last = performance.now(); still = 0; raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toss = (b: Body) => {
    if (b.out) return;
    b.out = true;
    b.vy = Math.min(b.vy, -900 - Math.random() * 300);
    b.vx = (b.x < size.current.w / 2 ? -1 : 1) * (300 + Math.random() * 300);
    setFreed((f) => [...f, b.g]);
    showTint(b.g);
    wake.current();
  };

  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (b: Body) => (e: React.PointerEvent) => {
    if (b.out) return;
    const p = local(e);
    drag.current = { b, px: p.x, py: p.y, t: performance.now(), moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    wake.current();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e), now = performance.now(), dt = Math.max(8, now - d.t) / 1000;
    d.b.vx = (p.x - d.px) / dt;
    d.b.vy = (p.y - d.py) / dt;
    d.b.x += p.x - d.px;
    d.b.y += p.y - d.py;
    d.moved += Math.abs(p.x - d.px) + Math.abs(p.y - d.py);
    d.px = p.x; d.py = p.y; d.t = now;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved < 6) { onOpen(d.b.g); return; }
    // Dropped above the rim, or flung upward hard: it leaves the drive.
    const j = jar();
    if (d.b.y < j.top - 10 || d.b.vy < -1400 || d.b.x < j.l || d.b.x > j.r) toss(d.b);
  };

  const inDrive = bodies.current.filter((b) => !b.out);
  const used = SYSTEM + inDrive.reduce((a, b) => a + b.g.sizeBytes, 0);
  const pct = Math.min(1, used / DISK);
  const idle = inDrive.filter((b) => isOverdue(b.g));
  const j = size.current.w ? jar() : null;

  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 400); // keep the meter in step with the pile
    return () => clearInterval(t);
  }, []);

  return (
    <div ref={box} className="relative h-[min(580px,66svh)] touch-none overflow-hidden select-none"
      style={{ background: "radial-gradient(70% 80% at 12% 0%, #4b2c8f 0%, transparent 62%), radial-gradient(60% 70% at 92% 8%, #0e6b78 0%, transparent 60%), radial-gradient(90% 70% at 50% 115%, #8a2a5c 0%, transparent 62%), linear-gradient(180deg, #121530, #0b0d1c)" }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {/* the game's colours over the whole box: its cover, blurred into a wash and dimmed for the text */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {tints.map(({ g, k }) =>
          g.coverUrl ? (
            <img
              key={k}
              onAnimationEnd={() => covered(k)}
              src={g.coverUrl}
              alt=""
              className="site-tint absolute -inset-[25%] size-[150%] max-w-none object-cover"
              style={{ filter: "blur(80px) saturate(1.5) brightness(.6)" }}
            />
          ) : null,
        )}
      </div>
      <div aria-hidden className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: "radial-gradient(white 1px, transparent 1.2px)", backgroundSize: "22px 22px" }} />
      {j && (
        <>
          {/* the drive: a glass box with a fill line */}
          <div aria-hidden className="absolute rounded-b-[22px] border-x-2 border-b-2 border-white/25" style={{ left: j.l - 4, width: j.r - j.l + 8, top: j.top, height: j.bottom - j.top + 4, background: "linear-gradient(180deg, rgb(255 255 255 / .03), rgb(255 255 255 / .09))", backdropFilter: "blur(2px)", boxShadow: "inset 0 -30px 60px -30px rgb(255 255 255 / .12)" }}>
            <span className="typed absolute top-2 right-3 text-[11px] transition-colors" style={{ color: pct > 0.9 ? "var(--u-red)" : "rgb(255 255 255 / .6)" }}>{Math.round(pct * 100)}% full</span>
          </div>
        </>
      )}
      {/* where the falling game lands */}
      {!landed && <div ref={slotRef} className="absolute left-1/2 -translate-x-1/2" style={{ top: (j?.top ?? 160) - 70 - CW * 0.75, width: CW, aspectRatio: "2 / 3" }} />}

      {ids.map((id) => {
        const b = bodies.current.find((x) => x.g.id === id);
        if (!b) return null;
        return (
          <div
            key={id}
            ref={(el) => { if (el) els.current.set(id, el); else els.current.delete(id); }}
            onPointerDown={down(b)}
            title={`${b.g.title} · ${bytes(b.g.sizeBytes)}`}
            className="absolute top-0 left-0 cursor-grab active:cursor-grabbing"
            style={{ width: CW, willChange: "transform" }}
          >
            <Cover title={b.g.title} url={b.g.coverUrl} bare className={`rounded-[7px] shadow-[0_10px_18px_-8px_rgb(0_0_0/0.8)] ring-1 ${isOverdue(b.g) ? "ring-[var(--u-red)]/60" : "ring-white/15"}`} />
          </div>
        );
      })}

      {/* the readout */}
      <div className="pointer-events-none absolute top-4 left-5 text-white">
        <div className="caps text-white/60">C: drive</div>
        <div className="font-display mt-1 text-[34px] leading-none max-sm:text-[26px]">{bytes(used)} <span className="text-[20px] text-white/50">of {bytes(DISK)}</span></div>
        <div className="mt-3 h-1.5 w-56 overflow-hidden max-sm:w-36 rounded-full bg-white/15">
          <div className="h-full rounded-full transition-[width,background] duration-500" style={{ width: `${pct * 100}%`, background: pct > 0.9 ? "var(--u-red)" : "var(--ok)" }} />
        </div>
        <div className="typed mt-2 text-[11.5px] text-white/60">
          {freed.length ? <span className="text-[#7ee0a0]">freed {bytes(freed.reduce((a, g) => a + g.sizeBytes, 0))} · </span> : null}
          <span className="max-sm:hidden">red edge = not played in 90 days</span>
        </div>
      </div>
      <div className="absolute top-4 right-5 flex flex-col items-end gap-2">
        {idle.length > 0 && <button
          onClick={() => idle.forEach((b, i) => window.setTimeout(() => toss(b), i * 90))}
          className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black transition-opacity disabled:cursor-default disabled:opacity-40"
        >
          <Trash2 className="size-3.5" /> Toss {idle.length} idle game{idle.length === 1 ? "" : "s"}
        </button>}
        {freed.length > 0 && (
          <button
            onClick={() => {
              const j2 = jar();
              bodies.current = bodies.current.filter((b) => !freed.includes(b.g));
              freed.forEach((g, i) => spawn(g, j2.l + R + Math.random() * (j2.r - j2.l - 2 * R), -60 - i * 60));
              setFreed([]);
              setIds(bodies.current.map((b) => b.g.id));
              wake.current();
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-white/70 hover:text-white"
          >
            <RotateCcw className="size-3" /> put them back
          </button>
        )}
        <span className="caps mt-1 text-white/45 max-sm:hidden">drag a game out to uninstall it</span>
      </div>
      {freed.length > 0 && (
        <div className="absolute bottom-4 left-5 flex flex-wrap gap-1.5" style={{ maxWidth: Math.max(140, (j?.l ?? 200) - 40) }}>
          {freed.slice(-8).map((g) => (
            <span key={g.id} className="typed rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] text-white/70">
              {g.title.split(":")[0]} · {daysSince(g.lastPlayed) ?? "–"}d idle
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
