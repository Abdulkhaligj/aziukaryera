// Browser side: read an API response as JSON without throwing when the server
// (or a proxy in front of it) answered with something else.
export async function readJson(response: Response): Promise<Record<string, any>> {
  try {
    const data = await response.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return { error: response.ok ? 'Server cavabı oxunmadı.' : `Server xətası (${response.status}). Bir az sonra yenidən cəhd edin.` };
  }
}
