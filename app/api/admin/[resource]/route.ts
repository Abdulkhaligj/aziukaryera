import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ResourceKey } from '@/lib/types';

const resources = new Set<ResourceKey>(['jobs','companies','events','benefits','applications','students','content','admins','audit_logs']);
async function authorised() {
  const supabase = await createClient();
  if (!supabase) return null;
  const {data} = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return null;
  const {data: profile} = await supabase.from('profiles').select('role,status').eq('id',data.claims.sub).single();
  if (!profile || profile.status !== 'active' || !['super_admin','manager','editor','reviewer'].includes(profile.role)) return null;
  return {supabase,userId:data.claims.sub,role:profile.role as string};
}

export async function GET(_:NextRequest,{params}:{params:Promise<{resource:string}>}) {
  const {resource} = await params;
  if (!resources.has(resource as ResourceKey)) return NextResponse.json({error:'Naməlum bölmə'},{status:404});
  const auth = await authorised(); if(!auth) return NextResponse.json({error:'İcazə yoxdur'},{status:401});
  const {data,error} = await auth.supabase.from(resource).select('*').order('updated_at',{ascending:false});
  return error ? NextResponse.json({error:error.message},{status:400}) : NextResponse.json(data);
}

export async function POST(request:NextRequest,{params}:{params:Promise<{resource:string}>}) {
  const {resource} = await params;
  if (!resources.has(resource as ResourceKey) || ['applications','students','audit_logs'].includes(resource)) return NextResponse.json({error:'Bu əməliyyata icazə yoxdur'},{status:403});
  const auth = await authorised(); if(!auth || auth.role === 'reviewer') return NextResponse.json({error:'İcazə yoxdur'},{status:403});
  const body = await request.json();
  const {data,error} = await auth.supabase.from(resource).insert(body).select().single();
  return error ? NextResponse.json({error:error.message},{status:400}) : NextResponse.json(data,{status:201});
}
