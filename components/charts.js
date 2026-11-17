'use client';
import { addDays, today, localDay } from '@/lib/tasks';

export const STATUS_COLOR = { Completed: 'var(--ok)', 'In Progress': 'var(--info)', Pending: 'var(--warn)', 'Not Started': '#B8B8C7', Overdue: 'var(--bad)' };

// Donut of task counts by status, with a legend
export function StatusDonut({ c, center, sub = 'completed' }) {
  const order = ['Completed', 'In Progress', 'Pending', 'Not Started', 'Overdue'];
  const total = order.reduce((a, k) => a + c[k], 0);
  const r = 60, len = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${center} ${sub}`}>
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r={r} fill="none" stroke="var(--sunk)" strokeWidth="16" />
          {total > 0 && order.map((k) => {
            if (!c[k]) return null;
            const part = (c[k] / total) * len, gap = order.filter((x) => c[x]).length > 1 ? 3 : 0;
            const el = <circle key={k} cx="75" cy="75" r={r} fill="none" stroke={STATUS_COLOR[k]} strokeWidth="16" strokeDasharray={`${Math.max(0, part - gap)} ${len}`} strokeDashoffset={-off} strokeLinecap="butt" />;
            off += part; return el;
          })}
        </svg>
        <div className="dv"><div><b>{center}</b><small>{sub}</small></div></div>
      </div>
      <div className="legend">
        {order.map((k) => <div className="li" key={k}><i style={{ background: STATUS_COLOR[k] }} />{k}<b>{c[k]}</b></div>)}
      </div>
    </div>
  );
}

// Tasks created vs completed for each of the last 7 days
export function WeekActivity({ tasks }) {
  const td = today();
  const days = [...Array(7)].map((_, i) => addDays(td, i - 6));
  const created = days.map((d) => tasks.filter((t) => localDay(t.created_at) === d).length);
  const done = days.map((d) => tasks.filter((t) => t.completed_at && localDay(t.completed_at) === d).length);
  const max = Math.max(1, ...created, ...done);
  const h = (n) => `${Math.max(2, (n / max) * 100)}%`;
  return (
    <>
      <div className="vchart" role="img" aria-label={`Last 7 days: ${created.reduce((a, b) => a + b, 0)} tasks created, ${done.reduce((a, b) => a + b, 0)} completed`}>
        {days.map((d, i) => (
          <div key={d} className={`g${d === td ? ' today' : ''}`}>
            <div className="bars2"><i className="a" style={{ height: h(done[i]) }} title={`${done[i]} completed`} /><i className="b" style={{ height: h(created[i]) }} title={`${created[i]} created`} /></div>
            <span>{new Date(d + 'T00:00').toLocaleDateString('en-MY', { weekday: 'short' })}</span>
          </div>
        ))}
      </div>
      <div className="chart-key"><span><i style={{ background: 'var(--accent)' }} />Completed</span><span><i style={{ background: 'var(--lav)' }} />Created</span></div>
    </>
  );
}
