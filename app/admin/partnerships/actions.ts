'use server';

import { getAdminContext } from '@/lib/admin-data';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const STATUSES = ['submitted','reviewing','approved','rejected','completed'] as const;

export async function reviewPartnership(formData: FormData): Promise<void> {
  const ctx = await getAdminContext();
  if (!ctx) redirect('/login');
  if (!['super_admin','manager'].includes(ctx.role)) {
    redirect('/admin/partnerships?result=denied');
  }

  const id = String(formData.get('id') || '').trim();
  const status = String(formData.get('status') || '').trim();
  const adminNote = String(formData.get('admin_note') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !STATUSES.includes(status as (typeof STATUSES)[number]) || adminNote.length > 2000) {
    redirect('/admin/partnerships?result=invalid');
  }

  // UPDATE can affect zero rows under RLS without returning an error.
  // Verify the exact row was updated before showing a success notice.
  const { data, error } = await ctx.supabase.from('company_partnership_requests')
    .update({ status, admin_note: adminNote })
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error || !data) {
    redirect('/admin/partnerships?result=error');
  }
  revalidatePath('/admin/partnerships');
  redirect('/admin/partnerships?result=saved');
}
