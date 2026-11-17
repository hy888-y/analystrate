'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/auth';

export async function setPermission(role, permission, allowed) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'Your session has expired.' };
  const { data: me } = await sb.from('profiles').select('id,email,role,status').eq('id', user.id).single();
  if (!me || me.role !== 'admin' || me.status !== 'active') return { error: 'Only an Admin can change permissions.' };
  if (!['manager', 'staff'].includes(role) || !PERMISSIONS.includes(permission)) return { error: 'Invalid permission.' };
  // The database rule also blocks anyone who is not an Admin
  const { error } = await sb.from('role_permissions').upsert({ role, permission, allowed: !!allowed });
  if (error) return { error: error.message };
  await logAudit({ actorId: me.id, actorEmail: me.email, action: 'settings.permission', targetType: 'role', targetId: role, details: { role, permission, allowed: !!allowed } });
  revalidatePath('/manager', 'layout');
  return { ok: true };
}
