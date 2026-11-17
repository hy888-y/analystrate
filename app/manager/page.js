import { getSession } from '@/lib/auth';
import Overview from './Overview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview · TaskLedger' };
export default async function Page() {
  const { profile, perms, canEdit, preview } = await getSession();
  const name = preview ? 'Manager' : profile.full_name;
  return <Overview name={name} canManage={canEdit('tasks.manage')} showStaff={!!perms['staff.view']} />;
}
