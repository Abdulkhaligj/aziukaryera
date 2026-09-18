import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const editable = new Set(['jobs','companies','events','benefits','content','admins','applications']);
async function context() {
  const supabase = await createClient(); if(!supabase) return null;
  const {data} = await supabase.auth.getClaims(); if(!data?.claims?.sub) return null;
  const {data:profile} = await supabase.from('profiles').select('role,status').eq('id',data.claims.sub).single();
  if(!profile || profile.status!=='active') return null;
  return {supabase,role:profile.role as string};
}
export async function PATCH(request:NextRequest,{params}:{params:Promise<{resource:string,id:string}>}) {
  const {resource,id}=await params; const auth=await context();
  if(!auth || !editable.has(resource) || auth.role==='reviewer') return NextResponse.json({error:'İcazə yoxdur'},{status:403});
  const {data,error}=await auth.supabase.from(resource).update(await request.json()).eq('id',id).select().single();
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json(data);
}
export async function DELETE(_:NextRequest,{params}:{params:Promise<{resource:string,id:string}>}) {
  const {resource,id}=await params; const auth=await context();
  if(!auth || !editable.has(resource) || !['super_admin','manager'].includes(auth.role)) return NextResponse.json({error:'İcazə yoxdur'},{status:403});
  const {error}=await auth.supabase.from(resource).delete().eq('id',id);
  return error?NextResponse.json({error:error.message},{status:400}):NextResponse.json({ok:true});
}
