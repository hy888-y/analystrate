import { requirePerm } from '@/lib/auth';
import StaffAllocation from './StaffAllocation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff allocation · TaskLedger' };
export default async function Page() {
  const { canEdit } = await requirePerm('staff.view');
  return <StaffAllocation canManage={canEdit('tasks.manage')} />;
}
