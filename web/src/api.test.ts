import { afterEach, describe, expect, test } from "bun:test";
import { Bridge, type ConnectionStatus } from "./api";

const originalWebSocket = globalThis.WebSocket;
const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  "location",
);
const testBridges: Bridge[] = [];

class HangingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = HangingWebSocket.CONNECTING;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  close() {
    this.readyState = HangingWebSocket.CLOSED;
    this.onclose?.();
  }

  send() {}
}

function installBrowserGlobals(webSocket: typeof WebSocket) {
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: "localhost:5173" },
  });
  globalThis.WebSocket = webSocket;
}

function createTestBridge(connectTimeoutMs = 5, reconnectDelayMs = 1000) {
  const bridge = new Bridge(connectTimeoutMs, reconnectDelayMs);
  testBridges.push(bridge);
  return bridge;
}

afterEach(() => {
  testBridges.splice(0).forEach((bridge) => bridge.disconnect());
  globalThis.WebSocket = originalWebSocket;
  if (originalLocation) {
    Object.defineProperty(globalThis, "location", originalLocation);
  } else {
    Reflect.deleteProperty(globalThis, "location");
  }
});

describe("bridge connection lifecycle", () => {
  test("clears the connection timeout after opening", async () => {
    class OpeningWebSocket extends HangingWebSocket {
      constructor() {
        super();
        queueMicrotask(() => {
          this.readyState = OpeningWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(OpeningWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();

    bridge.connect();
    await Bun.sleep(15);

    expect(bridge.status).toBe("connected");
  });

  test("leaves connecting state when the WebSocket handshake hangs", async () => {
    installBrowserGlobals(HangingWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const statuses: ConnectionStatus[] = [];
    bridge.onStatus((status) => statuses.push(status));

    bridge.connect();
    await Bun.sleep(15);

    expect(statuses).toEqual(["disconnected", "connecting", "disconnected"]);
    expect(bridge.status).toBe("disconnected");
  });

  test("retries after a timed-out WebSocket handshake", async () => {
    class RecoveringWebSocket extends HangingWebSocket {
      static instances = 0;

      constructor() {
        super();
        RecoveringWebSocket.instances += 1;
        if (RecoveringWebSocket.instances === 2) {
          queueMicrotask(() => {
            this.readyState = RecoveringWebSocket.OPEN;
            this.onopen?.();
          });
        }
      }
    }
    installBrowserGlobals(RecoveringWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge(5, 1);
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for reconnect")),
        100,
      );
      bridge.onStatus((status) => {
        if (status !== "connected") return;
        clearTimeout(timer);
        resolve();
      });
    });

    bridge.connect();
    await connected;

    expect(RecoveringWebSocket.instances).toBe(2);
    expect(bridge.status).toBe("connected");
  });

  test("recovers when opening the WebSocket throws synchronously", () => {
    class ThrowingWebSocket {
      constructor() {
        throw new Error("blocked");
      }
    }
    installBrowserGlobals(ThrowingWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const statuses: ConnectionStatus[] = [];
    bridge.onStatus((status) => statuses.push(status));

    bridge.connect();

    expect(statuses).toEqual(["disconnected", "connecting", "disconnected"]);
    expect(bridge.status).toBe("disconnected");
  });

  test("allows a long-running RPC to rely on connection lifetime", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;
      sent: string[] = [];

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(raw = "") {
        this.sent.push(raw);
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    bridge.connect();
    await Bun.sleep(1);

    const response = bridge.call(
      "worktree.remove",
      { workspace_id: "w1" },
      null,
    );
    const request = JSON.parse(ManualWebSocket.instance.sent[0]);
    await Bun.sleep(5);
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ id: request.id, result: { ok: true } }),
    } as MessageEvent);

    await expect(response).resolves.toEqual({ ok: true });
  });

  test("dispatches terminal clipboard pushes and removes listeners", async () => {
    class ManualWebSocket extends HangingWebSocket {
      static instance: ManualWebSocket;

      constructor() {
        super();
        ManualWebSocket.instance = this;
        queueMicrotask(() => {
          this.readyState = ManualWebSocket.OPEN;
          this.onopen?.();
        });
      }
    }
    installBrowserGlobals(ManualWebSocket as unknown as typeof WebSocket);
    const bridge = createTestBridge();
    const received: Array<{ terminal_id: string; data: string }> = [];
    const remove = bridge.onTerminalClipboard((clipboard) =>
      received.push(clipboard),
    );
    bridge.connect();
    await Bun.sleep(1);

    const push = { terminal_id: "term_1", data: "Y29weQ==" };
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ terminal_clipboard: push }),
    } as MessageEvent);
    remove();
    ManualWebSocket.instance.onmessage?.({
      data: JSON.stringify({ terminal_clipboard: push }),
    } as MessageEvent);

    expect(received).toEqual([push]);
  });
});
