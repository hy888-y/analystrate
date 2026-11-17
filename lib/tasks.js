// Shared task logic used by both portals.
export const STATUSES = ['Not Started', 'In Progress', 'Pending', 'Completed'];
export const SHOW_ORDER = ['Not Started', 'In Progress', 'Pending', 'Overdue', 'Completed'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const SK = { 'Not Started': 'ns', 'In Progress': 'ip', Pending: 'pe', Completed: 'co', Overdue: 'od' };

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00') - Date.parse(a + 'T00:00')) / 864e5);
// Plain dates (2026-11-02) are shown as-is; timestamps are converted to the viewer's local date
const toDate = (s) => (String(s).length <= 10 ? new Date(s + 'T00:00') : new Date(s));
export const localDay = (s) => (s ? isoDate(toDate(s)) : null);
export const fd = (s) => (s ? toDate(s).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fdShort = (s) => (s ? toDate(s).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : '—');
export const fdt = (s) => (s ? new Date(s).toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };

// Overdue is automatic: past the due date and not completed
export const effStatus = (t) => (t.status === 'Completed' ? 'Completed' : t.due_date && t.due_date < today() ? 'Overdue' : t.status);

export function counts(list) {
  const c = { total: list.length, 'Not Started': 0, 'In Progress': 0, Pending: 0, Completed: 0, Overdue: 0 };
  list.forEach((t) => { c[effStatus(t)]++; });
  return c;
}

export function dueInfo(t) {
  const s = effStatus(t);
  if (!t.due_date || s === 'Completed') return null;
  if (s === 'Overdue') return { tone: 'bad', text: `${dayDiff(t.due_date, today())}d overdue` };
  const d = dayDiff(today(), t.due_date);
  return d <= 3 ? { tone: 'warn', text: d === 0 ? 'Due today' : `Due in ${d}d` } : null;
}
export function doneInfo(t) {
  if (t.status !== 'Completed' || !t.completed_at || !t.due_date) return null;
  const d = dayDiff(t.due_date, t.completed_at);
  return d > 0 ? { tone: 'bad', text: `${d}d late` } : { tone: 'ok', text: d < 0 ? `${-d}d early` : 'On time' };
}

export function workload(person, tasks) {
  const list = tasks.filter((t) => t.assignee_id === person.id);
  const c = counts(list);
  const max = Math.max(1, person.max_tasks || 5);
  const open = c.total - c.Completed;
  const ratio = open / max;
  const lv = open === 0 ? 'none' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'full' : 'avail';
  return { c, open, max, ratio, lv, label: { none: 'No tasks', over: 'Overloaded', full: 'At capacity', avail: 'Has capacity' }[lv], pct: c.total ? Math.round((c.Completed / c.total) * 100) : 0 };
}

// Short, stable reference shown as the Task ID (derived from the task's database id)
export const taskCode = (t) => `T-${String(t.id || '').replace(/-/g, '').slice(0, 6).toUpperCase()}`;
export const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
export const longDate = () => new Date().toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
// Compact date: omits the year when it is the current year
export const fdc = (s) => { if (!s) return '—'; const d = String(s).length <= 10 ? new Date(s + 'T00:00') : new Date(s); return d.toLocaleDateString('en-MY', d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }); };
