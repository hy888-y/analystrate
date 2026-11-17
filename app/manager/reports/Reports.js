'use client';
import { useMemo, useState } from 'react';
import { useLive } from '@/components/useLive';
import { loadBoard } from '../TaskMonitor';
import { counts, dayDiff, localDay, addDays, weekStart, today, fdShort, SHOW_ORDER, SK } from '@/lib/tasks';
import { Progress, CountUp } from '@/components/ui';
import Icon from '@/components/icons';

const PERIODS = [['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months'], ['all', 'All time']];

export default function Reports() {
  const { data, error } = useLive(loadBoard, ['tasks', 'profiles']);
  const [period, setPeriod] = useState('90');
  const people = data?.people || [];
  const tasks = useMemo(() => {
    const all = data?.tasks || [];
    if (period === 'all') return all;
    const from = addDays(today(), -Number(period));
    return all.filter((t) => (t.due_date || '') >= from || (t.completed_at || '') >= from || t.status !== 'Completed');
  }, [data, period]);

  const c = counts(tasks);
  const done = tasks.filter((t) => t.status === 'Completed' && t.completed_at);
  const onTime = done.filter((t) => t.completed_at <= t.due_date).length;
  const durations = done.map((t) => dayDiff(t.start_date || localDay(t.assigned_at || t.created_at), t.completed_at)).filter((d) => d >= 0);
  const avgDays = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const ws = weekStart();
  const weeks = [...Array(8)].map((_, i) => addDays(ws, (i - 7) * 7));
  const perWeek = weeks.map((w) => done.filter((t) => t.completed_at >= w && t.completed_at < addDays(w, 7)).length);
  const maxW = Math.max(1, ...perWeek);
  const staff = people.filter((p) => p.role === 'staff');
  const perf = staff.map((p) => {
    const mine = tasks.filter((t) => t.assignee_id === p.id), cc = counts(mine);
    const md = mine.filter((t) => t.status === 'Completed' && t.completed_at);
    const ot = md.filter((t) => t.completed_at <= t.due_date).length;
    return { p, total: mine.length, cc, onTime: md.length ? Math.round((ot / md.length) * 100) : null, rate: mine.length ? Math.round((cc.Completed / mine.length) * 100) : 0 };
  }).filter((r) => r.total).sort((a, b) => b.total - a.total);

  return (
    <>
      <div className="head"><div><h1>Reports &amp; Analytics</h1><p className="sub">Task performance, completion trends and on-time delivery across the team.</p></div><div className="spacer" />
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="stats-row">
        <div className="stat s-all"><span className="label">Tasks in period</span><span className="v"><CountUp v={c.total} /></span><span className="chip"><Icon name="layers" /></span></div>
        <div className="stat s-co"><span className="label">Completion rate</span><span className="v"><CountUp v={c.total ? Math.round((c.Completed / c.total) * 100) : 0} suffix="%" /></span><span className="chip"><Icon name="done" /></span></div>
        <div className="stat s-ip"><span className="label">Completed on time</span><span className="v">{done.length ? <CountUp v={Math.round((onTime / done.length) * 100)} suffix="%" /> : '—'}</span><span className="chip"><Icon name="clock" /></span></div>
        <div className="stat s-pe"><span className="label">Avg days to complete</span><span className="v">{avgDays == null ? '—' : <CountUp v={avgDays} decimals={1} />}</span><span className="chip"><Icon name="history" /></span></div>
        <div className="stat s-od"><span className="label">Overdue now</span><span className="v"><CountUp v={c.Overdue} /></span><span className="chip"><Icon name="alert" /></span></div>
      </div>
      <div className="grid2">
        <section className="panel"><div className="ph"><h2>Status breakdown</h2></div>
          <div className="pb" style={{ display: 'grid', gap: 12 }}>
            <div className="wl-bar" style={{ height: 26 }}>{SHOW_ORDER.map((s) => <span key={s} className={`seg-${SK[s]}`} style={{ width: `${c.total ? (c[s] / c.total) * 100 : 0}%` }} title={`${s}: ${c[s]}`} />)}</div>
            <div className="toolbar">{SHOW_ORDER.map((s) => <span key={s} className="key"><i className={`seg-${SK[s]}`} />{s} <b className="num" style={{ color: 'var(--fg)' }}>{c[s]}</b></span>)}</div>
          </div></section>
        <section className="panel"><div className="ph"><h2>Tasks completed per week</h2><span className="muted small">Last 8 weeks</span></div>
          <div className="bars" role="img" aria-label={`Completed per week: ${perWeek.join(', ')}`}>
            {perWeek.map((n, i) => <div className="b" key={i}><span>{n}</span><i style={{ height: `${(n / maxW) * 110}px`, minHeight: n ? 4 : 0 }} /><span>{fdShort(weeks[i])}</span></div>)}
          </div></section>
      </div>
      <section className="panel"><div className="ph"><h2>Staff performance</h2></div>
        {perf.length ? <div className="tbl"><table className="rt"><thead><tr><th>Staff</th><th>Position</th><th className="r">Tasks</th><th className="r">Completed</th><th className="r">Overdue</th><th>Completion rate</th><th className="r">On time</th></tr></thead>
          <tbody>{perf.map((r) => (
            <tr key={r.p.id} className={r.cc.Overdue ? 'hot' : ''}><td className="full" data-label="Staff"><b>{r.p.full_name}</b></td><td data-label="Position">{r.p.position || '—'}</td>
              <td data-label="Tasks" className="r num">{r.total}</td><td data-label="Completed" className="r num">{r.cc.Completed}</td>
              <td data-label="Overdue" className="r num" style={r.cc.Overdue ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{r.cc.Overdue}</td>
              <td data-label="Completion rate"><Progress value={r.rate} /></td><td data-label="On time" className="r num">{r.onTime == null ? '—' : r.onTime + '%'}</td></tr>))}</tbody></table></div>
          : <div className="empty"><b>No assigned tasks in this period</b></div>}
      </section>
    </>
  );
}
