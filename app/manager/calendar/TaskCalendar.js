'use client';
import { useState } from 'react';
import { useLive } from '@/components/useLive';
import { loadBoard } from '../TaskMonitor';
import { effStatus, SHOW_ORDER, PRIORITIES } from '@/lib/tasks';
import CalendarView from '@/components/CalendarView';
import { Skeleton } from '@/components/ui';

export default function TaskCalendar() {
  const { data, error } = useLive(loadBoard, ['tasks', 'profiles']);
  const [staff, setStaff] = useState(''); const [status, setStatus] = useState(''); const [pri, setPri] = useState('');
  const people = data?.people || [];
  const name = (id) => (id ? people.find((p) => p.id === id)?.full_name || 'Former staff' : 'Unassigned');
  const shown = (data?.tasks || []).filter((t) => (!staff || t.assignee_id === staff) && (!status || effStatus(t) === status) && (!pri || t.priority === pri));
  return (
    <>
      <div className="head"><div><h1>Task Calendar</h1><p className="sub">Every task on its due date, coloured by priority. Click a day to see what's due.</p></div></div>
      {error && <div className="notice bad">{error}</div>}
      <div className="toolbar">
        <select value={staff} onChange={(e) => setStaff(e.target.value)} aria-label="Filter by employee"><option value="">All employees</option>{people.filter((p) => p.role === 'staff').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option>{SHOW_ORDER.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={pri} onChange={(e) => setPri(e.target.value)} aria-label="Filter by priority"><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
        <span className="small muted">{data ? `${shown.length} task${shown.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {!data ? <section className="panel"><Skeleton rows={6} /></section> : <CalendarView tasks={shown} hrefOf={(t) => `/manager/tasks/${t.id}`} nameOf={name} />}
    </>
  );
}
