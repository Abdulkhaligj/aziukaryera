'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAdminContext } from '@/lib/admin-data';

const fail = (message: string) => redirect('/account/password?error=' + encodeURIComponent(message));

export async function changePassword(formData: FormData) {
  const context = await getAdminContext({ allowPasswordChange: true });
  if (!context) redirect('/login');
  const supabase = await createClient();
  if (!supabase) redirect('/login');
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');

  const password = String(formData.get('password') || '');
  const repeat = String(formData.get('password2') || '');
  if (password.length < 10) fail('Şifrə ən azı 10 simvol olmalıdır.');
  if (!/[A-Za-zƏəÇçĞğIıİiÖöŞşÜü]/.test(password) || !/\d/.test(password)) fail('Şifrədə ən azı bir hərf və bir rəqəm olmalıdır.');
  if (password !== repeat) fail('Şifrələr üst-üstə düşmür.');

  // The trusted handler changes the password before clearing the onboarding
  // flag. A separate client assertion can never clear it.
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'change_password', password } });
  if (error || !data?.ok) fail('Şifrə dəyişmədi. Yeni şifrənin əvvəlkindən fərqli olduğunu yoxlayın və yenidən cəhd edin.');
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) redirect('/login?notice=' + encodeURIComponent('Şifrəniz yeniləndi. Yeni şifrə ilə daxil olun.'));
  redirect('/admin?notice=' + encodeURIComponent('Şifrəniz yeniləndi.'));
}
