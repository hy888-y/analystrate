import { requirePerm } from '@/lib/auth';
import UsersAdmin from './UsersAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Employee Management · TaskLedger' };
export default async function Page() {
  const { profile } = await requirePerm('users.manage');
  return <UsersAdmin meId={profile.id} isAdmin={profile.role === 'admin'} domain={process.env.COMPANY_EMAIL_DOMAIN || ''} />;
}
