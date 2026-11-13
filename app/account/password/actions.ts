'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/backend/server';
import { getAdminContext } from '@/lib/admin-data';
import type { MessageCode } from '@/lib/messages';

// The URL carries a message code, never text (audit 2026-11-13, #79).
const fail = (code: MessageCode) => redirect(`/account/password?error=${code}`);

/** The function's refusal: in the data, or (for a non-2xx answer) in the response body. */
async function refusal(error: unknown, data: { error?: string } | null | undefined): Promise<string | undefined> {
  if (data?.error) return data.error;
  try { return (await (error as { context?: Response } | null)?.context?.clone().json())?.error; } catch { return undefined; }
}

export async function changePassword(formData: FormData) {
  const context = await getAdminContext({ allowPasswordChange: true });
  if (!context) redirect('/login');
  const db = await createClient();
  if (!db) redirect('/login');
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) redirect('/login');

  const currentPassword = String(formData.get('current_password') || '');
  const password = String(formData.get('password') || '');
  const repeat = String(formData.get('password2') || '');
  if (!currentPassword) fail('password.current_missing');
  if (password.length < 10) fail('password.too_short');
  if (!/[A-Za-zƏəÇçĞğIıİiÖöŞşÜü]/.test(password) || !/\d/.test(password)) fail('password.weak');
  if (password !== repeat) fail('password.mismatch');

  // The trusted handler changes the password before clearing the onboarding
  // flag. A separate client assertion can never clear it. The API checks the
  // current (or temporary) password itself (#14).
  const { data, error } = await db.functions.invoke('admin-users', { body: { action: 'change_password', password, current_password: currentPassword } });
  if (await refusal(error, data) === 'Cari şifrə yanlışdır.') fail('password.current_wrong');
  if (error || !data?.ok) fail('password.failed');
  const { error: refreshError } = await db.auth.refreshSession();
  if (refreshError) redirect('/login?notice=password.updated_relogin');
  redirect('/admin?notice=password.updated');
}
