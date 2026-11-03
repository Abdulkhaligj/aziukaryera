// Bound streamed JSON before parsing, including chunked requests without a
// Content-Length header. Never partially accept an oversized document.
export async function readAdminJson(request: Request, maxBytes = 262144): Promise<
  { body: Record<string, unknown> } |
  { error: string; status: number }
> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    return { error: 'Sorğu ölçüsü icazə verilən həddi aşır.', status: 413 };
  }
  if (!request.body) return { error: 'Sorğunun formatı yanlışdır.', status: 400 };
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { error: 'Sorğu ölçüsü icazə verilən həddi aşır.', status: 413 };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return { body: body as Record<string, unknown> };
  } catch {
    return { error: 'Sorğunun formatı yanlışdır.', status: 400 };
  } finally {
    reader.releaseLock();
  }
}
