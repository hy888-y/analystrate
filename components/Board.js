'use client';
import { useState } from 'react';
import { STATUSES, effStatus, fdShort, dayDiff, today } from '@/lib/tasks';
import { initials } from '@/components/ui';
import Icon from '@/components/icons';

const COLORS = { 'Not Started': 'var(--muted)', 'In Progress': 'var(--info)', Pending: 'var(--warn)', Completed: 'var(--ok)' };

export function DuePill({ t }) {
  if (!t.due_date) return null;
  const done = t.status === 'Completed';
  const d = dayDiff(today(), t.due_date);
  const cls = done ? '' : d < 0 ? ' late' : d <= 3 ? ' soon' : '';
  const txt = done ? `Done ${fdShort(t.completed_at)}` : d < 0 ? `${-d}d overdue` : d === 0 ? 'Due today' : `Due ${fdShort(t.due_date)}`;
  return <span className={`pill pill-due${cls}`}><Icon name="clock" size={12} />{txt}</span>;
}

// Drag a card to another column to change its status. On touch screens, use the status menu on the card.
export default function Board({ tasks, nameOf, hrefOf, onMove, canMove = true, showAssignee = true }) {
  const [over, setOver] = useState(null);
  const [drag, setDrag] = useState(null);
  return (
    <div className="board">
      {STATUSES.map((s) => {
        const list = tasks.filter((t) => t.status === s);
        return (
          <section key={s} className={`col${over === s ? ' over' : ''}`} aria-label={`${s}: ${list.length} tasks`}
            onDragOver={(e) => { if (!canMove || !drag) return; e.preventDefault(); if (over !== s) setOver(s); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain') || drag; setDrag(null); const t = tasks.find((x) => x.id === id); if (t && t.status !== s) onMove(t, s); }}>
            <div className="col-h"><span className="dot" style={{ background: COLORS[s] }} />{s}<span className="n">{list.length}</span></div>
            {list.length === 0 && <div className="col-empty">{canMove ? 'Drop a task here' : 'No tasks'}</div>}
            {list.map((t) => {
              const late = effStatus(t) === 'Overdue';
              return (
                <article key={t.id} className={`kcard${late ? ' late' : ''}${drag === t.id ? ' dragging' : ''}`} draggable={canMove}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDrag(t.id); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}>
                  <div className="km"><span className={`pill pill-${t.priority || 'Medium'}`}><Icon name="flag" size={12} />{t.priority || 'Medium'}</span><DuePill t={t} /></div>
                  <div className="kt"><a href={hrefOf(t)}>{t.title}</a></div>
                  {t.description && <div className="kd">{t.description}</div>}
                  <div className="kfoot">
                    {showAssignee ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}><span className="avatar sm">{initials(nameOf(t.assignee_id))}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(t.assignee_id)}</span></span>
                      : <span>{t.start_date ? `Started ${fdShort(t.start_date)}` : ''}</span>}
                    {canMove && <select value={t.status} onChange={(e) => onMove(t, e.target.value)} aria-label={`Move ${t.title}`}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select>}
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
