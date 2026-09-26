import { join } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import {
  decodeStaticPathname,
  isStaticRequestMethod,
  resolvePublicFilePath,
  shouldServeSpaEntry,
} from "./static-paths";

// --asset ./public preserves this directory under import.meta.dir in binaries.
const builtPublicDir = Bun.isStandaloneExecutable
  ? join(import.meta.dir, "public")
  : join(import.meta.dir, "../../public");

export async function serveStatic(
  req: Request,
  publicDir: string,
): Promise<Response> {
  if (!isStaticRequestMethod(req.method)) {
    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  let pathname: string | null;
  try {
    pathname = decodeStaticPathname(new URL(req.url).pathname);
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!pathname) return new Response("bad request", { status: 400 });

  const serveEntry =
    pathname === "/index.html" ||
    shouldServeSpaEntry(req.method, req.headers.get("accept"));

  for (const directory of [publicDir, builtPublicDir]) {
    const filePath = resolvePublicFilePath(directory, pathname);
    if (!filePath) return new Response("not found", { status: 404 });
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return fileResponse(req, file, filePath, pathname);
    }
    if (serveEntry) {
      const indexPath = join(directory, "index.html");
      const index = Bun.file(indexPath);
      if (await index.exists()) {
        return fileResponse(req, index, indexPath, "/index.html");
      }
    }
  }

  return new Response("not found", { status: 404 });
}

// Text assets are sent compressed; on a slow phone link the uncompressed entry
// chunk alone takes minutes. Each file is compressed once per version.
const COMPRESSIBLE = /\.(?:js|css|html|json|map|svg|wasm|txt)$/;
const MIN_COMPRESS_BYTES = 1024;
const compressedCache = new Map<
  string,
  { version: string; encoding: "br" | "gzip"; body: Uint8Array }
>();

function acceptedEncoding(req: Request): "br" | "gzip" | null {
  const accept = req.headers.get("accept-encoding") ?? "";
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

async function fileResponse(
  req: Request,
  file: ReturnType<typeof Bun.file>,
  filePath: string,
  pathname: string,
): Promise<Response> {
  const headers = responseHeaders(pathname);
  const encoding = acceptedEncoding(req);
  if (
    !encoding ||
    !COMPRESSIBLE.test(pathname) ||
    file.size < MIN_COMPRESS_BYTES
  ) {
    return new Response(file, { headers });
  }
  const version = `${file.size}:${file.lastModified}`;
  const key = `${encoding}:${filePath}`;
  let cached = compressedCache.get(key);
  if (cached?.version !== version) {
    const raw = new Uint8Array(await file.arrayBuffer());
    const body =
      encoding === "br"
        ? new Uint8Array(
            brotliCompressSync(raw, {
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
              },
            }),
          )
        : Bun.gzipSync(raw, { level: 9 });
    cached = { version, encoding, body };
    compressedCache.set(key, cached);
  }
  return new Response(
    req.method === "HEAD" ? null : (cached.body as BodyInit),
    {
      headers: {
        ...headers,
        "content-encoding": cached.encoding,
        "content-length": String(cached.body.length),
        vary: "Accept-Encoding",
      },
    },
  );
}

function responseHeaders(pathname: string): Record<string, string> {
  const headers = { "content-type": contentType(pathname) };
  if (pathname.startsWith("/assets/")) {
    // Vite fingerprints everything under /assets, so a URL never changes
    // content; repeat visits then load the app without touching the network.
    return {
      ...headers,
      "cache-control": "private, max-age=31536000, immutable",
    };
  }
  if (pathname === "/index.html") {
    return {
      ...headers,
      // The updater replaces hashed assets and index.html together. Always
      // revalidate the entry document so a reload cannot retain old asset URLs.
      "cache-control": "no-cache, must-revalidate",
    };
  }
  return headers;
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json") || pathname.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  if (pathname.endsWith(".woff2")) return "font/woff2";
  if (pathname.endsWith(".woff")) return "font/woff";
  if (pathname.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
