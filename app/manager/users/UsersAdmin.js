'use client';
import { useState } from 'react';
import { useLive, must } from '@/components/useLive';
import { fd, fdt } from '@/lib/tasks';
import { Modal, ConfirmButton, toast, initials } from '@/components/ui';
import { CountUp } from '@/components/ui';
import Icon from '@/components/icons';
import { createUserAccount, updateUserAccount, setUserStatus, resetUserPassword, deleteUserAccount } from './actions';

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };
const POSITIONS = ['Intern', 'Associate', 'Senior Associate', 'Assistant Manager', 'Manager', 'Senior Manager', 'Partner', 'Admin Executive'];

function TempPassword({ value }) {
  return (
    <div className="notice ok" style={{ display: 'grid', gap: 8 }}>
      <span>Temporary password (shown once). Give it to the employee privately. They must change it at first sign-in.</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code className="mono" style={{ fontSize: 16, padding: '6px 10px', background: 'var(--surface)', borderRadius: 6, userSelect: 'all' }}>{value}</code>
        <button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copied'), () => {})}>Copy</button>
      </div>
    </div>
  );
}

function UserForm({ user, isAdmin, domain, onClose }) {
  const u = user || { role: 'staff', max_tasks: 5 };
  const [f, setF] = useState({ full_name: u.full_name || '', email: u.email || '', staff_code: u.staff_code || '', position: u.position || '', role: u.role, max_tasks: u.max_tasks || 5, method: 'password' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [temp, setTemp] = useState(null); const [sent, setSent] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = user ? await updateUserAccount(user.id, f) : await createUserAccount(f);
    setBusy(false);
    if (r.error) return setErr(r.error);
    toast(user ? 'Account updated' : 'Account created');
    if (r.tempPassword) setTemp(r.tempPassword);
    else if (!user && f.method === 'invite') setSent(true);
    else onClose();
  }
  return (
    <Modal title={user ? 'Edit account' : 'Register employee'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="fh"><h2>{user ? 'Edit account' : 'Register employee'}</h2><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        {temp ? <><TempPassword value={temp} /><div className="factions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div></>
        : sent ? <><div className="notice ok">Invitation sent to {f.email}. They set their own password from the email link.</div><div className="factions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div></>
        : <>
          <div className="fgrid">
            <div className="field"><label className="label" htmlFor="u-name">Full name</label><input id="u-name" type="text" value={f.full_name} onChange={set('full_name')} maxLength={100} autoFocus /></div>
            <div className="field"><label className="label" htmlFor="u-email">Company email</label><input id="u-email" type="email" value={f.email} onChange={set('email')} placeholder={domain ? `name@${domain}` : 'name@company.com'} /></div>
            <div className="field"><label className="label" htmlFor="u-code">Staff ID</label><input id="u-code" type="text" value={f.staff_code} onChange={set('staff_code')} maxLength={30} placeholder="e.g. YL-014" /></div>
            <div className="field"><label className="label" htmlFor="u-pos">Job position</label><input id="u-pos" type="text" list="pos" value={f.position} onChange={set('position')} maxLength={80} /><datalist id="pos">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist></div>
            <div className="field"><label className="label" htmlFor="u-role">User role</label>
              <select id="u-role" value={f.role} onChange={set('role')} disabled={!isAdmin}>{['staff', 'manager', 'admin'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              {!isAdmin && <span className="hint">Only an Admin can grant Manager or Admin roles.</span>}</div>
            <div className="field"><label className="label" htmlFor="u-max">Max open tasks</label><input id="u-max" type="number" min={1} max={100} value={f.max_tasks} onChange={set('max_tasks')} /><span className="hint">Above this, staff are flagged as overloaded.</span></div>
          </div>
          {!user && <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 6 }}>
            <legend className="label" style={{ padding: '0 4px' }}>How they get their password</legend>
            <label className="check"><input type="radio" name="method" value="password" checked={f.method === 'password'} onChange={set('method')} /> Create a temporary password for me to give them</label>
            <label className="check"><input type="radio" name="method" value="invite" checked={f.method === 'invite'} onChange={set('method')} /> Email them an invitation link</label>
          </fieldset>}
          {err && <div className="err" role="alert">{err}</div>}
          <div className="factions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : user ? 'Save changes' : 'Create account'}</button></div>
        </>}
      </form>
    </Modal>
  );
}

function ResetModal({ user, onClose }) {
  const [temp, setTemp] = useState(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function run(method) {
    setBusy(true); const r = await resetUserPassword(user.id, method); setBusy(false);
    if (r.error) return setMsg(r.error);
    if (r.tempPassword) setTemp(r.tempPassword); else setMsg(`Reset link sent to ${user.email}.`);
  }
  return (
    <Modal title="Reset password" onClose={onClose}>
      <div className="sb">
        <div className="fh"><h2>Reset password</h2><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <p className="sub" style={{ margin: 0 }}>{user.full_name} · {user.email}</p>
        {temp ? <TempPassword value={temp} /> : msg ? <div className="notice info">{msg}</div> : (
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run('email')}>Email a reset link</button>
            <button className="btn" disabled={busy} onClick={() => run('temp')}>Set a temporary password</button>
          </div>
        )}
        <div className="factions"><button className="btn primary" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

export default function UsersAdmin({ meId, isAdmin, domain }) {
  const { data, error, reload } = useLive(async (sb) => must(sb.from('profiles').select('*').order('created_at', { ascending: false })), ['profiles']);
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [st, setSt] = useState('');
  const [form, setForm] = useState(null); const [reset, setReset] = useState(null);
  const users = data || [];
  const ql = q.trim().toLowerCase();
  const shown = users.filter((u) => (!ql || [u.full_name, u.email, u.staff_code, u.position].join(' ').toLowerCase().includes(ql)) && (!role || u.role === role) && (!st || u.status === st));
  const canEdit = (u) => isAdmin || u.role === 'staff';
  async function remove(u) {
    const r = await deleteUserAccount(u.id);
    if (r.error) return toast(r.error);
    toast(r.unassigned ? `Account deleted. ${r.unassigned} open task${r.unassigned === 1 ? ' is' : 's are'} now unassigned.` : 'Account deleted'); reload();
  }
  async function toggle(u) {
    const r = await setUserStatus(u.id, u.status !== 'active');
    if (r.error) return toast(r.error);
    toast(u.status === 'active' ? 'Account deactivated. They are signed out immediately.' : 'Account activated'); reload();
  }
  return (
    <>
      <div className="head"><div><h1>Employee Management</h1><p className="sub">Your employee directory. Register employees, assign roles, and activate or deactivate access.</p></div>
        <div className="spacer" /><button className="btn primary" onClick={() => setForm({})}><Icon name="userplus" size={16} />Register Employee</button></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="stats-row">
        <div className="stat s-all"><span className="label">Employees</span><span className="v"><CountUp v={users.length} /></span><span className="chip"><Icon name="users" /></span></div>
        <div className="stat s-co"><span className="label">Active</span><span className="v"><CountUp v={users.filter((u) => u.status === 'active').length} /></span><span className="chip"><Icon name="done" /></span></div>
        <div className="stat s-ns"><span className="label">Inactive</span><span className="v"><CountUp v={users.filter((u) => u.status !== 'active').length} /></span><span className="chip"><Icon name="pause" /></span></div>
        <div className="stat s-ip"><span className="label">Admins / Managers</span><span className="v"><CountUp v={users.filter((u) => u.role !== 'staff').length} /></span><span className="chip"><Icon name="shield" /></span></div>
      </div>
      <div className="toolbar">
        <input type="search" className="search" placeholder="Search name, email, staff ID or position" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"><option value="">All roles</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="staff">Staff</option></select>
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>
      <section className="panel">
        {shown.length ? <div className="tbl"><table className="rt"><thead><tr><th>Employee ID</th><th>Full name</th><th>Company email</th><th>Job position</th><th>Role</th><th>Account status</th><th>Date created</th><th className="r">Actions</th></tr></thead>
          <tbody>{shown.map((u) => (
            <tr key={u.id} style={u.status !== 'active' ? { opacity: 0.6 } : undefined}>
              <td data-label="Employee ID"><span className="tid">{u.staff_code || '—'}</span></td>
              <td className="full" data-label="Full name"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="avatar sm" aria-hidden="true">{initials(u.full_name)}</span><div><b>{u.full_name}</b>{u.id === meId && <span className="muted"> (you)</span>}<div className="small muted">Last login: {u.last_login_at ? fdt(u.last_login_at) : 'Never'}</div></div></div></td>
              <td data-label="Company email" style={{ whiteSpace: 'nowrap' }}>{u.email}</td>
              <td data-label="Job position">{u.position || '—'}</td>
              <td data-label="Role"><span className={`badge ${u.role === 'admin' ? 'b-accent' : u.role === 'manager' ? 'b-info' : 'b-none'}`}>{ROLE_LABEL[u.role]}</span></td>
              <td data-label="Account status"><span className={`badge ${u.status === 'active' ? 'b-avail' : 'b-over'}`}>{u.status === 'active' ? 'Active' : 'Inactive'}</span>{u.must_change_password && <div className="small muted">Must set password</div>}</td>
              <td data-label="Date created" className="num">{fd(u.created_at)}</td>
              <td className="full r"><div className="acts" style={{ flexWrap: 'wrap', minWidth: 190 }}>{canEdit(u) ? <>
                <button className="btn small" onClick={() => setForm({ user: u })}>Edit</button>
                <button className="btn small" onClick={() => setReset(u)}>Reset password</button>
                {u.id !== meId && (u.status === 'active' ? <ConfirmButton onConfirm={() => toggle(u)}>Deactivate</ConfirmButton> : <button className="btn small" onClick={() => toggle(u)}>Activate</button>)}
                {u.id !== meId && isAdmin && <ConfirmButton onConfirm={() => remove(u)} confirmText="Click again to delete permanently">Delete</ConfirmButton>}
              </> : <span className="small muted">Admin only</span>}</div></td>
            </tr>))}</tbody></table></div>
          : <div className="empty"><b>{users.length ? 'No accounts match' : 'No accounts yet'}</b></div>}
      </section>
      {form && <UserForm user={form.user} isAdmin={isAdmin} domain={domain} onClose={() => { setForm(null); reload(); }} />}
      {reset && <ResetModal user={reset} onClose={() => { setReset(null); reload(); }} />}
    </>
  );
}
