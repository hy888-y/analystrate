'use client';
import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLive } from '@/components/useLive';
import { loadBoard } from '../TaskMonitor';
import { effStatus, workload, fd, taskCode } from '@/lib/tasks';
import { StatusPill, DueNote, DoneNote, Progress, Priority, Modal, toast, friendlyError, initials } from '@/components/ui';
import { CountUp } from '@/components/ui';
import Icon from '@/components/icons';
import TaskForm from '@/components/TaskForm';

export default function StaffAllocation({ canManage }) {
  const { data, error, reload } = useLive(loadBoard, ['tasks', 'profiles']);
  const [q, setQ] = useState(''); const [lv, setLv] = useState('');
  const [open, setOpen] = useState(null); const [form, setForm] = useState(null); const [alloc, setAlloc] = useState(null);
  const tasks = data?.tasks || [], people = data?.people || [];
  const staff = people.filter((p) => p.role === 'staff');
  const rows = useMemo(() => staff.map((p) => ({ p, w: workload(p, tasks) })), [staff, tasks]);
  const act = rows.filter((r) => r.p.status === 'active');
  const over = act.filter((r) => r.w.lv === 'over'), avail = act.filter((r) => r.w.lv === 'avail' || r.w.lv === 'none');
  const unassigned = tasks.filter((t) => !t.assignee_id && t.status !== 'Completed');
  const avg = act.length ? act.reduce((a, r) => a + r.w.open, 0) / act.length : 0;
  const scale = Math.max(1, ...act.map((r) => Math.max(r.w.open, r.w.max)));
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!ql || [r.p.full_name, r.p.staff_code, r.p.position].join(' ').toLowerCase().includes(ql))
    && (!lv || (lv === 'avail' ? ['avail', 'none'].includes(r.w.lv) : r.w.lv === lv)))
    .sort((a, b) => (a.p.status !== 'active') - (b.p.status !== 'active') || b.w.open - a.w.open || a.p.full_name.localeCompare(b.p.full_name));

  async function assign(taskId, to) {
    const { error } = await createClient().from('tasks').update({ assignee_id: to }).eq('id', taskId);
    if (error) return toast(friendlyError(error));
    toast(to ? `Assigned to ${people.find((p) => p.id === to)?.full_name}` : 'Task unassigned'); reload();
  }
  const pickOptions = (first) => (<><option value="">{first}</option>{act.map((r) => <option key={r.p.id} value={r.p.id}>{r.p.full_name} · {r.w.open}/{r.w.max} open{r.w.lv === 'over' ? ' (overloaded)' : ''}</option>)}</>);
  const detail = open && staff.find((p) => p.id === open);

  return (
    <>
      <div className="head"><div><h1>Staff Allocation</h1><p className="sub">Workload is each employee's open tasks against their task capacity. Changes here and in Task Monitoring update both pages instantly.</p></div>
        <div className="spacer" />{canManage && <button className="btn primary" onClick={() => setAlloc({})}><Icon name="userplus" size={16} />Allocate Task</button>}</div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="stats-row">
        <div className="stat s-all"><span className="label">Active staff</span><span className="v"><CountUp v={act.length} /></span><span className="chip"><Icon name="users" /></span></div>
        <button type="button" className="stat s-od" aria-pressed={lv === 'over'} onClick={() => setLv(lv === 'over' ? '' : 'over')}><span className="label">Overloaded</span><span className="v"><CountUp v={over.length} /></span><span className="chip"><Icon name="alert" /></span></button>
        <button type="button" className="stat s-co" aria-pressed={lv === 'avail'} onClick={() => setLv(lv === 'avail' ? '' : 'avail')}><span className="label">Has capacity</span><span className="v"><CountUp v={avail.length} /></span><span className="chip"><Icon name="done" /></span></button>
        <div className="stat s-ip"><span className="label">Avg open per person</span><span className="v"><CountUp v={avg} decimals={1} /></span><span className="chip"><Icon name="chart" /></span></div>
        <div className="stat s-pe"><span className="label">Unassigned tasks</span><span className="v"><CountUp v={unassigned.length} /></span><span className="chip"><Icon name="tasks" /></span></div>
      </div>
      {over.length > 0 && <div className="notice bad"><b>{over.map((r) => r.p.full_name).join(', ')}</b> {over.length === 1 ? 'has' : 'have'} more outstanding tasks than their limit.{avail.length ? ` Staff with capacity: ${avail.slice(0, 3).map((r) => r.p.full_name).join(', ')}.` : ''}</div>}

      {detail && (() => {
        const w = workload(detail, tasks);
        const ts = tasks.filter((t) => t.assignee_id === detail.id).sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || a.due_date.localeCompare(b.due_date));
        return (
          <section className="panel" style={{ borderColor: 'var(--accent)' }}>
            <div className="ph"><div><h2>{detail.full_name}</h2><div className="small muted">{detail.position || 'No position'} · <span className="mono">{detail.staff_code || 'No ID'}</span></div></div>
              <span className={`badge b-${w.lv}`}>{w.label}</span><div className="spacer" />
              {canManage && <button className="btn small primary" onClick={() => setAlloc({ who: detail.id })}>Allocate tasks</button>}
              <button className="btn small" onClick={() => setOpen(null)}>Close</button></div>
            <div className="pb meta"><div><span className="label">Total</span><span className="num">{w.c.total}</span></div><div><span className="label">Completed</span><span className="num">{w.c.Completed}</span></div>
              <div><span className="label">Outstanding</span><span className="num">{w.open} of {w.max}</span></div><div><span className="label">Overdue</span><span className="num" style={w.c.Overdue ? { color: 'var(--bad)' } : undefined}>{w.c.Overdue}</span></div>
              <div style={{ minWidth: 180, flex: 1 }}><span className="label">Completion progress</span><Progress value={w.pct} /></div></div>
            {ts.length ? (
              <div className="tbl"><table className="rt"><thead><tr><th>Task</th><th>Start date</th><th>Deadline</th><th>Completion date</th><th>Status</th>{canManage && <th>Reassign to</th>}</tr></thead><tbody>
                {ts.map((t) => (
                  <tr key={t.id}><td className="full" data-label="Task"><div className="tname"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div></td>
                    <td data-label="Start date" className="num">{fd(t.start_date)}</td><td data-label="Deadline" className="num">{fd(t.due_date)}<DueNote t={t} /></td>
                    <td data-label="Completion date" className="num">{fd(t.completed_at)}<DoneNote t={t} /></td><td data-label="Status"><StatusPill s={effStatus(t)} /></td>
                    {canManage && <td data-label="Reassign to">{t.status === 'Completed' ? <span className="muted small">Completed</span> :
                      <select value="" onChange={(e) => e.target.value && assign(t.id, e.target.value === '__none' ? null : e.target.value)} aria-label={`Reassign ${t.title}`}>{pickOptions('Move to…')}<option value="__none">Unassigned</option></select>}</td>}
                  </tr>))}
              </tbody></table></div>
            ) : <div className="empty"><b>No tasks assigned</b><span>{detail.full_name} can take up to {w.max} open tasks.</span></div>}
          </section>
        );
      })()}

      {unassigned.length > 0 && (
        <section className="panel"><div className="ph"><h2>Unassigned tasks</h2><span className="muted small">Pick a person. Each name shows open tasks against their limit.</span></div>
          <div className="list">{unassigned.map((t) => (
            <div className="row" key={t.id}><div className="grow"><div className="t"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div><div className="m">Due {fd(t.due_date)}</div></div>
              {canManage && <select value="" onChange={(e) => e.target.value && assign(t.id, e.target.value)} aria-label={`Assign ${t.title}`}>{pickOptions('Assign to…')}</select>}</div>))}</div>
        </section>
      )}

      {act.length > 0 && (
        <section className="panel"><div className="ph"><h2>Workload comparison</h2><span className="muted small">Outstanding tasks per person. The dark line marks each person's limit.</span></div>
          <div className="wl">
            {act.slice().sort((a, b) => b.w.open - a.w.open).map(({ p, w }) => { const x = (n) => `${(n / scale) * 100}%`; return (
              <div className="wl-row" key={p.id}>
                <button type="button" className="btn link wl-name" style={{ color: 'var(--fg)', textDecoration: 'none', textAlign: 'left' }} onClick={() => setOpen(p.id)}>{p.full_name}</button>
                <div className="wl-bar" title={`${w.open} outstanding, limit ${w.max}`}>
                  <span className="seg-od" style={{ width: x(w.c.Overdue) }} /><span className="seg-ip" style={{ width: x(w.c['In Progress']) }} /><span className="seg-pe" style={{ width: x(w.c.Pending) }} /><span className="seg-ns" style={{ width: x(w.c['Not Started']) }} />
                  <i className="wl-cap" style={{ left: x(w.max) }} />
                </div>
                <span className="num small" style={{ color: w.lv === 'over' ? 'var(--bad)' : 'var(--muted)' }}>{w.open}/{w.max}</span>
              </div>); })}
            <div className="toolbar" style={{ marginTop: 4 }}>
              <span className="key"><i className="seg-od" />Overdue</span><span className="key"><i className="seg-ip" />In progress</span><span className="key"><i className="seg-pe" />Pending</span><span className="key"><i className="seg-ns" />Not started</span>
              <span className="key"><i style={{ background: 'var(--fg)', width: 2, height: 12, opacity: 0.55 }} />Limit</span>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="ph"><h2>Employee workload</h2><div className="spacer" />
          <input type="search" placeholder="Search employee, ID or position" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search staff" style={{ flex: '1 1 200px', maxWidth: 280 }} />
          <select value={lv} onChange={(e) => setLv(e.target.value)} aria-label="Filter by workload"><option value="">All workloads</option><option value="over">Overloaded</option><option value="full">At capacity</option><option value="avail">Has capacity</option></select></div>
        {shown.length ? (
          <div className="tbl"><table className="rt"><thead><tr><th>Employee name</th><th>Position</th><th className="r">Total assigned</th><th className="r">Completed</th><th className="r">In progress</th><th className="r">Pending</th><th className="r">Overdue</th><th style={{ minWidth: 190 }}>Workload</th><th className="r">Actions</th></tr></thead>
            <tbody>{shown.map(({ p, w }) => (
              <tr key={p.id} className={w.lv === 'over' && p.status === 'active' ? 'hot' : ''} style={p.status !== 'active' ? { opacity: 0.55 } : undefined}>
                <td className="full" data-label="Employee name"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="avatar sm" aria-hidden="true">{initials(p.full_name)}</span><div><b>{p.full_name}</b><div className="small muted"><span className="tid">{p.staff_code || 'No ID'}</span>{p.status !== 'active' ? ' · Inactive' : ''}</div></div></div></td>
                <td data-label="Position">{p.position || '—'}</td>
                <td data-label="Total assigned" className="r num">{w.c.total}</td><td data-label="Completed" className="r num">{w.c.Completed}</td><td data-label="In progress" className="r num">{w.c['In Progress']}</td>
                <td data-label="Pending" className="r num">{w.c.Pending}</td>
                <td data-label="Overdue" className="r num" style={w.c.Overdue ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{w.c.Overdue}</td>
                <td data-label="Workload"><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span className={`badge b-${w.lv}`}>{w.label}</span><span className="small muted num">{w.open}/{w.max} open</span></div><div className={`cap ${w.lv}`}><i style={{ width: `${Math.min(100, w.ratio * 100)}%` }} /></div></td>
                <td className="full r"><div className="acts"><button className="btn small" onClick={() => { setOpen(p.id); window.scrollTo({ top: 0 }); }}>View tasks</button>{canManage && p.status === 'active' && <button className="btn small dark" onClick={() => setAlloc({ who: p.id })}>Assign</button>}</div></td>
              </tr>))}</tbody></table></div>
        ) : <div className="empty"><b>{staff.length ? 'No staff match' : 'No staff accounts yet'}</b><span>{staff.length ? 'Change the search or workload filter.' : 'An Admin adds staff in User accounts. They then appear here.'}</span></div>}
      </section>
      {form && <TaskForm presetAssignee={form.who} staff={people} tasks={tasks} onClose={(c) => { setForm(null); if (c) reload(); }} />}
      {alloc && <Allocate who={alloc.who} rows={act} tasks={tasks} nameOf={(id) => people.find((x) => x.id === id)?.full_name || 'Unassigned'}
        onNew={(who) => { setAlloc(null); setForm({ who }); }} onClose={(c) => { setAlloc(null); if (c) reload(); }} />}
    </>
  );
}

// Assign several tasks to one employee in one step. Shows capacity so managers can see the result before saving.
function Allocate({ who, rows, tasks, nameOf, onNew, onClose }) {
  const [to, setTo] = useState(who || ''); const [pick, setPick] = useState(new Set()); const [all, setAll] = useState(false); const [busy, setBusy] = useState(false);
  const pool = tasks.filter((t) => t.status !== 'Completed' && t.assignee_id !== to && (all || !t.assignee_id));
  const target = rows.find((r) => r.p.id === to);
  const after = target ? target.w.open + pick.size : 0;
  const flip = (id) => setPick((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function save() {
    if (!to || !pick.size) return;
    setBusy(true);
    const { error } = await createClient().from('tasks').update({ assignee_id: to }).in('id', [...pick]);
    setBusy(false);
    if (error) return toast(friendlyError(error));
    toast(`${pick.size} task${pick.size === 1 ? '' : 's'} allocated to ${nameOf(to)}`); onClose(true);
  }
  return (
    <Modal title="Allocate tasks" onClose={() => onClose(false)} wide>
      <div className="sb">
        <div className="fh"><h2>Allocate tasks</h2><button className="btn small" onClick={() => onClose(false)}>Close</button></div>
        <div className="field"><label className="label" htmlFor="al-to">Employee</label>
          <select id="al-to" value={to} onChange={(e) => { setTo(e.target.value); setPick(new Set()); }}>
            <option value="">Choose an employee…</option>
            {rows.map((r) => <option key={r.p.id} value={r.p.id}>{r.p.full_name} · {r.w.open}/{r.w.max} open{r.w.lv === 'over' ? ' (overloaded)' : ''}</option>)}
          </select></div>
        {target && <div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span className="muted">Workload after allocation</span><b style={after > target.w.max ? { color: 'var(--bad)' } : undefined}>{after} of {target.w.max} open</b></div>
          <div className={`cap ${after > target.w.max ? 'over' : after / target.w.max >= 0.8 ? 'full' : ''}`}><i style={{ width: `${Math.min(100, (after / target.w.max) * 100)}%` }} /></div>
          {after > target.w.max && <div className="small" style={{ color: 'var(--bad)', marginTop: 6 }}>This takes {target.p.full_name} over their capacity of {target.w.max}.</div>}</div>}
        <div className="toolbar"><b style={{ fontSize: 14 }}>Tasks to allocate</b><span className="small muted">{pick.size} selected</span><div className="spacer" />
          <label className="check small"><input type="checkbox" className="chk" checked={all} onChange={(e) => { setAll(e.target.checked); setPick(new Set()); }} />Include tasks already assigned (reassign)</label></div>
        <div className="panel" style={{ maxHeight: 320, overflow: 'auto', boxShadow: 'none' }}>
          {pool.length ? pool.map((t) => (
            <label key={t.id} className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="chk" checked={pick.has(t.id)} onChange={() => flip(t.id)} />
              <div className="grow"><div className="t">{t.title}</div><div className="m"><span className="tid">{taskCode(t)}</span> · Due {fd(t.due_date)}{t.assignee_id ? ` · now with ${nameOf(t.assignee_id)}` : ' · Unassigned'}</div></div>
              <Priority p={t.priority} /><StatusPill s={effStatus(t)} />
            </label>)) : <div className="empty"><b>{all ? 'No other open tasks' : 'No unassigned tasks'}</b><span>{all ? 'Every open task is already with this employee.' : 'Tick “Include tasks already assigned” to move tasks between people, or create a new task.'}</span></div>}
        </div>
        <div className="factions"><button className="btn left" onClick={() => onNew(to || undefined)}><Icon name="plus" size={15} />Create a new task instead</button>
          <button className="btn" onClick={() => onClose(false)}>Cancel</button>
          <button className="btn primary" disabled={!to || !pick.size || busy} onClick={save}>{busy ? 'Allocating…' : `Allocate ${pick.size || ''} task${pick.size === 1 ? '' : 's'}`}</button></div>
      </div>
    </Modal>
  );
}
