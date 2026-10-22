import AdminShell from '@/components/admin-shell';
import { getAdminContext, loadAdminData } from '@/lib/admin-data';
import { redirect } from 'next/navigation';

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <main style={{padding: 40, fontFamily: 'system-ui'}}><h1>Admin paneli konfiqurasiya olunmayıb</h1><p>Supabase bağlantı dəyişənlərini əlavə edib tətbiqi yenidən yayımlayın.</p></main>;
  }
  const context = await getAdminContext();
  if (!context) redirect('/login');
  /* Müvəqqəti şifrə ilə girən əməkdaş əvvəlcə öz şifrəsini qurmalıdır */
  if (context.mustChangePassword) redirect('/account/password');
  const [{ data, errors, lookups }, query] = await Promise.all([loadAdminData(context), searchParams]);
  return <AdminShell initialData={data} initialErrors={errors} lookups={lookups} notice={query.notice}
    currentUser={context.fullName} currentEmail={context.email} currentRole={context.role} currentUserId={context.userId}/>;
}
