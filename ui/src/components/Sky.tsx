import { memo } from "react";

/**
 * A painted sky, procedurally: gradient + sun (or moon) glow, stars at night, and cumulus clouds made from soft
 * ellipses pushed through SVG turbulence so their edges billow. Static, so it renders once and costs nothing;
 * only the petals drift (transform/opacity animations, composited).
 */

/** Cloud banks: [left %, bottom %, width px, height px]. Deterministic so the sky never jumps between renders. */
const BACK: [number, number, number, number][] = [
  [-4, 16, 300, 120], [16, 20, 240, 96], [37, 14, 320, 128], [60, 19, 260, 104], [80, 15, 320, 124], [97, 21, 220, 90],
];
const FRONT: [number, number, number, number][] = [
  [-8, -10, 380, 170], [12, -13, 340, 150], [31, -14, 400, 180], [53, -11, 360, 160], [73, -14, 400, 180], [93, -10, 340, 160],
];

export const SkyBackdrop = memo(function SkyBackdrop() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      <CloudFilter />
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 42%, var(--sky-low) 78%, var(--sky-glow) 100%)" }}
      />
      {/* sun / moon glow */}
      <div className="absolute" style={{ right: "12%", top: "30%", width: 520, height: 520, transform: "translate(50%,-50%)", background: "radial-gradient(circle, color-mix(in oklab, var(--sky-glow) 85%, white) 0%, transparent 62%)", opacity: 0.9 }} />
      <Stars />
      <CloudBank clouds={BACK} opacity={0.7} scale={1} />
    </div>
  );
});

/** The front cloud bank, drawn above whatever floats in the sky (the wheel rises out of it). */
export const SkyFront = memo(function SkyFront() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <CloudBank clouds={FRONT} opacity={1} scale={1} />
      <Petals />
    </div>
  );
});

function CloudBank({ clouds, opacity, scale }: { clouds: [number, number, number, number][]; opacity: number; scale: number }) {
  return (
    <div className="absolute inset-0" style={{ filter: "url(#shelf-cloud)", opacity }}>
      {clouds.map(([left, bottom, w, h], i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${left}%`,
            bottom: `${bottom}%`,
            width: w * scale,
            height: h * scale,
            borderRadius: "50%",
            background: "radial-gradient(ellipse at 45% 30%, var(--cloud) 0%, var(--cloud) 38%, var(--cloud-shade) 78%, transparent 80%)",
          }}
        >
          {/* puffs on top of each cloud */}
          {[0.18, 0.45, 0.7].map((x, j) => (
            <div
              key={j}
              className="absolute rounded-full"
              style={{
                left: `${x * 100 - 18}%`,
                top: `${-28 + j * 9}%`,
                width: "42%",
                height: "62%",
                background: "radial-gradient(circle at 45% 35%, var(--cloud) 0%, var(--cloud) 42%, var(--cloud-shade) 80%, transparent 82%)",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CloudFilter() {
  return (
    <svg width="0" height="0" className="absolute">
      <filter id="shelf-cloud" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="60" xChannelSelector="R" yChannelSelector="G" result="billow" />
        <feGaussianBlur in="billow" stdDeviation="3" />
      </filter>
    </svg>
  );
}

const STAR_POINTS = Array.from({ length: 70 }, (_, i) => {
  const x = (i * 73.13) % 100;
  const y = (i * 37.71) % 60;
  const s = i % 7 === 0 ? 2 : 1;
  return `radial-gradient(${s}px ${s}px at ${x}% ${y}%, rgba(255,255,255,${i % 5 === 0 ? 0.95 : 0.6}), transparent)`;
}).join(",");

function Stars() {
  return <div className="absolute inset-0 hidden [:root[data-theme=dark]_&]:block" style={{ backgroundImage: STAR_POINTS }} />;
}

const PETAL_COLORS = ["var(--u-red)", "var(--u-yellow)", "var(--u-blue)", "#ffffff", "var(--u-red)", "var(--u-yellow)"];

function Petals() {
  return (
    <>
      <style>{`
        @keyframes shelf-petal {
          0% { transform: translate3d(0,0,0) rotate(0deg) rotateX(0deg); opacity: 0 }
          10% { opacity: .95 }
          90% { opacity: .9 }
          100% { transform: translate3d(var(--dx), var(--dy), 0) rotate(540deg) rotateX(720deg); opacity: 0 }
        }
      `}</style>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className="absolute block"
          style={{
            left: `${(i * 61) % 100}%`,
            top: `${(i * 23) % 55}%`,
            width: 7 + (i % 3) * 2,
            height: 4 + (i % 2) * 2,
            borderRadius: "60% 40%",
            background: PETAL_COLORS[i % PETAL_COLORS.length],
            ["--dx" as string]: `${-120 - (i % 4) * 60}px`,
            ["--dy" as string]: `${140 + (i % 5) * 40}px`,
            animation: `shelf-petal ${9 + (i % 5) * 2.5}s linear ${-(i * 1.7)}s infinite`,
          }}
        />
      ))}
    </>
  );
}
