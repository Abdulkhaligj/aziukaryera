import { login } from './actions';
import LoginForm from '@/components/login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; email?: string }> }) {
  const query = await searchParams;
  return <main className="loginPage"><section className="loginCard">
    <div className="loginBrand"><span className="brandMark">A</span><div><b>ASOIU Karyera</b><small>İdarəetmə paneli</small></div></div>
    <h1>Əməkdaş girişi</h1>
    <p>Yalnız Karyera Mərkəzinin səlahiyyətli əməkdaşları üçün.</p>
    <LoginForm action={login} error={query.error} notice={query.notice} email={query.email}/>
  </section></main>;
}
