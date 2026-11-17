'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { STATUSES, PRIORITIES, today, fd, workload } from '@/lib/tasks';
import { Modal, toast, friendlyError, ConfirmButton } from '@/components/ui';

// Create / edit a task (managers). Completion date, assignment date and history are set by the database.
export default function TaskForm({ task, staff, tasks, presetAssignee, onClose }) {
  const t = task || { status: 'Not Started', priority: 'Medium', start_date: today(), assignee_id: presetAssignee || '' };
  const [f, setF] = useState({
    title: t.title || '', description: t.description || '', assignee_id: t.assignee_id || '', priority: t.priority,
    start_date: t.start_date || '', due_date: t.due_date || '', status: t.status,
  });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const active = staff.filter((p) => p.status === 'active' && p.role === 'staff');

  async function save(e) {
    e.preventDefault(); setErr('');
    if (!f.title.trim()) return setErr('Enter a task name.');
    if (!f.due_date) return setErr('Choose a due date.');
    if (f.start_date && f.due_date < f.start_date) return setErr('The due date is before the start date.');
    setBusy(true);
    const body = { title: f.title.trim(), description: f.description.trim() || null, assignee_id: f.assignee_id || null, priority: f.priority,
      start_date: f.start_date || null, due_date: f.due_date, status: f.status };
    const sb = createClient();
    const { error } = task ? await sb.from('tasks').update(body).eq('id', task.id) : await sb.from('tasks').insert(body);
    setBusy(false);
    if (error) return setErr(friendlyError(error));
    toast(task ? 'Task updated' : body.assignee_id ? `Task assigned to ${staff.find((s) => s.id === body.assignee_id)?.full_name}` : 'Task created');
    onClose(true);
  }
  async function remove() {
    const { error } = await createClient().from('tasks').delete().eq('id', task.id);
    if (error) return setErr(friendlyError(error));
    toast('Task deleted'); onClose(true);
  }

  const completedText = f.status === 'Completed' ? (task?.status === 'Completed' && task.completed_at ? fd(task.completed_at) : `${fd(today())} (set automatically)`) : 'Recorded when marked Completed';
  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={() => onClose(false)}>
      <form onSubmit={save} noValidate>
        <div className="fh"><h2>{task ? 'Edit task' : 'New task'}</h2><button type="button" className="btn small" onClick={() => onClose(false)}>Close</button></div>
        <div className="field"><label className="label" htmlFor="t-title">Task name</label><input id="t-title" type="text" maxLength={200} value={f.title} onChange={set('title')} placeholder="e.g. Prepare bank reconciliation" autoFocus /></div>
        <div className="field"><label className="label" htmlFor="t-desc">Task description</label><textarea id="t-desc" maxLength={4000} value={f.description} onChange={set('description')} placeholder="Details and instructions" /></div>
        <div className="fgrid">
          <div className="field"><label className="label" htmlFor="t-who">Assigned staff</label>
            <select id="t-who" value={f.assignee_id} onChange={set('assignee_id')}>
              <option value="">Unassigned</option>
              {active.map((p) => { const w = workload(p, tasks); return <option key={p.id} value={p.id}>{p.full_name} · {w.open}/{w.max} open{w.lv === 'over' ? ' (overloaded)' : ''}</option>; })}
              {f.assignee_id && !active.some((p) => p.id === f.assignee_id) && <option value={f.assignee_id}>{staff.find((s) => s.id === f.assignee_id)?.full_name || 'Former staff'}</option>}
            </select>
            <span className="hint">{active.length ? 'Each name shows open tasks / limit.' : 'No active staff accounts yet.'}</span></div>
          <div className="field"><label className="label" htmlFor="t-pri">Priority</label><select id="t-pri" value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="t-start">Start date</label><input id="t-start" type="date" value={f.start_date} onChange={set('start_date')} /></div>
          <div className="field"><label className="label" htmlFor="t-due">Due date</label><input id="t-due" type="date" value={f.due_date} onChange={set('due_date')} /></div>
          <div className="field"><label className="label" htmlFor="t-status">Status</label><select id="t-status" value={f.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select><span className="hint">Overdue shows automatically after the due date.</span></div>
          <div className="field"><span className="label">Completion date</span><div className="readout num">{completedText}</div></div>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="factions">
          {task && <span className="left"><ConfirmButton className="btn danger" onConfirm={remove}>Delete task</ConfirmButton></span>}
          <button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  );
}
