import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import Shell from '@/components/Shell';
import { PreviewProvider } from '@/components/preview';

export const dynamic = 'force-dynamic';

export default async function StaffLayout({ children }) {
  const { supabase, profile, preview } = await getSession();
  let who = profile;
  if (profile.role !== 'staff') {
    if (preview?.role !== 'staff') redirect('/manager');
    const { data: p } = await supabase.from('profiles').select('*').eq('id', preview.id).maybeSingle();
    if (!p) redirect('/manager/settings');
    who = p;
  }
  const { count: open } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('assignee_id', who.id).neq('status', 'Completed');
  const nav = [['#', 'Main menu'], ['/staff', 'My Dashboard', 'grid'], ['/staff/tasks', 'My Tasks', 'check', open || 0], ['/staff/calendar', 'My Calendar', 'calendar'], ['/staff/history', 'Task History', 'history'], ['#', 'Account'], ['/staff/profile', 'My Profile', 'account']];
  return (
    <PreviewProvider value={preview?.role === 'staff' ? { asId: who.id, name: who.full_name, position: who.position } : null}>
      <Shell portal="Staff portal" profile={who} nav={nav} searchPath="/staff/tasks" profileHref="/staff/profile" notify={{ asId: preview?.role === 'staff' ? who.id : 'me', base: '/staff/tasks' }} preview={preview ? `Staff view as ${who.full_name}` : null}>{children}</Shell>
    </PreviewProvider>
  );
}
