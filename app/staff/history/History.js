'use client';
import { useState } from 'react';
import { useLive } from '@/components/useLive';
import { loadMine } from '@/components/myTasks';
import { usePreview } from '@/components/preview';
import { fd } from '@/lib/tasks';
import { DoneNote, Priority } from '@/components/ui';

export default function History() {
  const pv = usePreview();
  const { data, error } = useLive((sb) => loadMine(sb, pv?.asId), ['tasks'], pv?.asId || '');
  const [q, setQ] = useState('');
  const done = (data?.tasks || []).filter((t) => t.status === 'Completed' && (!q || t.title.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const onTime = done.filter((t) => t.completed_at && t.completed_at <= t.due_date).length;
  return (
    <>
      <div className="head"><div><h1>Task History</h1><p className="sub">Tasks you have completed{done.length ? ` · ${Math.round((onTime / done.length) * 100)}% on time` : ''}.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="toolbar"><input type="search" className="search" placeholder="Search completed tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search completed tasks" /></div>
      <section className="panel">
        {done.length ? <div className="tbl"><table className="rt"><thead><tr><th>Task</th><th>Start date</th><th>Due date</th><th>Completion date</th></tr></thead>
          <tbody>{done.map((t) => (
            <tr key={t.id}><td className="full" data-label="Task"><div className="tname"><a href={`/staff/tasks/${t.id}`}>{t.title}</a> <Priority p={t.priority} /></div></td>
              <td data-label="Start date" className="num">{fd(t.start_date)}</td><td data-label="Due date" className="num">{fd(t.due_date)}</td>
              <td data-label="Completion date" className="num">{fd(t.completed_at)}<DoneNote t={t} /></td></tr>))}</tbody></table></div>
          : <div className="empty"><b>{data ? 'No completed tasks yet' : 'Loading…'}</b></div>}
      </section>
    </>
  );
}
