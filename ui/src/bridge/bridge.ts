import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { HostMessage, UiMessage } from "./protocol";
import { createPreviewBridge } from "./previewBridge";

export interface Bridge {
  /** True in a plain browser (Vite dev / design review): sample data, not this PC's games. */
  readonly isPreview: boolean;
  send(message: UiMessage): void;
  /** Sends files dropped on the window; the host receives their real paths. */
  sendFiles(files: FileList): void;
  subscribe(handler: (message: HostMessage) => void): () => void;
  /**
   * Hosts that see file drops themselves (Tauri) report hover state here and send the paths on drop; the window's
   * own drag events don't fire there. Returns an unsubscribe function.
   */
  watchDrops?(onHover: (active: boolean) => void): () => void;
}

/** The Tauri host: messages go in through the `ui_message` command and come back as `host` events. */
function createTauriBridge(): Bridge {
  return {
    isPreview: false,
    send(message) {
      // Moving and resizing have to start inside the mouse-down, so they're done right here.
      if (message.type === "window" && message.action === "drag") {
        const w = getCurrentWindow();
        const edge = message.edge && message.edge !== "caption" ? RESIZE[message.edge] : undefined;
        void (edge ? w.startResizeDragging(edge) : w.startDragging());
        return;
      }
      void invoke("ui_message", { message });
    },
    // Drops come through watchDrops (Tauri's own drag-drop event, with real paths).
    sendFiles: () => {},
    watchDrops(onHover) {
      const off = getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") onHover(true);
        else onHover(false);
        if (e.payload.type === "drop" && e.payload.paths.length)
          void invoke("ui_message", { message: { type: "dropPaths", paths: e.payload.paths } satisfies UiMessage });
      });
      return () => void off.then((f) => f());
    },
    subscribe(handler) {
      const off = listen<HostMessage>("host", (e) => handler(e.payload));
      return () => void off.then((f) => f());
    },
  };
}

const RESIZE = {
  left: "West", right: "East", top: "North", bottom: "South",
  "top-left": "NorthWest", "top-right": "NorthEast", "bottom-left": "SouthWest", "bottom-right": "SouthEast",
} as const;

const isTauri = "__TAURI_INTERNALS__" in window;

export const bridge: Bridge = isTauri ? createTauriBridge() : createPreviewBridge();
