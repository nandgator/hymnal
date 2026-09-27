/** How far a first install's download has got (DESIGN.md § Structure:
 * a real wait gets real progress). `total` only when the size is known. */
export interface InstallProgress {
  loaded: number;
  total?: number;
}

/** How often a download reports its progress: often enough to move a bar
 * smoothly, seldom enough not to flood the channel. */
const PROGRESS_MS = 100;

/**
 * Reads a response whole, reporting bytes as they come. A compressed
 * response's Content-Length counts compressed bytes, not the ones read, so
 * then the total is unknown.
 */
export async function download(
  response: Response,
  onProgress?: (progress: InstallProgress) => void,
): Promise<Uint8Array> {
  if (!onProgress || !response.body) return new Uint8Array(await response.arrayBuffer());
  const length = Number(response.headers.get("content-length"));
  const total = length > 0 && !response.headers.get("content-encoding") ? length : undefined;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (Date.now() - reported >= PROGRESS_MS) {
      reported = Date.now();
      onProgress({ loaded, total });
    }
  }
  onProgress({ loaded, total });
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
