import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import * as net from "node:net";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { BinReader, BinWriter, encodeFrame } from "./bincode";
import { createTerminalBridge } from "./terminal-bridge";

const servers: net.Server[] = [];
const serverConnections = new Set<net.Socket>();

afterEach(async () => {
  for (const connection of serverConnections) connection.destroy();
  serverConnections.clear();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

function terminalFrame() {
  const writer = new BinWriter();
  writer.variant(2);
  writer.varint(1);
  writer.varint(100);
  writer.varint(30);
  writer.bool(true);
  writer.bytes(Buffer.from("frame"));
  return encodeFrame(writer.toBuffer());
}

function clipboardFrame(data: string) {
  const writer = new BinWriter();
  writer.variant(6);
  writer.string(data);
  return encodeFrame(writer.toBuffer());
}

async function startThinServer(
  options: {
    clipboardData?: string;
    appWelcomeDelayMs?: number;
    appWelcomeError?: string;
    skipAppWelcome?: boolean;
    directClipboardOnResize?: string;
  } = {},
) {
  const socketPath = path.join(
    tmpdir(),
    `herdr-gui-terminal-bridge-${process.pid}-${crypto.randomUUID()}.sock`,
  );
  let appSocket: net.Socket | null = null;
  const server = net.createServer((socket) => {
    serverConnections.add(socket);
    let input = Buffer.alloc(0);
    socket.on("close", () => {
      serverConnections.delete(socket);
      if (appSocket === socket) appSocket = null;
    });
    socket.on("data", (chunk) => {
      input = Buffer.concat([
        input,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      ]);
      while (input.length >= 4) {
        const length = input.readUInt32LE(0);
        if (input.length < length + 4) return;
        const reader = new BinReader(input.subarray(4, length + 4));
        input = input.subarray(length + 4);
        const variant = reader.variant();
        if (variant === 0) {
          const protocol = reader.varint();
          reader.varint(); // cols
          reader.varint(); // rows
          reader.varint(); // cell width
          reader.varint(); // cell height
          reader.varint(); // encoding
          reader.varint(); // keybindings
          const launchMode = reader.varint();
          const writer = new BinWriter();
          writer.variant(0);
          writer.varint(protocol);
          writer.varint(1);
          writer.option<string>(
            launchMode === 0 ? options.appWelcomeError : undefined,
            (value) => writer.string(value),
          );
          const sendWelcome = () => {
            if (socket.destroyed) return;
            if (launchMode === 0 && options.skipAppWelcome) return;
            if (launchMode === 0) appSocket = socket;
            socket.write(encodeFrame(writer.toBuffer()));
          };
          if (launchMode === 0 && (options.appWelcomeDelayMs ?? 0) > 0) {
            setTimeout(sendWelcome, options.appWelcomeDelayMs);
          } else {
            sendWelcome();
          }
        } else if (variant === 1) {
          if (options.clipboardData) {
            appSocket?.write(clipboardFrame(options.clipboardData));
          }
        } else if (variant === 3 || variant === 5) {
          socket.write(terminalFrame());
          if (variant === 3 && options.directClipboardOnResize) {
            socket.write(clipboardFrame(options.directClipboardOnResize));
          }
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return socketPath;
}

async function waitForTerminalFrame(messages: string[]) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const frame = messages
      .map((message) => JSON.parse(message))
      .find((message) => message.terminal);
    if (frame) return frame.terminal;
    await Bun.sleep(2);
  }
  throw new Error("timed out waiting for terminal frame");
}

describe("terminal bridge sharing", () => {
  test("refreshes a reused terminal for a newly attached browser", async () => {
    const socketPath = await startThinServer();
    const firstBrowser = {} as ServerWebSocket<unknown>;
    const secondBrowser = {} as ServerWebSocket<unknown>;
    const messages = new Map<ServerWebSocket<unknown>, string[]>([
      [firstBrowser, []],
      [secondBrowser, []],
    ]);
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (ws, payload) => {
        messages.get(ws)?.push(payload);
        return true;
      },
      clientLabel: (ws) => (ws === firstBrowser ? "first" : "second"),
      markRpcError: () => undefined,
    });

    await bridge.handleTerminalRpc(
      firstBrowser,
      "first-attach",
      "terminal.attach",
      {
        terminal_id: "term_1",
        cols: 100,
        rows: 30,
      },
    );
    await waitForTerminalFrame(messages.get(firstBrowser)!);

    await bridge.handleTerminalRpc(
      secondBrowser,
      "second-attach",
      "terminal.attach",
      {
        terminal_id: "term_1",
        cols: 100,
        rows: 30,
      },
    );
    const reusedFrame = await waitForTerminalFrame(
      messages.get(secondBrowser)!,
    );

    expect(reusedFrame).toMatchObject({
      terminal_id: "term_1",
      full: true,
      width: 100,
      height: 30,
    });

    const frameCount = messages
      .get(secondBrowser)!
      .map((message) => JSON.parse(message))
      .filter((message) => message.terminal).length;
    await bridge.handleTerminalRpc(
      secondBrowser,
      "duplicate-attach",
      "terminal.attach",
      {
        terminal_id: "term_1",
        cols: 100,
        rows: 30,
      },
    );
    await Bun.sleep(5);
    expect(
      messages
        .get(secondBrowser)!
        .map((message) => JSON.parse(message))
        .filter((message) => message.terminal),
    ).toHaveLength(frameCount);

    bridge.cleanupWs(firstBrowser);
    bridge.cleanupWs(secondBrowser);
  });

  test("routes Herdr clipboard messages from the app relay to the input owner", async () => {
    const clipboardData = "cmVtb3RlIGNvcHk=";
    const socketPath = await startThinServer({
      clipboardData,
      appWelcomeDelayMs: 30,
    });
    const browser = {} as ServerWebSocket<unknown>;
    const observer = {} as ServerWebSocket<unknown>;
    const messages = new Map<ServerWebSocket<unknown>, string[]>([
      [browser, []],
      [observer, []],
    ]);
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (ws, payload) => {
        messages.get(ws)?.push(payload);
        return true;
      },
      clientLabel: (ws) => (ws === browser ? "browser" : "observer"),
      markRpcError: () => undefined,
    });

    await bridge.handleTerminalRpc(browser, "attach", "terminal.attach", {
      terminal_id: "term_1",
      cols: 100,
      rows: 30,
    });
    await bridge.handleTerminalRpc(observer, "observe", "terminal.attach", {
      terminal_id: "term_1",
      cols: 100,
      rows: 30,
    });
    await bridge.handleTerminalRpc(browser, "input", "terminal.input", {
      terminal_id: "term_1",
      data: Buffer.from("copy").toString("base64"),
    });
    await Bun.sleep(5);

    expect(
      messages
        .get(browser)!
        .map((message) => JSON.parse(message))
        .find((message) => message.terminal_clipboard)?.terminal_clipboard,
    ).toEqual({ terminal_id: "term_1", data: clipboardData });
    expect(
      messages
        .get(observer)!
        .some((message) => JSON.parse(message).terminal_clipboard),
    ).toBe(false);

    messages.get(browser)!.length = 0;
    messages.get(observer)!.length = 0;
    await bridge.handleTerminalRpc(observer, "input-2", "terminal.input", {
      terminal_id: "term_1",
      data: Buffer.from("copy again").toString("base64"),
    });
    await Bun.sleep(5);
    expect(
      messages
        .get(observer)!
        .map((message) => JSON.parse(message))
        .find((message) => message.terminal_clipboard)?.terminal_clipboard,
    ).toEqual({ terminal_id: "term_1", data: clipboardData });
    expect(
      messages
        .get(browser)!
        .some((message) => JSON.parse(message).terminal_clipboard),
    ).toBe(false);
    bridge.cleanupWs(browser);
    bridge.cleanupWs(observer);
  });

  test("does not broadcast clipboard events without a matching input owner", async () => {
    const socketPath = await startThinServer({
      directClipboardOnResize: "bm8gb3duZXI=",
    });
    const firstBrowser = {} as ServerWebSocket<unknown>;
    const secondBrowser = {} as ServerWebSocket<unknown>;
    const messages = new Map<ServerWebSocket<unknown>, string[]>([
      [firstBrowser, []],
      [secondBrowser, []],
    ]);
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (ws, payload) => {
        messages.get(ws)?.push(payload);
        return true;
      },
      clientLabel: () => "browser",
      markRpcError: () => undefined,
    });

    await bridge.handleTerminalRpc(
      firstBrowser,
      "attach-1",
      "terminal.attach",
      {
        terminal_id: "term_1",
        cols: 100,
        rows: 30,
      },
    );
    await bridge.handleTerminalRpc(
      secondBrowser,
      "attach-2",
      "terminal.attach",
      {
        terminal_id: "term_1",
        cols: 100,
        rows: 30,
      },
    );
    await Bun.sleep(5);

    for (const sent of messages.values()) {
      expect(
        sent.some((message) => JSON.parse(message).terminal_clipboard),
      ).toBe(false);
    }
    bridge.cleanupWs(firstBrowser);
    bridge.cleanupWs(secondBrowser);
  });

  test("keeps terminal attach usable when the optional relay is rejected", async () => {
    const socketPath = await startThinServer({
      appWelcomeError: "app clients disabled",
    });
    const browser = {} as ServerWebSocket<unknown>;
    const messages: string[] = [];
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (_ws, payload) => {
        messages.push(payload);
        return true;
      },
      clientLabel: () => "browser",
      markRpcError: () => undefined,
    });

    await bridge.handleTerminalRpc(browser, "attach", "terminal.attach", {
      terminal_id: "term_1",
      cols: 100,
      rows: 30,
    });

    expect(
      messages
        .map((message) => JSON.parse(message))
        .find((message) => message.id === "attach")?.result,
    ).toEqual({ ok: true });
    bridge.cleanupWs(browser);
  });

  test("does not leave terminal attach waiting on a stalled relay", async () => {
    const socketPath = await startThinServer({ skipAppWelcome: true });
    const browser = {} as ServerWebSocket<unknown>;
    const messages: string[] = [];
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (_ws, payload) => {
        messages.push(payload);
        return true;
      },
      clientLabel: () => "browser",
      markRpcError: () => undefined,
    });

    const startedAt = performance.now();
    await bridge.handleTerminalRpc(browser, "attach", "terminal.attach", {
      terminal_id: "term_1",
      cols: 100,
      rows: 30,
    });

    expect(performance.now() - startedAt).toBeLessThan(1_500);
    expect(
      messages
        .map((message) => JSON.parse(message))
        .find((message) => message.id === "attach")?.result,
    ).toEqual({ ok: true });
    bridge.cleanupWs(browser);
  });

  test("rejects input for terminals the browser does not view", async () => {
    const socketPath = await startThinServer();
    const owner = {} as ServerWebSocket<unknown>;
    const stranger = {} as ServerWebSocket<unknown>;
    const messages = new Map<ServerWebSocket<unknown>, string[]>([
      [owner, []],
      [stranger, []],
    ]);
    const bridge = createTerminalBridge({
      clientSocketPath: socketPath,
      herdrProtocol: async () => 17,
      safeSend: (ws, payload) => {
        messages.get(ws)?.push(payload);
        return true;
      },
      clientLabel: () => "browser",
      markRpcError: () => undefined,
    });
    await bridge.handleTerminalRpc(owner, "attach", "terminal.attach", {
      terminal_id: "term_1",
      cols: 100,
      rows: 30,
    });

    await bridge.handleTerminalRpc(stranger, "input", "terminal.input", {
      terminal_id: "term_1",
      data: Buffer.from("steal clipboard").toString("base64"),
    });

    expect(
      messages
        .get(stranger)!
        .map((message) => JSON.parse(message))
        .find((message) => message.id === "input")?.error.message,
    ).toBe("no terminal attached");
    bridge.cleanupWs(owner);
    bridge.cleanupWs(stranger);
  });
});
