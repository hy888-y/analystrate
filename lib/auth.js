import 'server-only';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export const PERMISSIONS = ['tasks.manage', 'staff.view', 'reports.view', 'users.manage', 'audit.view'];

// Admin-only "view as" preview, stored in a cookie: "manager" or "staff:<user id>"
function readPreview(profile) {
  if (profile.role !== 'admin') return null;
  const v = cookies().get('tl_preview')?.value || '';
  if (v === 'manager') return { role: 'manager' };
  if (v.startsWith('staff:')) return { role: 'staff', id: v.slice(6) };
  return null;
}

// Current user, profile and permissions. Redirects to login if there is no valid session.
export async function getSession() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!profile || profile.status !== 'active') redirect('/login?e=inactive');
  const preview = readPreview(profile);
  const role = preview ? preview.role : profile.role;
  let perms = {};
  if (role === 'admin') PERMISSIONS.forEach((p) => (perms[p] = true));
  else {
    const { data } = await supabase.from('role_permissions').select('permission,allowed').eq('role', role);
    (data || []).forEach((r) => (perms[r.permission] = r.allowed));
  }
  // While previewing, nothing can be changed
  const canEdit = (p) => !!perms[p] && !preview;
  return { supabase, user, profile, perms, preview, canEdit };
}

export async function requirePerm(perm) {
  const s = await getSession();
  if (!s.perms[perm]) redirect(s.profile.role === 'staff' ? '/staff' : '/manager?denied=1');
  return s;
}
