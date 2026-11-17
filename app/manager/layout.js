import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function ManagerLayout({ children }) {
  const { supabase, profile, perms, preview } = await getSession();
  if (profile.role === 'staff') redirect('/staff?denied=1');
  if (preview?.role === 'staff') redirect('/staff');
  const todayKL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
  const { count: overdue } = await supabase.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'Completed').lt('due_date', todayKL);

  const nav = [['#', 'Main menu'], ['/manager', 'Overview', 'grid'], ['/manager/tasks', 'Task Monitoring', 'tasks', overdue || 0]];
  if (perms['staff.view']) nav.push(['/manager/staff', 'Staff Allocation', 'users']);
  if (perms['users.manage']) nav.push(['/manager/users', 'Employee Management', 'idcard']);
  nav.push(['/manager/calendar', 'Task Calendar', 'calendar']);
  const insights = [];
  if (perms['reports.view']) insights.push(['/manager/reports', 'Reports & Analytics', 'chart']);
  if (perms['staff.view'] || perms['tasks.manage']) insights.push(['/manager/activity', 'Activity', 'activity']);
  if (perms['audit.view']) insights.push(['/manager/audit', 'Audit Log', 'shield']);
  if (insights.length) nav.push(['#', 'Insights'], ...insights);
  nav.push(['#', 'Account'], ['/manager/settings', 'Settings', 'sliders']);

  const shown = preview ? { ...profile, role: 'manager', position: 'Manager' } : profile;
  return (
    <Shell portal={preview ? 'Manager portal' : profile.role === 'admin' ? 'Admin portal' : 'Manager portal'} profile={shown} nav={nav}
      searchPath="/manager/tasks" profileHref="/manager/settings" settingsHref="/manager/settings"
      notify={{ base: '/manager/tasks' }} preview={preview ? 'Manager view' : null}>
      {children}
    </Shell>
  );
}
