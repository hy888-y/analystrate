'use client';
import { useEffect, useMemo, useState } from 'react';
import { isoDate, today, fd, effStatus } from '@/lib/tasks';
import { StatusPill } from '@/components/ui';
import Icon from '@/components/icons';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PCOL = { Urgent: '#E05252', High: '#E5A32B', Medium: '#4285E8', Low: '#22A06B' };

// Month calendar of tasks placed on their due date, coloured by priority
export default function CalendarView({ tasks, hrefOf, nameOf }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState(null);
  useEffect(() => { const k = (e) => e.key === 'Escape' && setSel(null); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, []);
  const byDay = useMemo(() => { const m = {}; tasks.forEach((t) => { if (t.due_date) (m[t.due_date] ||= []).push(t); }); return m; }, [tasks]);
  const start = new Date(month); start.setDate(1 - start.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const td = today();
  const go = (n) => { setSel(null); setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1)); };
  const label = month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  return (
    <div className="cal">
      <div className="cal-head">
        <h2>{label}</h2>
        <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous month"><Icon name="chevl" /></button>
        <button className="icon-btn" onClick={() => go(1)} aria-label="Next month"><Icon name="chevr" /></button>
        <button className="btn small" onClick={() => { setSel(null); const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</button>
        <div className="cal-legend">{Object.entries(PCOL).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}</div>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d.slice(0, 3)}<span className="hide-sm">{d.slice(3)}</span></div>)}
        {days.map((d) => {
          const k = isoDate(d), list = byDay[k] || [], out = d.getMonth() !== month.getMonth();
          return (
            <div key={k} className={`cal-day${out ? ' out' : ''}${k === td ? ' today' : ''}${sel === k ? ' sel' : ''}`} role="button" tabIndex={0}
              aria-label={`${fd(k)}: ${list.length} task${list.length === 1 ? '' : 's'} due`}
              onClick={() => setSel(sel === k ? null : k)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel(sel === k ? null : k))}>
              {list.slice(0, 3).map((t) => (
                <a key={t.id} href={hrefOf(t)} onClick={(e) => e.stopPropagation()} className={`cal-chip ${t.priority || 'Medium'}${t.status === 'Completed' ? ' done' : ''}`} title={`${t.title} · ${effStatus(t)}`}>{t.title}</a>
              ))}
              {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              <span className="cal-n">{d.getDate()}</span>
              {sel === k && (
                <div className="cal-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Tasks due ${fd(k)}`}>
                  <div><h3>Due this day</h3><div className="small muted">{d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
                  {list.length ? list.map((t) => (
                    <div key={t.id} className="row"><i style={{ width: 8, height: 8, borderRadius: '50%', background: PCOL[t.priority] || PCOL.Medium, flex: 'none' }} />
                      <div className="grow" style={{ minWidth: 0 }}><div className="t" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{t.title}</div>{nameOf && <div className="m">{nameOf(t.assignee_id)}</div>}</div>
                      <StatusPill s={effStatus(t)} /></div>
                  )) : <span className="muted small">No tasks due.</span>}
                  {list.length > 0 && <a className="btn primary" href={hrefOf(list[0])} style={{ justifyContent: 'center' }}>View task<Icon name="chevr" size={16} /></a>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
