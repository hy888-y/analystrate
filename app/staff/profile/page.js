import { getSession } from '@/lib/auth';
import AccountPanel from '@/components/AccountPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Profile · TaskLedger' };
export default async function Page() {
  const { supabase, profile, preview } = await getSession();
  let who = profile;
  if (preview?.role === 'staff') who = (await supabase.from('profiles').select('*').eq('id', preview.id).maybeSingle()).data || profile;
  return (
    <>
      <div className="head"><div><h1>My Profile</h1><p className="sub">Your account details and password.</p></div></div>
      <AccountPanel profile={who} readOnly={!!preview} />
    </>
  );
}
