import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { serveStatic } from "./static-files";

const web = resolve(import.meta.dir, "../../../web");

test("the app links a credentialed standalone manifest with existing install icons", async () => {
  const html = await Bun.file(resolve(web, "index.html")).text();
  const link = html.match(/<link\b[^>]*\brel="manifest"[^>]*>/)?.[0];
  expect(link).toContain('href="/manifest.json"');
  expect(link).toContain('crossorigin="use-credentials"');
  const response = await serveStatic(
    new Request("https://roamgate.example/manifest.json"),
    resolve(web, "public"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "Roamgate",
    short_name: "Roamgate",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(
    manifest.icons.map(
      (icon: { sizes: string; purpose?: string }) =>
        `${icon.sizes}:${icon.purpose ?? "any"}`,
    ),
  ).toEqual(["any:any", "192x192:any", "512x512:any", "512x512:maskable"]);
  for (const icon of manifest.icons) {
    const bytes = Buffer.from(
      await Bun.file(resolve(web, "public", icon.src.slice(1))).arrayBuffer(),
    );
    if (icon.type === "image/svg+xml") {
      expect(bytes.toString("utf8")).toStartWith("<svg");
      continue;
    }
    expect(icon.type).toBe("image/png");
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
      icon.sizes,
    );
  }
});

test("source runs fall back to the built public directory", async () => {
  const response = await serveStatic(
    new Request("https://roamgate.example/manifest.json"),
    "/nonexistent-roamgate-static-test",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual(
    await Bun.file(resolve(web, "public/manifest.json")).json(),
  );
});

test("text assets are compressed and fingerprinted assets are immutable", async () => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/roamgate-static-${process.pid}`;
  const script = `console.log(${JSON.stringify("x".repeat(4096))});\n`;
  await Bun.write(`${dir}/assets/app-abc123.js`, script);
  const response = await serveStatic(
    new Request("https://roamgate.example/assets/app-abc123.js", {
      headers: { "accept-encoding": "gzip, deflate, br" },
    }),
    dir,
  );
  expect(response.headers.get("content-encoding")).toBe("br");
  expect(response.headers.get("vary")).toBe("Accept-Encoding");
  expect(response.headers.get("cache-control")).toContain("immutable");
  const body = new Uint8Array(await response.arrayBuffer());
  expect(body.length).toBeLessThan(script.length / 4);
  const { brotliDecompressSync } = await import("node:zlib");
  expect(brotliDecompressSync(body).toString("utf8")).toBe(script);

  const plain = await serveStatic(
    new Request("https://roamgate.example/assets/app-abc123.js"),
    dir,
  );
  expect(plain.headers.get("content-encoding")).toBeNull();
  expect(await plain.text()).toBe(script);
});
