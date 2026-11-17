'use client';
import { useState } from 'react';
import { setPermission } from './actions';
import { toast } from '@/components/ui';
import Icon from '@/components/icons';
import { startPreview } from './preview-actions';

const PERMS = [
  ['tasks.manage', 'Create, edit, delete, assign and reassign tasks'],
  ['staff.view', 'View all staff and their workloads'],
  ['reports.view', 'View task performance reports'],
  ['users.manage', 'Manage staff accounts (staff only; never Admin or Manager accounts)'],
  ['audit.view', 'View the audit log'],
];

export default function Permissions({ rows, staff = [] }) {
  const init = {}; rows.forEach((r) => (init[`${r.role}:${r.permission}`] = r.allowed));
  const [v, setV] = useState(init); const [busy, setBusy] = useState('');
  async function flip(role, perm) {
    const k = `${role}:${perm}`, next = !v[k];
    setBusy(k); const r = await setPermission(role, perm, next); setBusy('');
    if (r.error) return toast(r.error);
    setV((x) => ({ ...x, [k]: next })); toast('Permission saved');
  }
  return (
    <>
      <div className="head" style={{ marginTop: 8 }}><div><h2 style={{ fontSize: 20 }}>Role permissions</h2><p className="sub">Admins always have full access. Changes apply immediately and are enforced by the database, not just hidden in the menus.</p></div></div>
      <section className="panel">
        <div className="perm-row" style={{ background: 'var(--sunk)' }}><span className="label">Permission</span><span className="label c">Admin</span><span className="label c">Manager</span><span className="label c">Staff</span></div>
        <div className="perm-grid">{PERMS.map(([p, label]) => (
          <div className="perm-row" key={p}>
            <span>{label}</span>
            <span className="c"><input type="checkbox" className="chk" checked disabled aria-label={`Admin: ${label}`} /></span>
            <span className="c"><input type="checkbox" className="chk" checked={!!v[`manager:${p}`]} disabled={busy === `manager:${p}`} onChange={() => flip('manager', p)} aria-label={`Manager: ${label}`} /></span>
            <span className="c"><input type="checkbox" className="chk" checked={false} disabled aria-label={`Staff: ${label}`} title="Staff never get management permissions" /></span>
          </div>))}</div>
      </section>
      <div className="notice info">Staff can always see and update only the tasks assigned to them. They can never create, delete or reassign tasks, manage accounts or see reports.</div>
      <div className="head" style={{ marginTop: 8 }}><div><h2>Preview the portals</h2><p className="sub">See exactly what each role sees, using the permissions above. Previews are read-only; use Exit preview in the yellow bar to come back.</p></div></div>
      <div className="preview-cards">
        <form action={startPreview} className="card">
          <input type="hidden" name="kind" value="manager" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="stat-ico"><Icon name="users" /></span><h3>Manager view</h3></div>
          <p className="sub" style={{ margin: 0 }}>The menu and pages a Manager gets with the permissions currently ticked.</p>
          <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}><Icon name="eye" size={16} />View as Manager</button>
        </form>
        <form action={startPreview} className="card">
          <input type="hidden" name="kind" value="staff" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="stat-ico"><Icon name="account" /></span><h3>Staff view</h3></div>
          <p className="sub" style={{ margin: 0 }}>The Staff portal as a chosen staff member sees it, with their own tasks.</p>
          {staff.length ? <>
            <label className="label" htmlFor="pv-staff">Staff member</label>
            <select id="pv-staff" name="staffId" required defaultValue={staff[0].id}>{staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}{p.position ? ` · ${p.position}` : ''}</option>)}</select>
            <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}><Icon name="eye" size={16} />View as Staff</button>
          </> : <span className="small muted">Register at least one active Staff account to preview the Staff portal.</span>}
        </form>
      </div>
    </>
  );
}
