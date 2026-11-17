import { getSession } from '@/lib/auth';
import Permissions from './Permissions';
import AccountPanel from '@/components/AccountPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · TaskLedger' };
export default async function Page() {
  const { supabase, profile, preview } = await getSession();
  const isAdmin = profile.role === 'admin' && !preview;
  let rows = [], staff = [];
  if (isAdmin) {
    rows = (await supabase.from('role_permissions').select('*')).data || [];
    staff = (await supabase.from('profiles').select('id,full_name,position').eq('role', 'staff').eq('status', 'active').order('full_name')).data || [];
  }
  return (
    <>
      <div className="head"><div><h1>Settings</h1><p className="sub">{isAdmin ? 'Your account, role permissions and portal previews.' : 'Your account details and password.'}</p></div></div>
      <AccountPanel profile={profile} readOnly={!!preview} />
      {isAdmin && <Permissions rows={rows} staff={staff} />}
    </>
  );
}
