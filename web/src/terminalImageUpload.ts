import type { ConnectionClient } from "./api";
import { connectionHttpPath } from "./connectionHttp";

/**
 * Uploads an image through the connection's HTTP endpoint and returns the
 * server-side path. Callers decide when (or whether) that path reaches a
 * terminal; uploading here never writes to a PTY by itself.
 */
export async function uploadTerminalImage(
  client: ConnectionClient,
  file: File,
): Promise<string> {
  if (!client.isCurrent()) throw new Error("connection changed during upload");
  const ext = (file.type.split("/")[1] || "png").toLowerCase();
  const uploadUrl = new URL(
    connectionHttpPath(
      client.connectionId,
      "/upload-image",
      client.serverRuntimeGeneration,
    ),
    window.location.origin,
  );
  if (uploadUrl.origin !== window.location.origin) {
    throw new Error("invalid upload origin");
  }
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "x-image-ext": ext,
      "content-type": file.type || "image/png",
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!client.isCurrent()) throw new Error("connection changed during upload");
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.path as string;
}
