'use client';
import { must } from '@/components/useLive';

// Row-level security already limits staff to their own tasks; the filter keeps the query explicit.
// asId is only used when an Admin previews the Staff portal.
export async function loadMine(sb, asId) {
  let id = asId;
  if (!id) { const { data: { user } } = await sb.auth.getUser(); id = user.id; }
  const tasks = await must(sb.from('tasks').select('*').eq('assignee_id', id).order('due_date'));
  return { me: id, tasks };
}
