import { login } from './actions';
import LoginForm from '@/components/login-form';
import { emailFromQuery, messageFor } from '@/lib/messages';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; email?: string }> }) {
  const query = await searchParams;
  return <main className="loginPage"><section className="loginCard">
    <div className="loginBrand"><span className="brandMark">A</span><div><b>ASOIU Karyera</b><small>İdarəetmə paneli</small></div></div>
    <h1>Əməkdaş girişi</h1>
    <p>Yalnız Karyera Mərkəzinin səlahiyyətli əməkdaşları üçün.</p>
    <LoginForm action={login} error={messageFor(query.error)} notice={messageFor(query.notice)} email={emailFromQuery(query.email)}/>
  </section></main>;
}
