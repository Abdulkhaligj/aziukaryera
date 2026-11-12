import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_API_URL;
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
