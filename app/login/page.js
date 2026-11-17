import LoginForm from './LoginForm';
import { Logo } from '@/components/Brand';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · TaskLedger' };

const NOTES = {
  timeout: ['info', 'You were signed out after a period of inactivity. Please sign in again.'],
  inactive: ['bad', 'Your account is not active. Contact your administrator.'],
  signedout: ['ok', 'You have signed out.'],
  link: ['bad', 'That link is invalid or has expired. Request a new one.'],
  reset: ['ok', 'Your password has been changed. Sign in with your new password.'],
};
const FEATS = [
  ['M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', 'Track every task from start to completion'],
  ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'Balance workloads across your team'],
  ['M22 12h-4l-3 9L9 3l-3 9H2', 'Live updates between managers and staff'],
];
const MOCK = [['Bank reconciliation', 'In Progress', '#4285E8'], ['Revenue testing', 'Completed', '#22A06B'], ['Payroll walkthrough', 'Pending', '#E5A32B']];

export default function LoginPage({ searchParams }) {
  const note = NOTES[searchParams?.e];
  return (
    <div className="auth-split">
      <aside className="auth-brand" aria-hidden="true">
        <div className="logo-row"><Logo size={40} />TaskLedger</div>
        <h2>Task monitoring &amp; staff allocation, in one place.</h2>
        <p>Assign work, follow progress and keep every deadline in view, with each person seeing exactly what they need.</p>
        <div className="auth-feats">
          {FEATS.map(([d, t]) => <div key={t}><i><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></i>{t}</div>)}
        </div>
        <div className="auth-mock">
          {MOCK.map(([t, s, c]) => <div className="mrow" key={t}><span style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{t}<em style={{ background: c }}>{s}</em></div>)}
        </div>
      </aside>
      <main className="auth-side">
        <div className="auth-box">
          <div className="auth-only-mobile" style={{ alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 20 }}><Logo size={36} />TaskLedger</div>
          <div><h1>Welcome back</h1><p className="sub" style={{ marginTop: 6 }}>Sign in with your company email. You'll be taken to your portal automatically.</p></div>
          {note && <div className={`notice ${note[0]}`} role="status">{note[1]}</div>}
          <LoginForm next={searchParams?.next || ''} />
          <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>Need access? Ask your administrator to register your account.</p>
        </div>
      </main>
    </div>
  );
}
