import clsx from "clsx";
import { Check, FolderOpen, X } from "lucide-react";
import { useState } from "react";
import { bridge } from "../bridge/bridge";
import type { DetectionView } from "../bridge/protocol";
import { Button, Empty, IconButton, PageHead, Stamp } from "../components/ui";
import { bytes, relative } from "../lib/format";
import { useApp } from "../store/store";

const originLabel: Record<DetectionView["origin"], string> = {
  scan: "Found in a folder",
  installed_apps: "Windows installed apps",
  runtime: "Seen running",
};

export function Review() {
  const review = useApp((s) => s.state!.review);
  return (
    <div className="mx-auto max-w-[980px] px-8 pt-7 pb-16">
      <PageHead
        title="Needs a look"
        sub={review.length ? `${review.length} possible game${review.length === 1 ? "" : "s"} Shelf wasn't sure about` : "Nothing waiting"}
      />
      {review.length === 0 ? (
        <Empty title="The returns desk is clear.">
          When Shelf finds something that might be a game but isn't sure — or spots an unknown program running
          fullscreen — it waits here for you to decide.
        </Empty>
      ) : (
        <ul className="space-y-5">
          {review.map((d) => <DetectionCard key={d.id} d={d} />)}
        </ul>
      )}
    </div>
  );
}

function DetectionCard({ d }: { d: DetectionView }) {
  const [title, setTitle] = useState(d.title);
  return (
    <li className="slip rounded-[3px] px-6 pt-2 pb-5">
      <div className="flex h-[38px] items-center justify-between">
        <span className="caps text-ink-3">
          {originLabel[d.origin]} · {relative(d.found)}
        </span>
        <Confidence value={d.confidence} />
      </div>
      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-[260px] flex-1">
          <label className="caps text-ink-4" htmlFor={`t${d.id}`}>Title</label>
          <input
            id={`t${d.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="font-display mt-0.5 block h-10 w-full rounded-[4px] border border-transparent bg-transparent px-1 -ml-1 text-[30px] text-ink hover:border-rule focus:border-rule-strong focus:bg-surface focus:outline-none"
          />
          <p className="typed mt-1 flex items-center gap-1 text-[11.5px] break-all text-ink-3">
            {d.exe ?? d.path}
            <IconButton label="Open folder" className="size-6" onClick={() => bridge.send({ type: "openFolder", path: d.path })}>
              <FolderOpen size={13} />
            </IconButton>
          </p>
        </div>
        <div className="typed text-right text-[12px] text-ink-2">{bytes(d.sizeBytes)}</div>
      </div>
      <ul className="typed mt-3 space-y-1 text-[11.5px] text-ink-2">
        {d.signals.map((s) => (
          <li key={s} className={clsx(s.startsWith("-") && "text-stamp-red")}>{s}</li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button tone="primary" icon={<Check size={15} />} onClick={() => bridge.send({ type: "accept", id: d.id, title: title.trim() && title.trim() !== d.title ? title.trim() : undefined })}>
          Add to shelf
        </Button>
        <Button tone="quiet" icon={<X size={15} />} onClick={() => bridge.send({ type: "reject", id: d.id })}>
          Not a game
        </Button>
      </div>
    </li>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-2" title="How sure Shelf is that this is a game">
      <span className="typed text-[11px] text-ink-3">{value}% sure</span>
      <span className="flex gap-[2px]">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={clsx("h-3 w-1.5 rounded-[1px]", i < Math.round(value / 10) ? (value >= 50 ? "bg-accent" : "bg-warn") : "bg-rule")} />
        ))}
      </span>
      {value < 40 && <Stamp size="xs" tone="red" tilt={0}>Doubtful</Stamp>}
    </span>
  );
}
