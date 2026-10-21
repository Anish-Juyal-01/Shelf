import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
}

interface WebView2 {
  postMessage(message: unknown): void;
  postMessageWithAdditionalObjects(message: unknown, objects: FileList): void;
  addEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (e: { data: unknown }) => void): void;
}

declare global {
  interface Window {
    chrome?: { webview?: WebView2 };
  }
}

function createHostBridge(webview: WebView2): Bridge {
  return {
    isPreview: false,
    send: (message) => webview.postMessage(message),
    sendFiles: (files) => webview.postMessageWithAdditionalObjects({ type: "dropFiles" } satisfies UiMessage, files),
    subscribe(handler) {
      const listener = (e: { data: unknown }) => handler(e.data as HostMessage);
      webview.addEventListener("message", listener);
      return () => webview.removeEventListener("message", listener);
    },
  };
}

/** The Tauri host (the Rust port): messages go in through the `ui_message` command and come back as `host` events. */
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
    // Dropped files arrive through Tauri's own drag-drop event once that's ported; until then the host says so.
    sendFiles: () => void invoke("ui_message", { message: { type: "dropFiles" } satisfies UiMessage }),
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

export const bridge: Bridge = isTauri ? createTauriBridge() : window.chrome?.webview ? createHostBridge(window.chrome.webview) : createPreviewBridge();
