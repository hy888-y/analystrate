import { getSession } from '@/lib/auth';
import StaffDashboard from './StaffDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My dashboard · TaskLedger' };
export default async function Page() {
  const { profile } = await getSession();
  return <StaffDashboard name={profile.full_name} position={profile.position} />;
}
