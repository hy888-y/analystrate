'use client';
import { useState } from 'react';
import { useLive, must } from '@/components/useLive';
import { fdt } from '@/lib/tasks';

const LABELS = {
  'auth.login': 'Signed in', 'auth.login_failed': 'Failed sign-in', 'auth.login_blocked': 'Blocked sign-in (inactive)', 'auth.logout': 'Signed out',
  'auth.reset_requested': 'Password reset requested', 'auth.password_changed': 'Password changed',
  'user.create': 'Account created', 'user.update': 'Account edited', 'user.role_change': 'Role changed', 'user.activate': 'Account activated',
  'user.deactivate': 'Account deactivated', 'user.delete': 'Account deleted', 'user.password_reset': 'Password reset by admin', 'settings.permission': 'Permission changed', 'settings.preview': 'Previewed a portal',
  'task.create': 'Task created', 'task.update': 'Task edited', 'task.delete': 'Task deleted', 'task.assign': 'Task assigned', 'task.reassign': 'Task reassigned', 'task.unassign': 'Task unassigned',
};
const GROUPS = [['', 'All activity'], ['auth.', 'Sign-in and passwords'], ['user.', 'User accounts'], ['task.', 'Tasks'], ['settings.', 'Permissions']];

export default function AuditLog() {
  const [group, setGroup] = useState(''); const [q, setQ] = useState('');
  const { data, error } = useLive(async (sb) => {
    let query = sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (group) query = query.like('action', group + '%');
    const rows = await must(query);
    const ids = [...new Set(rows.flatMap((r) => [r.details?.from, r.details?.to, r.details?.assignee]).filter(Boolean))];
    const names = {};
    if (ids.length) (await must(sb.rpc('public_names', { ids }))).forEach((x) => (names[x.id] = x.full_name));
    return { rows, names };
  }, ['tasks'], group);
  const rows = data?.rows || [], names = data?.names || {};
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => !ql || JSON.stringify(r).toLowerCase().includes(ql));
  const detail = (r) => {
    const d = r.details || {};
    const n = (id) => (id ? names[id] || 'someone' : 'Unassigned');
    if (r.action === 'task.reassign') return `${d.title}: ${n(d.from)} → ${n(d.to)}`;
    if (r.action === 'task.assign') return `${d.title} → ${n(d.to)}`;
    if (r.action === 'task.update') return `${d.title} (${(d.fields || []).join(', ').replace(/_/g, ' ')})`;
    if (r.action.startsWith('task.')) return d.title || '';
    if (r.action === 'user.role_change') return `${d.email}: ${d.from} → ${d.to}`;
    if (r.action === 'settings.permission') return `${d.role}: ${d.permission} ${d.allowed ? 'allowed' : 'removed'}`;
    if (r.action.startsWith('user.')) return [d.email, d.role, d.method].filter(Boolean).join(' · ');
    return d.ip ? `IP ${d.ip}` : '';
  };
  return (
    <>
      <div className="head"><div><h1>Audit Log</h1><p className="sub">Sign-ins, account changes, permission changes and task assignments. Entries cannot be edited or deleted.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="toolbar">
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Activity type">{GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input type="search" className="search" placeholder="Search email or detail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
      </div>
      <section className="panel">
        {shown.length ? <div className="tbl"><table className="rt"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className={r.action === 'auth.login_failed' || r.action === 'auth.login_blocked' ? 'hot' : ''}>
              <td data-label="When" className="num small" style={{ whiteSpace: 'nowrap' }}>{fdt(r.created_at)}</td>
              <td data-label="Who" style={{ wordBreak: 'break-all' }}>{r.actor_email || 'System'}</td>
              <td data-label="Action">{LABELS[r.action] || r.action}</td>
              <td className="full" data-label="Detail"><span className="small">{detail(r)}</span></td>
            </tr>))}</tbody></table></div>
          : <div className="empty"><b>{data ? 'No activity recorded yet' : 'Loading…'}</b></div>}
      </section>
      <p className="small muted">Showing the latest 500 entries.</p>
    </>
  );
}
