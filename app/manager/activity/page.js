import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Activity from './Activity';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Activity · TaskLedger' };
export default async function Page() {
  const { perms } = await getSession();
  if (!perms['staff.view'] && !perms['tasks.manage']) redirect('/manager?denied=1');
  return <Activity />;
}
