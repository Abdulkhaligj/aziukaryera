import { login } from './actions';

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const query = await searchParams;
  return <main className="loginPage"><section className="loginCard">
    <div className="loginBrand"><span className="brandMark">A</span><div><b>ASOIU Karyera</b><small>İdarəetmə paneli</small></div></div>
    <h1>Əməkdaş girişi</h1><p>Yalnız Karyera Mərkəzinin səlahiyyətli əməkdaşları üçün.</p>
    <form action={login}><label>E-poçt<input name="email" type="email" placeholder="career@asoiu.edu.az" required /></label><label>Şifrə<input name="password" type="password" required /></label>{query.error&&<div className="errorBox">{query.error}</div>}<button className="primaryButton" type="submit">Daxil ol</button></form>
  </section></main>;
}
