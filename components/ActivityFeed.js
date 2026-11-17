'use client';
import { useState } from 'react';
import { isoDate, today, addDays, fd } from '@/lib/tasks';
import { initials } from '@/components/ui';
import Icon from '@/components/icons';

const FILTERS = [['', 'All', 'layers'], ['status', 'Status', 'swap'], ['comment', 'Comments', 'message'], ['assignment', 'Assignments', 'users'], ['created', 'New tasks', 'plus']];
const ICON = { status: ['swap', 'var(--accent)'], comment: ['message', 'var(--warn)'], assignment: ['users', '#DB2777'], created: ['plus', 'var(--ok)'] };
const TAG = { status: ['Status', 'var(--accent)'], comment: ['Comment', 'var(--warn)'], assignment: ['Assignment', '#DB2777'], created: ['New task', 'var(--ok)'] };

function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hour${Math.floor(s / 3600) === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
}

// items: task_updates rows; taskOf(id) -> task; nameOf(id) -> person name; hrefOf(task)
export default function ActivityFeed({ items, taskOf, nameOf, hrefOf }) {
  const [f, setF] = useState('');
  const shown = items.filter((u) => !f || u.kind === f);
  const td = today(), yd = addDays(td, -1);
  const groups = [];
  shown.forEach((u) => {
    const d = isoDate(new Date(u.created_at));
    const label = d === td ? 'Today' : d === yd ? 'Yesterday' : fd(d);
    if (!groups.length || groups[groups.length - 1][0] !== label) groups.push([label, []]);
    groups[groups.length - 1][1].push(u);
  });
  const sentence = (u, t) => {
    const who = <b>{nameOf(u.author_id) || 'Someone'}</b>;
    const task = t ? <a href={hrefOf(t)} style={{ color: 'var(--fg)', fontWeight: 700 }}>{t.title}</a> : <b>a deleted task</b>;
    if (u.kind === 'status') return <>{who} moved {task} to <b>{u.new_value}</b></>;
    if (u.kind === 'comment') return <>{who} added an update on {task}</>;
    if (u.kind === 'created') return <>{who} created {task}</>;
    return u.old_value ? <>{who} reassigned {task} from <b>{nameOf(u.old_value)}</b> to <b>{nameOf(u.new_value)}</b></> : <>{who} assigned {task} to <b>{nameOf(u.new_value)}</b></>;
  };
  return (
    <>
      <div className="chips" role="group" aria-label="Filter activity">
        {FILTERS.map(([k, l, i]) => <button key={k} type="button" className="chipbtn" aria-pressed={f === k} onClick={() => setF(k)}><Icon name={i} size={15} />{l}</button>)}
      </div>
      {groups.length === 0 ? <section className="panel"><div className="empty"><b>No activity yet</b><span>Status changes, progress updates and assignments appear here as they happen.</span></div></section> : (
        <div className="tl">
          {groups.map(([label, list]) => (
            <div key={label} style={{ display: 'grid', gap: 14 }}>
              <div className="tl-day"><span>{label}</span></div>
              {list.map((u) => {
                const t = taskOf(u.task_id); const [ic, col] = ICON[u.kind] || ICON.status; const [tag, tcol] = TAG[u.kind] || TAG.status;
                return (
                  <div key={u.id} className="tl-item">
                    <span className="tl-ico" style={{ color: col }}><Icon name={ic} /></span>
                    <article className={`tl-card k-${u.kind}`}>
                      <div className="tl-top"><span className="avatar sm" aria-hidden="true">{initials(nameOf(u.author_id))}</span><span style={{ minWidth: 0 }}>{sentence(u, t)}</span><span className="muted">· {ago(u.created_at)}</span></div>
                      {u.kind === 'comment' && u.body && <div className="tl-quote">“{u.body}”</div>}
                      <div className="tl-meta"><span className="tag" style={{ color: tcol }}>{tag}</span>{t && <><span>•</span><Icon name="tasks" size={14} /><span>Due {fd(t.due_date)}</span><span>•</span><span>{nameOf(t.assignee_id)}</span></>}</div>
                    </article>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
