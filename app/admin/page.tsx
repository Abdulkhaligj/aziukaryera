import AdminShell from '@/components/admin-shell';
import { demoData } from '@/lib/demo-data';
import { getAdminContext, loadAdminData } from '@/lib/admin-data';
import { redirect } from 'next/navigation';

export default async function AdminPage() {
  const context = await getAdminContext();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <AdminShell initialData={demoData} demoMode currentUser="Karyera Mərkəzi" currentRole="Super Admin"/>;
  }
  if (!context) redirect('/login');
  const data = await loadAdminData(context);
  return <AdminShell initialData={data} demoMode={false} currentUser={context.fullName} currentRole={context.role}/>;
}
