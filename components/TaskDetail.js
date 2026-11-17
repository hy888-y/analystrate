'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLive, must } from '@/components/useLive';
import { STATUSES, effStatus, fd, fdt } from '@/lib/tasks';
import { StatusPill, Priority, DueNote, DoneNote, toast, friendlyError } from '@/components/ui';
import TaskForm from '@/components/TaskForm';

async function loadTask(sb, id, isManager) {
  const task = await must(sb.from('tasks').select('*').eq('id', id).maybeSingle());
  if (!task) return { task: null };
  const updates = await must(sb.from('task_updates').select('*').eq('task_id', id).order('created_at', { ascending: true }));
  const ids = [...new Set([task.assignee_id, task.created_by, ...updates.flatMap((u) => [u.author_id, u.kind === 'assignment' ? u.old_value : null, u.kind === 'assignment' ? u.new_value : null])].filter(Boolean))];
  const names = {};
  if (ids.length) (await must(sb.rpc('public_names', { ids }))).forEach((r) => (names[r.id] = r.full_name));
  let people = [], tasks = [];
  if (isManager) {
    [people, tasks] = await Promise.all([
      must(sb.from('profiles').select('id,full_name,role,status,max_tasks').order('full_name')),
      must(sb.from('tasks').select('id,assignee_id,status,due_date')),
    ]);
  }
  return { task, updates, names, people, tasks };
}

export default function TaskDetail({ id, mode, meId, canManage }) {
  const isManager = mode === 'manager';
  const { data, error, reload } = useLive((sb) => loadTask(sb, id, isManager), ['tasks', 'task_updates'], id);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [edit, setEdit] = useState(false);
  const back = isManager ? '/manager/tasks' : '/staff/tasks';

  if (error) return <div className="notice bad" role="alert">{error}</div>;
  if (!data) return <p className="muted">Loading task…</p>;
  if (!data.task) return <section className="panel"><div className="empty"><b>Task not found</b><span>It may have been deleted, or it is not assigned to you.</span><a className="btn" href={back}>Back</a></div></section>;

  const { task: t, updates, names } = data;
  const nm = (x) => (x ? names[x] || 'Former staff' : 'Unassigned');
  const s = effStatus(t);
  const sb = createClient();

  async function setStatus(v) {
    const { error } = isManager && canManage
      ? await sb.from('tasks').update({ status: v }).eq('id', t.id)
      : await sb.rpc('staff_set_status', { p_task: t.id, p_status: v, p_note: null });
    if (error) return toast(friendlyError(error));
    toast(v === 'Completed' ? 'Marked completed. Completion date recorded.' : `Status: ${v}`); reload();
  }
  async function addNote(e) {
    e.preventDefault();
    const body = note.trim(); if (!body) return;
    setBusy(true);
    const { error } = await sb.from('task_updates').insert({ task_id: t.id, author_id: meId, kind: 'comment', body });
    setBusy(false);
    if (error) return toast(friendlyError(error));
    setNote(''); toast('Update added'); reload();
  }
  const canUpdate = isManager ? canManage : t.assignee_id === meId;

  return (
    <>
      <div><a className="btn link" href={back}>← Back</a></div>
      <div className="head">
        <div><h1>{t.title}</h1><p className="sub">Assigned to {nm(t.assignee_id)}{t.assigned_at ? ` on ${fd(t.assigned_at)}` : ''}</p></div>
        <div className="spacer" />
        <StatusPill s={s} />
        {isManager && canManage && <button className="btn" onClick={() => setEdit(true)}>Edit task</button>}
      </div>
      <section className="panel"><div className="pb" style={{ display: 'grid', gap: 16 }}>
        <div className="meta">
          <div><span className="label">Priority</span><span>{t.priority} <Priority p={t.priority} /></span></div>
          <div><span className="label">Start date</span><span className="num">{fd(t.start_date)}</span></div>
          <div><span className="label">Due date</span><span className="num">{fd(t.due_date)}</span><DueNote t={t} /></div>
          <div><span className="label">Completion date</span><span className="num">{fd(t.completed_at)}</span><DoneNote t={t} /></div>
          {canUpdate && <div><label className="label" htmlFor="st">Update status</label>
            <select id="st" value={t.status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((x) => <option key={x}>{x}</option>)}</select></div>}
        </div>
        <div><span className="label">Description</span><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{t.description || <span className="muted">No description.</span>}</div></div>
      </div></section>
      <section className="panel">
        <div className="ph"><h2>Progress updates and history</h2></div>
        <div className="pb thread">
          {updates.length === 0 && <span className="muted">No updates yet.</span>}
          {updates.map((u) => u.kind === 'comment' ? (
            <div key={u.id} className="msg"><div className="who">{nm(u.author_id)} · {fdt(u.created_at)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{u.body}</div></div>
          ) : (
            <div key={u.id} className="event">{fdt(u.created_at)} · {nm(u.author_id)} {
              u.kind === 'created' ? 'created the task' :
              u.kind === 'status' ? <>changed status from <b>{u.old_value}</b> to <b>{u.new_value}</b></> :
              u.old_value ? <>reassigned it from <b>{nm(u.old_value)}</b> to <b>{nm(u.new_value)}</b></> : <>assigned it to <b>{nm(u.new_value)}</b></>
            }</div>
          ))}
          {canUpdate && (
            <form onSubmit={addNote} style={{ display: 'grid', gap: 8 }}>
              <label className="label" htmlFor="note">Add a progress update or comment</label>
              <textarea id="note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Waiting for bank statements from client" />
              <div className="factions"><button className="btn primary" type="submit" disabled={busy || !note.trim()}>{busy ? 'Posting…' : 'Post update'}</button></div>
            </form>
          )}
        </div>
      </section>
      {edit && <TaskForm task={t} staff={data.people} tasks={data.tasks} onClose={(c) => { setEdit(false); if (c) reload(); }} />}
    </>
  );
}
