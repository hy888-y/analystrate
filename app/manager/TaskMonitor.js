'use client';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLive, must } from '@/components/useLive';
import { STATUSES, SHOW_ORDER, PRIORITIES, effStatus, counts, fd, fdc, taskCode } from '@/lib/tasks';
import { StatusPill, Priority, DueNote, DoneNote, ConfirmButton, toast, friendlyError, CountUp, Skeleton } from '@/components/ui';
import Icon from '@/components/icons';
import Board from '@/components/Board';
import CalendarView from '@/components/CalendarView';
import TaskForm from '@/components/TaskForm';

const EMPTY_F = { q: '', staff: '', status: '', priority: '', dateField: 'due_date', from: '', to: '' };
const PRANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

export async function loadBoard(sb) {
  const [tasks, people] = await Promise.all([
    must(sb.from('tasks').select('*').order('due_date')),
    must(sb.from('profiles').select('id,full_name,role,status,max_tasks,position,staff_code').order('full_name')),
  ]);
  return { tasks, people };
}

export default function TaskMonitor({ canManage }) {
  const { data, error, reload } = useLive(loadBoard, ['tasks', 'profiles']);
  const [f, setF] = useState(EMPTY_F);
  useEffect(() => { const u = new URLSearchParams(window.location.search); const x = {}; ['q', 'status', 'priority'].forEach((k) => { if (u.get(k)) x[k] = u.get(k); }); if (Object.keys(x).length) setF((f0) => ({ ...f0, ...x })); }, []);
  const [page, setPage] = useState(1); const [per, setPer] = useState(10);
  useEffect(() => setPage(1), [f, per]);
  const [sort, setSort] = useState({ k: 'due_date', d: 1 });
  const [sel, setSel] = useState(new Set());
  const [form, setForm] = useState(null);
  const [view, setView] = useState('table');

  const tasks = data?.tasks || [], people = data?.people || [];
  const name = (id) => (id ? people.find((p) => p.id === id)?.full_name || 'Former staff' : 'Unassigned');
  const assignable = people.filter((p) => p.role === 'staff' && p.status === 'active');
  const c = counts(tasks);

  const shown = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    let ts = tasks.filter((t) => {
      if (q && ![taskCode(t), t.title, t.description, name(t.assignee_id)].join(' ').toLowerCase().includes(q)) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.staff && (f.staff === '__none' ? t.assignee_id : t.assignee_id !== f.staff)) return false;
      if (f.status && (f.status === '__open' ? effStatus(t) === 'Completed' : effStatus(t) !== f.status)) return false;
      if (f.from || f.to) { const v = t[f.dateField]; if (!v || (f.from && v < f.from) || (f.to && v > f.to)) return false; }
      return true;
    });
    const val = (t) => sort.k === 'code' ? taskCode(t) : sort.k === 'priority' ? PRANK[t.priority] : sort.k === 'title' ? t.title.toLowerCase() : sort.k === 'staff' ? name(t.assignee_id).toLowerCase() : sort.k === 'status' ? SHOW_ORDER.indexOf(effStatus(t)) : t[sort.k];
    return ts.sort((a, b) => { const x = val(a), y = val(b); if (x == null || x === '') return 1; if (y == null || y === '') return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.d; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, people, f, sort]);

  const sb = createClient();
  async function patch(id, body, msg) {
    const { error } = await sb.from('tasks').update(body).eq('id', id);
    if (error) return toast(friendlyError(error));
    toast(msg); reload();
  }
  async function bulk(body, msg) {
    const ids = [...sel];
    const { error } = await sb.from('tasks').update(body).in('id', ids);
    if (error) return toast(friendlyError(error));
    toast(msg(ids.length)); setSel(new Set()); reload();
  }
  async function bulkDelete() {
    const ids = [...sel];
    const { error } = await sb.from('tasks').delete().in('id', ids);
    if (error) return toast(friendlyError(error));
    toast(`${ids.length} task${ids.length === 1 ? '' : 's'} deleted`); setSel(new Set()); reload();
  }
  async function remove(id) {
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) return toast(friendlyError(error));
    toast('Task deleted'); reload();
  }

  const setFv = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const SortTh = ({ k, children }) => (
    <th aria-sort={sort.k === k ? (sort.d > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort" onClick={() => setSort((s) => (s.k === k ? { k, d: -s.d } : { k, d: 1 }))}>{children}<span aria-hidden="true">{sort.k === k ? (sort.d > 0 ? '▲' : '▼') : '↕'}</span></button>
    </th>
  );
  const ICON = { '': 'layers', 'Not Started': 'circle', 'In Progress': 'play', Pending: 'pause', Overdue: 'alert', Completed: 'done' };
  const Stat = ({ k, label, cls }) => (
    <button type="button" className={`stat ${cls}`} aria-pressed={f.status === k} onClick={() => setF((x) => ({ ...x, status: x.status === k ? '' : k }))}>
      <span className="label">{label}</span><span className="v"><CountUp v={k ? c[k] : c.total} /></span><span className="chip"><Icon name={ICON[k]} /></span>
    </button>
  );
  const move = (t, s) => patch(t.id, { status: s }, s === 'Completed' ? `Completed: ${t.title}` : `${t.title} → ${s}`);
  const anyF = f.q || f.staff || f.status || f.priority || f.from || f.to;
  const pages = Math.max(1, Math.ceil(shown.length / per)); const pg = Math.min(page, pages);
  const rows = shown.slice((pg - 1) * per, pg * per);
  const allSel = shown.length > 0 && shown.every((t) => sel.has(t.id));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <div className="head">
        <div><h1>Task Monitoring</h1><p className="sub">Track every task across the team. Overdue is flagged automatically, and the completion date is recorded when a task is marked Completed.</p></div>
        <div className="spacer" />
        {canManage && <button className="btn primary" onClick={() => setForm({})}><Icon name="plus" size={16} />Create Task</button>}
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="stats-row">
        <Stat k="" label="Total tasks" cls="s-all" /><Stat k="Not Started" label="Not started" cls="s-ns" /><Stat k="In Progress" label="In progress" cls="s-ip" />
        <Stat k="Pending" label="Pending" cls="s-pe" /><Stat k="Overdue" label="Overdue" cls="s-od" /><Stat k="Completed" label="Completed" cls="s-co" />
      </div>
      <div className="toolbar">
        <input type="search" className="search" placeholder="Search task ID, name, description or staff" value={f.q} onChange={setFv('q')} aria-label="Search tasks" />
        <select value={f.staff} onChange={setFv('staff')} aria-label="Filter by employee"><option value="">All employees</option><option value="__none">Unassigned</option>{people.filter((p) => p.role === 'staff').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        <select value={f.status} onChange={setFv('status')} aria-label="Filter by status"><option value="">All statuses</option><option value="__open">All open</option>{SHOW_ORDER.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={f.priority} onChange={setFv('priority')} aria-label="Filter by priority"><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
        <span className="daterange">
          <select value={f.dateField} onChange={setFv('dateField')} aria-label="Date to filter on"><option value="due_date">Due date</option><option value="start_date">Start date</option><option value="completed_at">Completion date</option></select>
          <input type="date" value={f.from} onChange={setFv('from')} aria-label="From date" /><span className="muted">to</span><input type="date" value={f.to} onChange={setFv('to')} aria-label="To date" />
        </span>
        {anyF && <button className="btn small" onClick={() => setF(EMPTY_F)}>Clear filters</button>}
        <div className="spacer" />
        <div className="vswitch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}><Icon name="table" size={15} />Table</button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="board" size={15} />Board</button>
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><Icon name="calendar" size={15} />Calendar</button>
        </div>
      </div>
      <div className="small muted">{data ? `Showing ${shown.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}` : 'Loading tasks…'}</div>
      {canManage && sel.size > 0 && (
        <div className="bulk">
          <b>{sel.size} selected</b>
          <select value="" onChange={(e) => { const v = e.target.value; if (!v) return; const to = v === '__none' ? null : v; bulk({ assignee_id: to }, (n) => `${n} task${n === 1 ? '' : 's'} ${to ? 'assigned to ' + name(to) : 'unassigned'}`); }} aria-label="Reassign selected">
            <option value="">Reassign to…</option><option value="__none">Unassigned</option>{assignable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value="" onChange={(e) => e.target.value && bulk({ status: e.target.value }, (n) => `${n} task${n === 1 ? '' : 's'} set to ${e.target.value}`)} aria-label="Set status of selected">
            <option value="">Set status…</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <ConfirmButton onConfirm={bulkDelete}>Delete selected</ConfirmButton>
          <button className="btn small" onClick={() => setSel(new Set())}>Clear selection</button>
        </div>
      )}
      {!data ? <section className="panel"><Skeleton rows={6} /></section> : view === 'calendar' ? (
        <CalendarView tasks={shown} hrefOf={(t) => `/manager/tasks/${t.id}`} nameOf={name} />
      ) : view === 'board' && shown.length > 0 ? (
        <Board tasks={shown} nameOf={name} hrefOf={(t) => `/manager/tasks/${t.id}`} onMove={move} canMove={canManage} />
      ) : <section className="panel">
        {data && shown.length === 0 ? (
          <div className="empty"><b>{tasks.length ? 'No tasks match these filters' : 'No tasks yet'}</b>
            <span>{tasks.length ? 'Clear the filters to see every task.' : 'Create your first task and assign it to a staff member.'}</span>
            {tasks.length ? <button className="btn" onClick={() => setF(EMPTY_F)}>Clear filters</button> : canManage && <button className="btn primary" onClick={() => setForm({})}>New task</button>}</div>
        ) : (
          <div className="tbl"><table className="rt">
            <thead><tr>
              {canManage && <th style={{ width: 34 }}><input type="checkbox" className="chk" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(shown.map((t) => t.id)))} aria-label="Select all shown" /></th>}
              <SortTh k="code">Task ID</SortTh><SortTh k="title">Task name</SortTh><SortTh k="staff">Assigned staff</SortTh><SortTh k="priority">Priority</SortTh><SortTh k="start_date">Start date</SortTh><SortTh k="due_date">Due date</SortTh><SortTh k="completed_at">Completion date</SortTh><SortTh k="status">Status</SortTh>
              {canManage && <th className="r">Actions</th>}
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={sel.has(t.id) ? 'sel' : ''}>
                  {canManage && <td><input type="checkbox" className="chk" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.title}`} /></td>}
                  <td data-label="Task ID"><a className="tid" href={`/manager/tasks/${t.id}`} style={{ textDecoration: 'none' }}>{taskCode(t)}</a></td>
                  <td className="full" data-label="Task name">
                    <div className="tname"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div>
                    {t.description && <div className="tdesc" title={t.description}>{t.description}</div>}
                  </td>
                  <td data-label="Assigned staff">
                    {canManage ? (
                      <select value={t.assignee_id || ''} style={{ maxWidth: 140 }} aria-label={`Reassign ${t.title}`}
                        onChange={(e) => { const to = e.target.value || null; patch(t.id, { assignee_id: to }, to ? `Assigned to ${name(to)}` : 'Task unassigned'); }}>
                        <option value="">Unassigned</option>
                        {assignable.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                        {t.assignee_id && !assignable.some((p) => p.id === t.assignee_id) && <option value={t.assignee_id}>{name(t.assignee_id)}</option>}
                      </select>
                    ) : name(t.assignee_id)}
                  </td>
                  <td data-label="Priority"><Priority p={t.priority} /></td>
                  <td data-label="Start date" className="num" title={fd(t.start_date)}>{fdc(t.start_date)}</td>
                  <td data-label="Due date" className="num" title={fd(t.due_date)}>{fdc(t.due_date)}<DueNote t={t} /></td>
                  <td data-label="Completion date" className="num" title={fd(t.completed_at)}>{fdc(t.completed_at)}<DoneNote t={t} /></td>
                  <td data-label="Status"><StatusPill s={effStatus(t)} /></td>
                  {canManage && <td className="full r"><div className="acts">
                    <button className="icon-btn sm" onClick={() => setForm({ task: t })} aria-label={`Edit ${t.title}`} title="Edit"><Icon name="edit" size={15} /></button>
                    <ConfirmButton className="icon-btn sm danger" confirmText={<span className="small" style={{ fontWeight: 700 }}>Sure?</span>} onConfirm={() => remove(t.id)}><Icon name="trash" size={15} /></ConfirmButton>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {data && shown.length > 0 && (
          <div className="pager">
            <span>Showing {(pg - 1) * per + 1}–{Math.min(pg * per, shown.length)} of {shown.length}</span>
            <select value={per} onChange={(e) => setPer(Number(e.target.value))} aria-label="Rows per page">{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
            <div className="spacer" />
            <div className="pg">
              <button type="button" disabled={pg <= 1} onClick={() => setPage(pg - 1)} aria-label="Previous page">‹</button>
              {[...Array(pages)].map((_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - pg) <= 1).map((n, i, a) => (
                <span key={n} style={{ display: 'contents' }}>{i > 0 && n - a[i - 1] > 1 && <span className="muted" style={{ padding: '0 4px', alignSelf: 'center' }}>…</span>}
                  <button type="button" aria-current={n === pg ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button></span>))}
              <button type="button" disabled={pg >= pages} onClick={() => setPage(pg + 1)} aria-label="Next page">›</button>
            </div>
          </div>
        )}
      </section>}
      {view === 'board' && data && shown.length > 0 && canManage && <p className="small muted">Drag a card to another column to change its status. On a phone, use the menu on each card.</p>}
      {form && <TaskForm task={form.task} presetAssignee={form.who} staff={people} tasks={tasks} onClose={(changed) => { setForm(null); if (changed) reload(); }} />}
    </>
  );
}
