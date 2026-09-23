// Keep Files, Changes and SSH reads on the same image-format contract.
export const IMAGE_MIME_TYPES: ReadonlyMap<string, string> = new Map([
  ["svg", "image/svg+xml"],
  ["apng", "image/apng"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jpe", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["avif", "image/avif"],
]);

export const HTML_PREVIEW_MAX_BYTES = 512 * 1024;

/** Largest UTF-8 file body the editor may save back to its host. */
export const FILE_WRITE_MAX_BYTES = 5 * 1024 * 1024;

/** Prefix of the error a save reports when the file moved on underneath it. */
export const FILE_WRITE_CONFLICT_MESSAGE = "file changed on disk";

export function isHtmlPath(path: string) {
  return /\.html?$/i.test(path);
}

export function imageMimeForPath(path: string) {
  return (
    IMAGE_MIME_TYPES.get(path.toLowerCase().split(".").pop() ?? "") ?? null
  );
}
