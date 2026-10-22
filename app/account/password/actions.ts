'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const fail = (message: string) => redirect('/account/password?error=' + encodeURIComponent(message));

export async function changePassword(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect('/login');
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const password = String(formData.get('password') || '');
  const repeat = String(formData.get('password2') || '');
  if (password.length < 10) fail('Şifrə ən azı 10 simvol olmalıdır.');
  if (!/[A-Za-zƏəÇçĞğIıİiÖöŞşÜü]/.test(password) || !/\d/.test(password)) fail('Şifrədə ən azı bir hərf və bir rəqəm olmalıdır.');
  if (password !== repeat) fail('Şifrələr üst-üstə düşmür.');

  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(/same|different/i.test(error.message) ? 'Yeni şifrə müvəqqəti şifrədən fərqli olmalıdır.' : 'Şifrə dəyişmədi: ' + error.message);

  /* Müvəqqəti şifrə tələbini götürürük və yeni tokeni alırıq ki, panel açılsın */
  if (auth.user.app_metadata?.must_change_password) {
    await supabase.functions.invoke('admin-users', { body: { action: 'password_changed' } });
    await supabase.auth.refreshSession();
  }
  redirect('/admin?notice=' + encodeURIComponent('Şifrəniz yeniləndi.'));
}
