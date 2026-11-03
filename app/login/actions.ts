'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminContext } from '@/lib/admin-data';

export async function login(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect('/admin');
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  if (!email || !password) redirect('/login?error=' + encodeURIComponent('E-poçt və şifrəni yazın.'));
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const message = /email not confirmed/i.test(error.message)
      ? 'E-poçt ünvanı təsdiqlənməyib. Super Admin ilə əlaqə saxlayın.'
      : 'E-poçt və ya şifrə yanlışdır.';
    redirect('/login?error=' + encodeURIComponent(message) + '&email=' + encodeURIComponent(email));
  }
  /* Reject every non-admin role, including forged/unknown role labels. */
  const allowedAdminRoles = ['super_admin', 'manager', 'editor', 'reviewer'] as const;
  const role = data.user?.app_metadata?.admin_role;
  const context = await getAdminContext({ allowPasswordChange: true });
  if (!allowedAdminRoles.includes(role) || !context) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('Bu hesabın admin paneldə səlahiyyəti yoxdur.'));
  }
  redirect(context.mustChangePassword ? '/account/password' : '/admin');
}

export async function logout() {
  const supabase = await createClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) redirect('/login?error=' + encodeURIComponent('Sessiya bağlanmadı. İnternet bağlantısını yoxlayıb çıxışı yenidən sınayın.'));
  }
  redirect('/login?notice=' + encodeURIComponent('Sistemdən çıxdınız.'));
}
