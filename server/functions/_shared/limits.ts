// Bound streamed input even when Content-Length is absent or dishonest.
export async function readLimitedBytes(source: Request | Response, maxBytes: number): Promise<Uint8Array> {
  const length = Number(source.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("JSON body too large");
  if (!source.body) throw new Error("Empty JSON body");
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("JSON body too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readLimitedJson(source: Request | Response, maxBytes = 262144): Promise<any> {
  return JSON.parse(new TextDecoder().decode(await readLimitedBytes(source, maxBytes)));
}
