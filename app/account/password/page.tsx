import Link from 'next/link';
import { redirect } from 'next/navigation';
import { changePassword } from './actions';
import { PasswordChangeButton, PasswordField } from '@/components/login-form';
import { getAdminContext } from '@/lib/admin-data';

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const context = await getAdminContext();
  if (!context) redirect('/login');
  const query = await searchParams;
  return <main className="loginPage"><section className="loginCard">
    <div className="loginBrand"><span className="brandMark">A</span><div><b>ASOIU Karyera</b><small>İdarəetmə paneli</small></div></div>
    <h1>{context.mustChangePassword ? 'Yeni şifrə təyin edin' : 'Şifrəni dəyiş'}</h1>
    <p>{context.mustChangePassword
      ? 'Siz müvəqqəti şifrə ilə daxil oldunuz. Davam etmək üçün yalnız sizin bildiyiniz yeni şifrə qurun.'
      : `${context.email} hesabı üçün yeni şifrə.`}</p>
    <form action={changePassword} className="stackForm">
      {query.error && <div className="errorBox" role="alert">{query.error}</div>}
      <PasswordField name="password" label="Yeni şifrə" autoComplete="new-password" minLength={10}/>
      <PasswordField name="password2" label="Yeni şifrənin təkrarı" autoComplete="new-password" minLength={10}/>
      <p className="formHint">Ən azı 10 simvol, hərf və rəqəm olmalıdır.</p>
      <PasswordChangeButton/>
      {!context.mustChangePassword && <Link className="secondaryButton block" href="/admin">Panelə qayıt</Link>}
    </form>
  </section></main>;
}
