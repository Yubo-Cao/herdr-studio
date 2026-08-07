import { EventEmitter } from "node:events";
import * as net from "node:net";

/**
 * Minimal NDJSON client for the Herdr local socket.
 *
 * Herdr's wire model (confirmed against a running 0.7.0 server):
 *
 *   - **RPC is one-request-per-connection.** The server reads a single
 *     request line, writes a single response line, then closes the socket.
 *     So every `call()` opens a fresh connection.
 *   - **Subscriptions are long-lived.** `events.subscribe` keeps its
 *     connection open after the ack and pushes events as subsequent lines
 *     of the shape `{ event: "<name>", data: { ... } }`.
 */
export class HerdrClient extends EventEmitter {
  constructor(private socketPath: string) {
    super();
  }

  /** One-shot RPC: open -> send one request -> read one response -> close. */
  call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 8000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ path: this.socketPath });
      let buf = "";
      let done = false;

      const timer = setTimeout(
        () => finish(new Error(`timeout: ${method}`)),
        timeoutMs,
      );

      function finish(err?: Error, val?: any) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          s.end();
        } catch {
          /* already closed */
        }
        if (err) reject(err);
        else resolve(val);
      }

      s.on("error", (e) =>
        finish(new Error(`${(e as any).code ?? "error"}: ${e.message}`)),
      );
      s.on("connect", () => {
        const id = `r_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        s.write(JSON.stringify({ id, method, params }) + "\n");
      });
      s.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const i = buf.indexOf("\n");
        if (i === -1) return;
        const line = buf.slice(0, i).trim();
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          return finish(new Error(`bad json from herdr: ${line}`));
        }
        if (msg.error) {
          const code = msg.error.code ?? "error";
          const message = msg.error.message ?? String(msg.error);
          finish(new Error(`${code}: ${message}`));
        } else {
          finish(undefined, msg.result);
        }
      });
      s.on("close", () => {
        if (!done) {
          finish(new Error(`connection closed before response: ${method}`));
        }
      });
    });
  }

  /**
   * Long-lived event subscription. Returns a `close` handle and a `ready`
   * promise that resolves once the subscription is acknowledged.
   */
  subscribe(types: string[]): {
    close: () => void;
    ready: Promise<void>;
  } {
    const s = net.createConnection({ path: this.socketPath });
    let buf = "";
    let acked = false;
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      readyResolve = res;
      readyReject = rej;
    });

    s.on("error", (e) => {
      this.emit("error", e);
      if (!acked) readyReject(e);
    });
    s.on("connect", () => {
      s.write(
        JSON.stringify({
          id: "sub",
          method: "events.subscribe",
          params: { subscriptions: types.map((t) => ({ type: t })) },
        }) + "\n",
      );
    });
    s.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (!acked) {
          acked = true;
          if (msg.error) {
            readyReject(new Error(msg.error.message ?? "subscribe failed"));
          } else {
            readyResolve();
          }
          continue;
        }
        // pushed event: { event, data }
        this.emit("event", msg);
      }
    });
    s.on("close", () => this.emit("subscription_closed"));

    return { close: () => s.end(), ready };
  }

  ping(): Promise<any> {
    return this.call("ping");
  }
}
