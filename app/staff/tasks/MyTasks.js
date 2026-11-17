'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLive } from '@/components/useLive';
import { loadMine } from '@/components/myTasks';
import { usePreview } from '@/components/preview';
import { STATUSES, effStatus, fd, fdShort } from '@/lib/tasks';
import { StatusPill, Priority, DueNote, toast, friendlyError, Skeleton } from '@/components/ui';
import Icon from '@/components/icons';
import Board from '@/components/Board';
import CalendarView from '@/components/CalendarView';

export default function MyTasks() {
  const pv = usePreview();
  const { data, error, reload } = useLive((sb) => loadMine(sb, pv?.asId), ['tasks'], pv?.asId || '');
  const [q, setQ] = useState('');
  useEffect(() => { const x = new URLSearchParams(window.location.search).get('q'); if (x) setQ(x); }, []);
  const [view, setView] = useState('cards');
  const open = (data?.tasks || []).filter((t) => t.status !== 'Completed' && (!q || (t.title + ' ' + (t.description || '')).toLowerCase().includes(q.toLowerCase())));
  const groups = [['Overdue', open.filter((t) => effStatus(t) === 'Overdue')], ['Open', open.filter((t) => effStatus(t) !== 'Overdue')]];

  async function setStatus(t, v) {
    if (pv) return toast('Preview is read-only.');
    const { error } = await createClient().rpc('staff_set_status', { p_task: t.id, p_status: v, p_note: null });
    if (error) return toast(friendlyError(error));
    toast(v === 'Completed' ? 'Marked completed. Completion date recorded.' : `Status: ${v}`); reload();
  }
  return (
    <>
      <div className="head"><div><h1>My Tasks</h1><p className="sub">Update the status as you work. Choosing Completed records today as the completion date. Open a task to add progress updates.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="toolbar"><input type="search" className="search" placeholder="Search my tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search my tasks" />
        <div className="vswitch" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Icon name="tasks" size={15} />List</button>
          <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="board" size={15} />Board</button>
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}><Icon name="calendar" size={15} />Calendar</button>
        </div></div>
      {data && view === 'calendar' && <CalendarView tasks={data.tasks || []} hrefOf={(t) => `/staff/tasks/${t.id}`} />}
      {!data && <section className="panel"><Skeleton rows={4} /></section>}
      {data && view === 'board' && <>
        <Board tasks={(data.tasks || []).filter((t) => !q || (t.title + ' ' + (t.description || '')).toLowerCase().includes(q.toLowerCase()))} nameOf={() => ''} hrefOf={(t) => `/staff/tasks/${t.id}`} onMove={setStatus} showAssignee={false} canMove={!pv} />
        <p className="small muted">Drag a card to another column to update its status. Moving it to Completed records today as the completion date.</p>
      </>}
      {view === 'cards' && data && open.length === 0 && <section className="panel"><div className="empty"><b>No open tasks</b><span>When your manager assigns you a task, it appears here.</span></div></section>}
      {view === 'cards' && groups.filter(([, l]) => l.length).map(([g, list]) => (
        <section key={g} style={{ display: 'grid', gap: 12 }}>
          <h2>{g} <span className="muted num" style={{ fontSize: 14 }}>{list.length}</span></h2>
          <div className="cards">{list.map((t) => {
            const s = effStatus(t);
            return (
              <div key={t.id} className={`card${s === 'Overdue' ? ' bad' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 16 }}><a href={`/staff/tasks/${t.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t.title}</a></div><Priority p={t.priority} /></div>
                  <StatusPill s={s} />
                </div>
                {t.description && <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', maxHeight: 84, overflow: 'hidden' }}>{t.description}</div>}
                <div className="meta"><div><span className="label">Assigned</span><span className="num">{fdShort(t.assigned_at)}</span></div><div><span className="label">Start</span><span className="num">{fdShort(t.start_date)}</span></div>
                  <div><span className="label">Due</span><span className="num">{fd(t.due_date)}</span><DueNote t={t} /></div></div>
                <div className="toolbar">
                  <select value={t.status} disabled={!!pv} onChange={(e) => setStatus(t, e.target.value)} aria-label={`Status of ${t.title}`}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
                  <a className="btn small" href={`/staff/tasks/${t.id}`}>Add update</a>
                </div>
              </div>);
          })}</div>
        </section>
      ))}
    </>
  );
}
