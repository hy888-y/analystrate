'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';

async function admin() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  const { data: me } = await sb.from('profiles').select('id,email,role,status').eq('id', user.id).single();
  if (!me || me.role !== 'admin' || me.status !== 'active') redirect('/manager?denied=1');
  return { sb, me };
}
const opts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 };

export async function startPreview(formData) {
  const { sb, me } = await admin();
  const kind = String(formData.get('kind') || '');
  if (kind === 'manager') {
    cookies().set('tl_preview', 'manager', opts);
    await logAudit({ actorId: me.id, actorEmail: me.email, action: 'settings.preview', details: { as: 'manager' } });
    redirect('/manager');
  }
  const id = String(formData.get('staffId') || '');
  const { data: p } = await sb.from('profiles').select('id,full_name,role').eq('id', id).maybeSingle();
  if (!p || p.role !== 'staff') redirect('/manager/settings');
  cookies().set('tl_preview', `staff:${p.id}`, opts);
  await logAudit({ actorId: me.id, actorEmail: me.email, action: 'settings.preview', targetType: 'user', targetId: p.id, details: { as: 'staff', name: p.full_name } });
  redirect('/staff');
}

export async function stopPreview() {
  cookies().delete('tl_preview');
  redirect('/manager/settings');
}
