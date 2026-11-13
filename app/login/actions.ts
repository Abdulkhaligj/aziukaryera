'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/backend/server';
import { getAdminContext } from '@/lib/admin-data';
import type { MessageCode } from '@/lib/messages';

function to(path: string, key: 'error' | 'notice', code: MessageCode, extra = ''): never {
  return redirect(`${path}?${key}=${code}${extra}`);
}

export async function login(formData: FormData) {
  const db = await createClient();
  if (!db) redirect('/admin');
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  if (!email || !password) to('/login', 'error', 'login.missing');
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    to('/login', 'error', /email not confirmed/i.test(error.message) ? 'login.unconfirmed' : 'login.invalid', '&email=' + encodeURIComponent(email));
  }
  /* Reject every non-admin role, including forged/unknown role labels. */
  const allowedAdminRoles = ['super_admin', 'manager', 'editor', 'reviewer'] as const;
  const role = data.user?.app_metadata?.admin_role;
  const context = await getAdminContext({ allowPasswordChange: true });
  if (!allowedAdminRoles.includes(role) || !context) {
    await db.auth.signOut();
    to('/login', 'error', 'login.forbidden');
  }
  redirect(context.mustChangePassword ? '/account/password' : '/admin');
}

export async function logout() {
  const db = await createClient();
  if (db) {
    const { error } = await db.auth.signOut();
    if (error) to('/login', 'error', 'logout.failed');
  }
  to('/login', 'notice', 'logout.done');
}
