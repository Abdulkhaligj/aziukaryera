import AdminShell from '@/components/admin-shell';
import { demoData } from '@/lib/demo-data';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function AdminPage() {
  const supabase = await createClient();
  let demoMode = true;
  if (supabase) {
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role,status').eq('id', data.claims.sub).single();
    if (!profile || !['super_admin','manager','editor','reviewer'].includes(profile.role) || profile.status !== 'active') redirect('/login');
    demoMode = false;
  }
  return <AdminShell initialData={demoData} demoMode={demoMode}/>;
}
