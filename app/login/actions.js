'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

const GENERIC = 'Incorrect email or password.';

export async function login(_prev, formData) {
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const remember = formData.get('remember') === 'on';
  const nextRaw = String(formData.get('next') || '');
  if (!email || !password) return { error: 'Enter your company email and password.', email };

  const prod = process.env.NODE_ENV === 'production';
  const store = cookies();
  const keep = remember ? { maxAge: 60 * 60 * 24 * 30 } : {};
  store.set('yl_rem', remember ? '1' : '0', { httpOnly: true, sameSite: 'lax', secure: prod, path: '/', ...keep });
  store.set('yl_rem_ui', remember ? '1' : '0', { httpOnly: false, sameSite: 'lax', secure: prod, path: '/', ...keep });

  const supabase = createClient({ remember });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  const ip = headers().get('x-forwarded-for')?.split(',')[0] || null;

  if (error || !data?.user) {
    await logAudit({ actorEmail: email, action: 'auth.login_failed', details: { ip } });
    return { error: GENERIC, email };
  }

  const admin = createAdminClient();
  const { data: prof } = await admin.from('profiles').select('role,status,must_change_password').eq('id', data.user.id).single();
  if (!prof || prof.status !== 'active') {
    await supabase.auth.signOut();
    await logAudit({ actorId: data.user.id, actorEmail: email, action: 'auth.login_blocked', details: { reason: 'inactive', ip } });
    return { error: 'Your account is not active. Contact your administrator.', email };
  }

  await admin.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id);
  await logAudit({ actorId: data.user.id, actorEmail: email, action: 'auth.login', targetType: 'user', targetId: data.user.id, details: { ip, remember } });
  store.set('yl_last', String(Date.now()), { httpOnly: true, sameSite: 'lax', secure: prod, path: '/', ...keep });

  if (prof.must_change_password) redirect('/reset-password?forced=1');
  const home = prof.role === 'staff' ? '/staff' : '/manager';
  const next = nextRaw.startsWith(home) && !nextRaw.startsWith('//') ? nextRaw : home;
  redirect(next);
}
