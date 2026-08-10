import { describe, expect, test } from "bun:test";
import { createAuthHandlers } from "./auth";
import {
  browserUrlFor,
  withLoginToken,
} from "../config/server-config";

function cookieHeader(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("missing authentication cookie");
  return cookie.split(";", 1)[0];
}

describe("request host validation", () => {
  test("allows only loopback origins when authentication is disabled", () => {
    const handlers = createAuthHandlers({
      authRequired: false,
      password: "",
    });

    for (const url of [
      "http://localhost:8787/",
      "http://localhost.:8787/",
      "http://127.0.0.1:8787/",
      "http://[::1]:8787/",
    ]) {
      expect(handlers.isAllowedRequestHost(new Request(url))).toBe(true);
    }
    expect(
      handlers.isAllowedRequestHost(
        new Request("http://attacker.example:8787/"),
      ),
    ).toBe(false);
    expect(
      handlers.isAllowedRequestHost(new Request("http://127.0.0.2:8787/")),
    ).toBe(false);
  });

  test("rejects browser origins from another authority", () => {
    const handlers = createAuthHandlers({
      authRequired: false,
      password: "",
    });
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://localhost:8787/ws", {
          headers: { origin: "http://localhost:8787" },
        }),
      ),
    ).toBe(true);
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://localhost:5173/ws", {
          headers: { origin: "http://localhost:5173" },
        }),
      ),
    ).toBe(true);
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://dashboard.example.com/ws", {
          headers: { origin: "https://dashboard.example.com" },
        }),
      ),
    ).toBe(true);
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://127.0.0.1:8787/ws", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://127.0.0.1:8787/ws", {
          headers: { origin: "null" },
        }),
      ),
    ).toBe(false);
    expect(
      handlers.isAllowedRequestOrigin(
        new Request("http://127.0.0.1:8787/healthz"),
      ),
    ).toBe(true);
  });

  test("relies on signed authentication for non-loopback deployments", () => {
    const handlers = createAuthHandlers({
      authRequired: true,
      password: "fixed-password",
    });
    expect(
      handlers.isAllowedRequestHost(
        new Request("https://dashboard.example.com/"),
      ),
    ).toBe(true);
  });
});

describe("generated token login", () => {
  test("exchanges a URL token for a signed cookie and strips it", () => {
    const handlers = createAuthHandlers({
      authRequired: true,
      password: "generated-secret",
      urlLoginToken: "generated-secret",
    });
    const response = handlers.handleTokenLogin(
      new Request(
        "http://example.test/workspace?view=terminal&token=generated-secret",
      ),
    );

    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe(
      "/workspace?view=terminal",
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("referrer-policy")).toBe("no-referrer");
    expect(
      handlers.isAuthed(
        new Request("http://example.test/", {
          headers: { cookie: cookieHeader(response!) },
        }),
      ),
    ).toBe(true);
  });

  test("removes an invalid token without creating a session", () => {
    const handlers = createAuthHandlers({
      authRequired: true,
      password: "generated-secret",
      urlLoginToken: "generated-secret",
    });
    const response = handlers.handleTokenLogin(
      new Request("http://example.test/?token=wrong"),
    );

    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/login");
    expect(response?.headers.has("set-cookie")).toBe(false);
  });

  test("ignores token parameters when URL login is not enabled", () => {
    const handlers = createAuthHandlers({
      authRequired: true,
      password: "fixed-password",
    });

    expect(
      handlers.handleTokenLogin(
        new Request("http://example.test/?token=fixed-password"),
      ),
    ).toBeNull();
  });

  test("preserves fixed-password login behavior", async () => {
    const handlers = createAuthHandlers({
      authRequired: true,
      password: "fixed-password",
    });
    const response = await handlers.handleLogin(
      new Request("http://example.test/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "fixed-password" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(
      handlers.isAuthed(
        new Request("http://example.test/", {
          headers: { cookie: cookieHeader(response) },
        }),
      ),
    ).toBe(true);
  });

  test("builds an encoded token URL for local and LAN startup output", () => {
    expect(
      withLoginToken(browserUrlFor("0.0.0.0", 8787), "secret token"),
    ).toBe("http://localhost:8787/?token=secret+token");
  });

  test("rejects an empty authentication secret", () => {
    expect(() =>
      createAuthHandlers({
        authRequired: true,
        password: "",
      }),
    ).toThrow("authentication requires a non-empty signing secret");
  });
});
