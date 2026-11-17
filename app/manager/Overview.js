'use client';
import { useState } from 'react';
import { useLive, must } from '@/components/useLive';
import { counts, effStatus, workload, fd, fdShort, taskCode, today, addDays, localDay, greeting, longDate } from '@/lib/tasks';
import { StatusPill, Priority, CountUp, Skeleton, initials } from '@/components/ui';
import { StatusDonut, WeekActivity } from '@/components/charts';
import Icon from '@/components/icons';
import TaskForm from '@/components/TaskForm';

async function load(sb) {
  const [tasks, people, updates] = await Promise.all([
    must(sb.from('tasks').select('*').order('due_date')),
    must(sb.from('profiles').select('id,full_name,role,status,max_tasks,position,staff_code').order('full_name')),
    must(sb.from('task_updates').select('id,task_id,kind,new_value,old_value,author_id,created_at').order('created_at', { ascending: false }).limit(8)),
  ]);
  return { tasks, people, updates };
}

function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fdShort(ts);
}

export default function Overview({ name, canManage, showStaff }) {
  const { data, error, reload } = useLive(load, ['tasks', 'profiles', 'task_updates']);
  const [form, setForm] = useState(false);
  const tasks = data?.tasks || [], people = data?.people || [];
  const nameOf = (id) => (id ? people.find((p) => p.id === id)?.full_name || 'Former staff' : 'Unassigned');
  const c = counts(tasks);
  const td = today(), wk = addDays(td, -6);
  const createdWeek = tasks.filter((t) => localDay(t.created_at) >= wk).length;
  const doneWeek = tasks.filter((t) => t.completed_at && localDay(t.completed_at) >= wk).length;
  const dueWeek = tasks.filter((t) => t.status !== 'Completed' && t.due_date >= td && t.due_date <= addDays(td, 7)).length;
  const rate = c.total ? Math.round((c.Completed / c.total) * 100) : 0;
  const recent = [...tasks].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 6);
  const upcoming = tasks.filter((t) => t.status !== 'Completed' && t.due_date >= td).slice(0, 6);
  const overdue = tasks.filter((t) => effStatus(t) === 'Overdue');
  const staff = people.filter((p) => p.role === 'staff' && p.status === 'active').map((p) => ({ p, w: workload(p, tasks) }));
  const byLoad = [...staff].sort((a, b) => b.w.ratio - a.w.ratio).slice(0, 6);
  const free = staff.filter((r) => r.w.lv === 'avail' || r.w.lv === 'none'), full = staff.filter((r) => r.w.lv === 'full'), over = staff.filter((r) => r.w.lv === 'over');
  const tmap = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const say = (u) => {
    const t = tmap[u.task_id]; const who = <b>{nameOf(u.author_id)}</b>;
    const task = t ? <a href={`/manager/tasks/${t.id}`}>{t.title}</a> : <b>a deleted task</b>;
    if (u.kind === 'status') return <>{who} moved {task} to {u.new_value}</>;
    if (u.kind === 'comment') return <>{who} commented on {task}</>;
    if (u.kind === 'created') return <>{who} created {task}</>;
    return <>{who} assigned {task} to {nameOf(u.new_value)}</>;
  };
  const Stat = ({ k, label, cls, icon, trend, href }) => (
    <a className={`stat ${cls}`} href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <span className="chip"><Icon name={icon} /></span><span className="v"><CountUp v={k ? c[k] : c.total} /></span><span className="label">{label}</span>
      <span className="trend">{trend}</span>
    </a>
  );

  return (
    <>
      <div className="head">
        <div><div className="eyebrow"><Icon name="calendar" size={15} />{longDate()}</div><h1>{greeting()}, {name.split(' ')[0]}</h1>
          <p className="sub">Here's how your team's tasks are tracking today.</p></div>
        <div className="spacer" />
        {canManage && <button className="btn primary" onClick={() => setForm(true)}><Icon name="plus" size={16} />Create New Task</button>}
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <div className="stats-row">
        <Stat k="" label="Total Tasks" cls="s-all" icon="layers" href="/manager/tasks" trend={<><span className="up">+{createdWeek}</span> created in the last 7 days</>} />
        <Stat k="Completed" label="Completed Tasks" cls="s-co" icon="done" href="/manager/tasks?status=Completed" trend={<><span className="up">{rate}%</span> completion rate</>} />
        <Stat k="In Progress" label="In Progress" cls="s-ip" icon="play" href="/manager/tasks?status=In+Progress" trend={<>{dueWeek} open task{dueWeek === 1 ? '' : 's'} due this week</>} />
        <Stat k="Pending" label="Pending Tasks" cls="s-pe" icon="pause" href="/manager/tasks?status=Pending" trend={<>{c['Not Started']} not started yet</>} />
        <Stat k="Overdue" label="Overdue Tasks" cls="s-od" icon="alert" href="/manager/tasks?status=Overdue" trend={c.Overdue ? <><span className="dn">Needs attention</span></> : <><span className="up">All on track</span></>} />
      </div>

      {!data ? <section className="panel"><Skeleton rows={8} /></section> : (
        <div className="dash">
          <div className="colm">
            <div className="split2">
              <section className="panel"><div className="ph"><h2>Task Completion Overview</h2></div><StatusDonut c={c} center={`${rate}%`} /></section>
              <section className="panel"><div className="ph"><h2>Weekly Task Activity</h2><span className="small muted" style={{ marginLeft: 'auto' }}>{doneWeek} completed · {createdWeek} created</span></div><WeekActivity tasks={tasks} /></section>
            </div>
            <section className="panel"><div className="ph"><h2>Recent Tasks</h2><a className="more" href="/manager/tasks">View all</a></div>
              {recent.length ? <div className="tbl"><table className="rt"><thead><tr><th>Task ID</th><th>Task name</th><th>Assigned staff</th><th>Priority</th><th>Due date</th><th>Status</th></tr></thead><tbody>
                {recent.map((t) => (
                  <tr key={t.id}><td data-label="Task ID"><span className="tid">{taskCode(t)}</span></td>
                    <td className="full" data-label="Task name"><div className="tname"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div></td>
                    <td data-label="Assigned staff">{nameOf(t.assignee_id)}</td><td data-label="Priority"><Priority p={t.priority} /></td>
                    <td data-label="Due date" className="num">{fd(t.due_date)}</td><td data-label="Status"><StatusPill s={effStatus(t)} /></td></tr>))}
              </tbody></table></div> : <div className="empty"><b>No tasks yet</b><span>Create your first task to get started.</span></div>}
            </section>
            <section className="panel"><div className="ph"><h2>Upcoming Deadlines</h2><a className="more" href="/manager/calendar">Open calendar</a></div>
              {upcoming.length ? <div className="dl">{upcoming.map((t) => { const d = new Date(t.due_date + 'T00:00'); return (
                <div className="d" key={t.id}><div className="date"><b>{d.getDate()}</b><small>{d.toLocaleDateString('en-MY', { month: 'short' })}</small></div>
                  <div className="grow"><div className="t"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div><div className="m">{nameOf(t.assignee_id)} · <span className="tid">{taskCode(t)}</span></div></div>
                  <Priority p={t.priority} /><StatusPill s={effStatus(t)} /></div>); })}</div>
                : <div className="empty"><b>No upcoming deadlines</b><span>Open tasks due today or later appear here.</span></div>}
            </section>
          </div>

          <div className="colm">
            {showStaff && <section className="panel"><div className="ph"><h2>Staff Workload Overview</h2><a className="more" href="/manager/staff">Manage</a></div>
              {byLoad.length ? <div className="mini-wl">{byLoad.map(({ p, w }) => (
                <div className="r" key={p.id}><span className="avatar sm" aria-hidden="true">{initials(p.full_name)}</span>
                  <div style={{ minWidth: 0 }}><div className="nm">{p.full_name}</div><div className={`cap ${w.lv}`}><i style={{ width: `${Math.min(100, w.ratio * 100)}%` }} /></div></div>
                  <span className="sm num" style={w.lv === 'over' ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{w.open}/{w.max}</span></div>))}</div>
                : <div className="empty"><b>No active staff</b><span>Register employees to see workloads.</span></div>}
            </section>}
            {showStaff && <section className="panel"><div className="ph"><h2>Employee Availability</h2></div>
              <div className="avail-grid"><div className="a g"><b>{free.length}</b><span>Available</span></div><div className="a y"><b>{full.length}</b><span>At capacity</span></div><div className="a r"><b>{over.length}</b><span>Overloaded</span></div></div>
              {free.length > 0 ? <div className="people">{free.slice(0, 8).map(({ p, w }) => <span className="person" key={p.id}><span className="avatar sm" aria-hidden="true">{initials(p.full_name)}</span>{p.full_name.split(' ')[0]} · {w.max - w.open} free</span>)}</div>
                : <p className="small muted" style={{ padding: '6px 20px 18px', margin: 0 }}>Nobody has spare capacity right now.</p>}
            </section>}
            <section className="panel"><div className="ph"><h2>Recent System Activity</h2><a className="more" href="/manager/activity">View all</a></div>
              {data.updates.length ? <div className="feed">{data.updates.map((u) => (
                <div className="fi" key={u.id}><span className="avatar sm" aria-hidden="true">{initials(nameOf(u.author_id))}</span><div className="tx">{say(u)}<small>{ago(u.created_at)}</small></div></div>))}</div>
                : <div className="empty"><b>No activity yet</b></div>}
            </section>
            <section className={`panel${overdue.length ? ' alert-panel' : ''}`}><div className="ph"><h2>Overdue Task Alerts</h2>{overdue.length > 0 && <span className="badge b-over" style={{ marginLeft: 'auto' }}>{overdue.length}</span>}</div>
              {overdue.length ? <div className="dl">{overdue.slice(0, 6).map((t) => (
                <div className="d" key={t.id}><span className="nt-ico bad"><Icon name="alert" size={16} /></span>
                  <div className="grow"><div className="t"><a href={`/manager/tasks/${t.id}`}>{t.title}</a></div><div className="m">{nameOf(t.assignee_id)} · was due {fd(t.due_date)}</div></div></div>))}
                {overdue.length > 6 && <a className="more" style={{ padding: '10px 20px', display: 'block' }} href="/manager/tasks?status=Overdue">See all {overdue.length} overdue tasks</a>}</div>
                : <div className="empty"><b>No overdue tasks</b><span>Everything is on schedule.</span></div>}
            </section>
          </div>
        </div>
      )}
      {form && <TaskForm staff={people} tasks={tasks} onClose={(changed) => { setForm(false); if (changed) reload(); }} />}
    </>
  );
}
