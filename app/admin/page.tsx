import AdminShell from '@/components/admin-shell';
import { getAdminContext, loadAdminData } from '@/lib/admin-data';
import { redirect } from 'next/navigation';

export default async function AdminPage() {
  const context = await getAdminContext();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <main style={{padding: 40, fontFamily: 'system-ui'}}><h1>Admin paneli konfiqurasiya olunmayıb</h1><p>Supabase bağlantı dəyişənlərini əlavə edib tətbiqi yenidən yayımlayın.</p></main>;
  }
  if (!context) redirect('/login');
  const data = await loadAdminData(context);
  return <AdminShell initialData={data} currentUser={context.fullName} currentRole={context.role}/>;
}
