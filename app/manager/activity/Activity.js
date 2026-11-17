'use client';
import { useLive, must } from '@/components/useLive';
import ActivityFeed from '@/components/ActivityFeed';
import { Skeleton } from '@/components/ui';

async function load(sb) {
  const [items, tasks, people] = await Promise.all([
    must(sb.from('task_updates').select('*').order('created_at', { ascending: false }).limit(200)),
    must(sb.from('tasks').select('id,title,due_date,assignee_id')),
    must(sb.from('profiles').select('id,full_name')),
  ]);
  return { items, tasks, people };
}

export default function Activity() {
  const { data, error } = useLive(load, ['task_updates', 'tasks']);
  const tmap = Object.fromEntries((data?.tasks || []).map((t) => [t.id, t]));
  const pmap = Object.fromEntries((data?.people || []).map((p) => [p.id, p.full_name]));
  return (
    <>
      <div className="head"><div><h1>Activity</h1><p className="sub">Everything your team did on tasks, live: status changes, progress updates and assignments.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      {!data ? <section className="panel"><Skeleton rows={5} /></section> : (
        <ActivityFeed items={data.items} taskOf={(id) => tmap[id]} nameOf={(id) => (id ? pmap[id] || 'Former staff' : 'Unassigned')} hrefOf={(t) => `/manager/tasks/${t.id}`} />
      )}
    </>
  );
}
