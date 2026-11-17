'use server';
import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';

const ROLES = ['admin', 'manager', 'staff'];
const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || '';
const DOMAIN = () => (process.env.COMPANY_EMAIL_DOMAIN || '').trim().toLowerCase();

// Every action re-checks the caller on the server: hiding buttons is not enough.
async function caller() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Your session has expired. Sign in again.');
  const { data: ok } = await sb.rpc('has_perm', { p: 'users.manage' });
  if (!ok) throw new Error('You do not have permission to manage user accounts.');
  const { data: me } = await sb.from('profiles').select('id,email,role').eq('id', user.id).single();
  return me;
}
function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ', b = 'abcdefghijkmnpqrstuvwxyz', d = '23456789';
  const all = a + b + d, r = randomBytes(14);
  let p = a[r[0] % a.length] + b[r[1] % b.length] + d[r[2] % d.length];
  for (let i = 3; i < 14; i++) p += all[r[i] % all.length];
  return p.split('').sort(() => (randomBytes(1)[0] > 127 ? 1 : -1)).join('');
}
function clean(input) {
  return {
    full_name: String(input.full_name || '').trim().slice(0, 100),
    email: String(input.email || '').trim().toLowerCase(),
    staff_code: String(input.staff_code || '').trim().slice(0, 30) || null,
    position: String(input.position || '').trim().slice(0, 80) || null,
    role: ROLES.includes(input.role) ? input.role : 'staff',
    max_tasks: Math.min(100, Math.max(1, parseInt(input.max_tasks, 10) || 5)),
  };
}
async function validate(admin, v, id) {
  if (!v.full_name) return 'Enter the full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return 'Enter a valid email address.';
  if (DOMAIN() && !v.email.endsWith('@' + DOMAIN())) return `Use a company email ending in @${DOMAIN()}.`;
  const { data: e } = await admin.from('profiles').select('id').eq('email', v.email).maybeSingle();
  if (e && e.id !== id) return 'An account with this email already exists.';
  if (v.staff_code) {
    const { data: s } = await admin.from('profiles').select('id,full_name').ilike('staff_code', v.staff_code).maybeSingle();
    if (s && s.id !== id) return `Staff ID ${v.staff_code} is already used by ${s.full_name}.`;
  }
  return null;
}
const fail = (e) => ({ error: e?.message || String(e) });

export async function createUserAccount(input) {
  try {
    const me = await caller();
    const admin = createAdminClient();
    const v = clean(input);
    if (me.role !== 'admin' && v.role !== 'staff') return { error: 'Only an Admin can create Admin or Manager accounts.' };
    const bad = await validate(admin, v); if (bad) return { error: bad };

    let userId, temp = null;
    if (input.method === 'invite') {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { data: { full_name: v.full_name }, redirectTo: `${SITE()}/reset-password` });
      if (error) return { error: error.message.includes('already') ? 'An account with this email already exists.' : error.message };
      userId = data.user.id;
    } else {
      temp = tempPassword();
      const { data, error } = await admin.auth.admin.createUser({ email: v.email, password: temp, email_confirm: true, user_metadata: { full_name: v.full_name } });
      if (error) return { error: error.message.includes('already') ? 'An account with this email already exists.' : error.message };
      userId = data.user.id;
    }
    const { error: pe } = await admin.from('profiles').upsert({ id: userId, ...v, status: 'active', must_change_password: true });
    if (pe) return { error: pe.message };
    await logAudit({ actorId: me.id, actorEmail: me.email, action: 'user.create', targetType: 'user', targetId: userId, details: { email: v.email, role: v.role, method: input.method } });
    revalidatePath('/manager/users');
    return { ok: true, tempPassword: temp };
  } catch (e) { return fail(e); }
}

