'use client';
import { useLive, must } from '@/components/useLive';
import { loadMine } from '@/components/myTasks';
import { usePreview } from '@/components/preview';
import { counts, effStatus, fd, fdShort, today, addDays, taskCode, greeting, longDate } from '@/lib/tasks';
import { StatusPill, Priority, DueNote, CountUp, Skeleton, initials } from '@/components/ui';
import { StatusDonut } from '@/components/charts';
import Icon from '@/components/icons';

async function load(sb, asId) {
  const mine = await loadMine(sb, asId);
  const ids = mine.tasks.map((t) => t.id);
  const updates = ids.length ? await must(sb.from('task_updates').select('id,task_id,kind,new_value,body,author_id,created_at').in('task_id', ids).order('created_at', { ascending: false }).limit(8)) : [];
  const authors = [...new Set(updates.map((u) => u.author_id).filter(Boolean))];
  const people = authors.length ? (await sb.rpc('public_names', { ids: authors })).data || [] : [];
  return { ...mine, updates, people };
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fdShort(ts);
}

export default function StaffDashboard({ name: ownName, position: ownPos }) {
  const pv = usePreview();
  const name = pv?.name || ownName, position = pv ? pv.position : ownPos;
  const { data, error } = useLive((sb) => load(sb, pv?.asId), ['tasks', 'task_updates'], pv?.asId || '');
  const tasks = data?.tasks || [];
  const c = counts(tasks);
  const td = today();
  const open = tasks.filter((t) => t.status !== 'Completed');
  const overdue = open.filter((t) => effStatus(t) === 'Overdue');
  const upcoming = open.filter((t) => effStatus(t) !== 'Overdue').slice(0, 6);
  const dueWeek = open.filter((t) => t.due_date >= td && t.due_date <= addDays(td, 7)).length;
  const rate = c.total ? Math.round((c.Completed / c.total) * 100) : 0;
  const onTime = tasks.filter((t) => t.status === 'Completed' && t.completed_at && t.completed_at <= t.due_date).length;
  const tmap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const pname = (id) => (id === data?.me ? 'You' : (data?.people || []).find((p) => p.id === id)?.full_name || 'Your manager');
  const say = (u) => {
    const t = tmap[u.task_id]; const task = t ? <a href={`/staff/tasks/${t.id}`}>{t.title}</a> : <b>a task</b>;
    const who = <b>{pname(u.author_id)}</b>;
    if (u.kind === 'status') return <>{who} moved {task} to {u.new_value}</>;
    if (u.kind === 'comment') return <>{who} added an update on {task}</>;
    if (u.kind === 'created') return <>{who} created {task}</>;
    return <>{who} assigned {task} to you</>;
  };
  const Stat = ({ k, l, cls, i, trend, href }) => (
    <a className={`stat ${cls}`} href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="chip"><Icon name={i} /></span><span className="v"><CountUp v={k ? c[k] : c.total} /></span><span className="label">{l}</span><span className="trend">{trend}</span>
    </a>
  );
  return (
    <>
      <div className="head">
        <div><div className="eyebrow"><Icon name="calendar" size={15} />{longDate()}</div><h1>{greeting()}, {name.split(' ')[0]}</h1>
          <p className="sub">{position || 'Staff'} · {open.length} open task{open.length === 1 ? '' : 's'}{dueWeek ? `, ${dueWeek} due this week` : ''}</p></div>
        <div className="spacer" />
        {open.length > 0 && <a className="btn primary" href="/staff/tasks"><Icon name="check" size={16} />Update My Tasks</a>}
      </div>
      {error && <div className="notice bad">{error}</div>}
      <div className="stats-row">
        <Stat l="Total Assigned" cls="s-all" i="layers" href="/staff/tasks" trend={<>{open.length} still open</>} />
        <Stat k="Completed" l="Completed" cls="s-co" i="done" href="/staff/history" trend={<><span className="up">{rate}%</span> of my tasks</>} />
        <Stat k="In Progress" l="In Progress" cls="s-ip" i="play" href="/staff/tasks" trend={<>{c['Not Started']} not started yet</>} />
        <Stat k="Pending" l="Pending" cls="s-pe" i="pause" href="/staff/tasks" trend={<>Waiting on something</>} />
        <Stat k="Overdue" l="Overdue" cls="s-od" i="alert" href="/staff/tasks" trend={c.Overdue ? <span className="dn">Needs attention</span> : <span className="up">All on track</span>} />
      </div>
      {!data ? <section className="panel"><Skeleton rows={6} /></section> : (
        <div className="dash">
          <div className="colm">
            <section className="panel"><div className="ph"><h2>My Progress</h2><span className="small muted" style={{ marginLeft: 'auto' }}>{c.Completed ? `${Math.round((onTime / c.Completed) * 100)}% finished on time` : 'No completed tasks yet'}</span></div><StatusDonut c={c} center={`${rate}%`} /></section>
            <section className="panel"><div className="ph"><h2>Upcoming Deadlines</h2><a className="more" href="/staff/calendar">Open calendar</a></div>
              {upcoming.length ? <div className="dl">{upcoming.map((t) => { const d = new Date(t.due_date + 'T00:00'); return (
                <div className="d" key={t.id}><div className="date"><b>{d.getDate()}</b><small>{d.toLocaleDateString('en-MY', { month: 'short' })}</small></div>
                  <div className="grow"><div className="t"><a href={`/staff/tasks/${t.id}`}>{t.title}</a></div><div className="m"><span className="tid">{taskCode(t)}</span> · Due {fd(t.due_date)}</div><DueNote t={t} /></div>
                  <Priority p={t.priority} /><StatusPill s={effStatus(t)} /></div>); })}</div>
                : <div className="empty"><b>Nothing coming up</b><span>You have no open tasks due.</span></div>}
            </section>
          </div>
          <div className="colm">
            <section className="panel"><div className="ph"><h2>Recent Updates</h2></div>
              {data.updates.length ? <div className="feed">{data.updates.map((u) => (
                <div className="fi" key={u.id}><span className="avatar sm" aria-hidden="true">{initials(pname(u.author_id))}</span><div className="tx">{say(u)}{u.kind === 'comment' && u.body ? <small style={{ color: 'var(--fg)' }}>“{u.body.length > 90 ? u.body.slice(0, 90) + '…' : u.body}”</small> : null}<small>{ago(u.created_at)}</small></div></div>))}</div>
                : <div className="empty"><b>No updates yet</b><span>Status changes and comments on your tasks appear here.</span></div>}
            </section>
            <section className={`panel${overdue.length ? ' alert-panel' : ''}`}><div className="ph"><h2>Overdue</h2>{overdue.length > 0 && <span className="badge b-over" style={{ marginLeft: 'auto' }}>{overdue.length}</span>}</div>
              {overdue.length ? <div className="dl">{overdue.map((t) => (
                <div className="d" key={t.id}><span className="nt-ico bad"><Icon name="alert" size={16} /></span><div className="grow"><div className="t"><a href={`/staff/tasks/${t.id}`}>{t.title}</a></div><div className="m">Was due {fd(t.due_date)}</div></div></div>))}</div>
                : <div className="empty"><b>Nothing overdue</b><span>Nice work, you're on schedule.</span></div>}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
