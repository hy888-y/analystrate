import { getSession } from '@/lib/auth';
import TaskMonitor from '../TaskMonitor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Task Monitoring · TaskLedger' };
export default async function Page() {
  const { canEdit } = await getSession();
  return <TaskMonitor canManage={canEdit('tasks.manage')} />;
}