export async function updateUserAccount(id, input) {
  try {
    const me = await caller();
    const admin = createAdminClient();
    const { data: cur } = await admin.from('profiles').select('*').eq('id', id).single();
    if (!cur) return { error: 'Account not found.' };
    const v = clean(input);
    if (me.role !== 'admin' && (cur.role !== 'staff' || v.role !== 'staff')) return { error: 'Only an Admin can change Admin or Manager accounts.' };
    if (id === me.id && v.role !== cur.role) return { error: 'You cannot change your own role. Ask another Admin.' };
    const bad = await validate(admin, v, id); if (bad) return { error: bad };
    if (v.email !== cur.email) {
      const { error } = await admin.auth.admin.updateUserById(id, { email: v.email, email_confirm: true });
      if (error) return { error: error.message };
    }
    const { error } = await admin.from('profiles').update(v).eq('id', id);
    if (error) return { error: error.message };
    const changed = Object.keys(v).filter((k) => v[k] !== cur[k]);
    if (changed.length) await logAudit({ actorId: me.id, actorEmail: me.email, action: v.role !== cur.role ? 'user.role_change' : 'user.update', targetType: 'user', targetId: id,
      details: { email: v.email, fields: changed, ...(v.role !== cur.role ? { from: cur.role, to: v.role } : {}) } });
    revalidatePath('/manager/users');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setUserStatus(id, active) {
  try {
    const me = await caller();
    if (id === me.id) return { error: 'You cannot deactivate your own account.' };
    const admin = createAdminClient();
    const { data: cur } = await admin.from('profiles').select('role,email').eq('id', id).single();
    if (!cur) return { error: 'Account not found.' };
    if (me.role !== 'admin' && cur.role !== 'staff') return { error: 'Only an Admin can change Admin or Manager accounts.' };
    const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
    if (be) return { error: be.message };
    const { error } = await admin.from('profiles').update({ status: active ? 'active' : 'inactive' }).eq('id', id);
    if (error) return { error: error.message };
    await logAudit({ actorId: me.id, actorEmail: me.email, action: active ? 'user.activate' : 'user.deactivate', targetType: 'user', targetId: id, details: { email: cur.email } });
    revalidatePath('/manager/users');
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function resetUserPassword(id, method) {
  try {
    const me = await caller();
    const admin = createAdminClient();
    const { data: cur } = await admin.from('profiles').select('role,email').eq('id', id).single();
    if (!cur) return { error: 'Account not found.' };
    if (me.role !== 'admin' && cur.role !== 'staff') return { error: 'Only an Admin can reset Admin or Manager passwords.' };
    let temp = null;
    if (method === 'email') {
      const { error } = await admin.auth.resetPasswordForEmail(cur.email, { redirectTo: `${SITE()}/reset-password` });
      if (error) return { error: error.message };
    } else {
      temp = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(id, { password: temp });
      if (error) return { error: error.message };
      await admin.from('profiles').update({ must_change_password: true }).eq('id', id);
    }
    await logAudit({ actorId: me.id, actorEmail: me.email, action: 'user.password_reset', targetType: 'user', targetId: id, details: { email: cur.email, method } });
    return { ok: true, tempPassword: temp };
  } catch (e) { return fail(e); }
}

// Permanent delete. Their tasks stay in the system as Unassigned; the audit log keeps a record.
export async function deleteUserAccount(id) {
  try {
    const me = await caller();
    if (me.role !== 'admin') return { error: 'Only an Admin can delete accounts.' };
    if (id === me.id) return { error: 'You cannot delete your own account.' };
    const admin = createAdminClient();
    const { data: cur } = await admin.from('profiles').select('email,full_name,role').eq('id', id).single();
    if (!cur) return { error: 'Account not found.' };
    const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_id', id).neq('status', 'Completed');
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return { error: error.message };
    await logAudit({ actorId: me.id, actorEmail: me.email, action: 'user.delete', targetType: 'user', targetId: id, details: { email: cur.email, name: cur.full_name, role: cur.role, open_tasks_unassigned: count || 0 } });
    revalidatePath('/manager/users');
    return { ok: true, unassigned: count || 0 };
  } catch (e) { return fail(e); }
}
