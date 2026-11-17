'use client';
import { useLive, must } from '@/components/useLive';
import { useDropdown } from '@/components/useDropdown';
import { effStatus, dueInfo, fdShort } from '@/lib/tasks';
import Icon from '@/components/icons';

async function load(sb, asId) {
  let q = sb.from('tasks').select('id,title,due_date,status,assignee_id').neq('status', 'Completed').order('due_date');
  let id = asId;
  if (id === 'me') { const { data: { user } } = await sb.auth.getUser(); id = user?.id; }
  if (id) q = q.eq('assignee_id', id);
  const tasks = await must(q);
  let updates = [];
  if (id) {
    const ids = tasks.map((t) => t.id);
    if (ids.length) updates = await must(sb.from('task_updates').select('id,task_id,kind,new_value,author_id,created_at').in('task_id', ids).neq('author_id', id).order('created_at', { ascending: false }).limit(6));
  }
  return { tasks, updates, me: id };
}

// Bell in the top bar: overdue and soon-due tasks, plus recent changes others made on my tasks.
// mode 'staff' = only my tasks (asId = 'me' or the previewed staff id); 'manager' = all tasks I can see.
export default function NotificationBell({ asId, base }) {
  const { open, setOpen, ref } = useDropdown();
  const { data } = useLive((sb) => load(sb, asId), ['tasks', 'task_updates'], `bell:${asId || ''}`);
  const tasks = data?.tasks || [];
  const overdue = tasks.filter((t) => effStatus(t) === 'Overdue');
  const soon = tasks.filter((t) => effStatus(t) !== 'Overdue' && dueInfo(t));
  const items = [
    ...overdue.slice(0, 5).map((t) => ({ t, kind: 'bad', icon: 'alert', text: `Overdue · was due ${fdShort(t.due_date)}` })),
    ...soon.slice(0, 5).map((t) => ({ t, kind: 'warn', icon: 'clock', text: dueInfo(t).text })),
  ];
  const ups = (data?.updates || []).map((u) => ({ id: u.id, t: tasks.find((x) => x.id === u.task_id), text: u.kind === 'comment' ? 'New comment' : u.kind === 'assignment' ? 'Assigned to you' : u.kind === 'status' ? `Status changed to ${u.new_value}` : 'Task created' }));
  const n = overdue.length + soon.length;
  return (
    <div className="dd" ref={ref}>
      <button type="button" className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notifications${n ? `: ${n}` : ''}`} aria-expanded={open}>
        <Icon name="bell" />{n > 0 && <span className="dot">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <div className="dd-menu" role="dialog" aria-label="Notifications">
          <div className="dd-head"><b>Notifications</b><a href={base} className="small" style={{ color: 'var(--accent-strong)', fontWeight: 600, textDecoration: 'none' }}>View tasks</a></div>
          {!data && <div className="dd-empty">Loading…</div>}
          {data && !items.length && !ups.length && <div className="dd-empty">You're all caught up. Nothing overdue or due soon.</div>}
          {items.map(({ t, kind, icon, text }) => (
            <a key={`${kind}${t.id}`} className="nt" href={`${base}/${t.id}`}><span className={`nt-ico ${kind}`}><Icon name={icon} size={16} /></span><span style={{ minWidth: 0 }}><b>{t.title}</b><small>{text}</small></span></a>
          ))}
          {ups.filter((u) => u.t).map((u) => (
            <a key={u.id} className="nt" href={`${base}/${u.t.id}`}><span className="nt-ico acc"><Icon name="message" size={16} /></span><span style={{ minWidth: 0 }}><b>{u.t.title}</b><small>{u.text}</small></span></a>
          ))}
        </div>
      )}
    </div>
  );
}
