'use client';
import { useLive } from '@/components/useLive';
import { loadMine } from '@/components/myTasks';
import { usePreview } from '@/components/preview';
import CalendarView from '@/components/CalendarView';
import { Skeleton } from '@/components/ui';

export default function MyCalendar() {
  const pv = usePreview();
  const { data, error } = useLive((sb) => loadMine(sb, pv?.asId), ['tasks'], pv?.asId || '');
  return (
    <>
      <div className="head"><div><h1>My Calendar</h1><p className="sub">Your tasks on their due dates, coloured by priority. Click a day to see what's due.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      {!data ? <section className="panel"><Skeleton rows={6} /></section> : <CalendarView tasks={data.tasks} hrefOf={(t) => `/staff/tasks/${t.id}`} />}
    </>
  );
}
