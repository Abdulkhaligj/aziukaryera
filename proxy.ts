import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_API_URL;
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (!url || !key) return NextResponse.next({request});
  let response = NextResponse.next({request});
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({name,value}) => request.cookies.set(name,value));
        response = NextResponse.next({request});
        cookiesToSet.forEach(({name,value,options}) => response.cookies.set(name,value,options));
      }
    }
  });
  await db.auth.getClaims();
  return response;
}

export const config = { matcher: ['/admin/:path*', '/account/:path*', '/login'] };
