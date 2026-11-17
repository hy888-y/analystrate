import { getSession } from '@/lib/auth';
import TaskDetail from '@/components/TaskDetail';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Task · TaskLedger' };
export default async function Page({ params }) {
  const { user } = await getSession();
  return <TaskDetail id={params.id} mode="staff" meId={user.id} />;
}
