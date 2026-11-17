'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fd, fdt } from '@/lib/tasks';
import { toast, initials } from '@/components/ui';
import Icon from '@/components/icons';

const ROLE = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };

function check(p) {
  if (p.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) return 'Use upper and lower case letters and at least one number.';
  return '';
}

// My profile details plus change password (current password is checked first)
export default function AccountPanel({ profile, readOnly }) {
  const [f, setF] = useState({ cur: '', pw: '', pw2: '' }); const [show, setShow] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e) {
    e.preventDefault(); setErr('');
    if (readOnly) return setErr('Preview is read-only.');
    if (!f.cur) return setErr('Enter your current password.');
    const problem = check(f.pw); if (problem) return setErr(problem);
    if (f.pw !== f.pw2) return setErr('The two new passwords do not match.');
    if (f.pw === f.cur) return setErr('Choose a password different from your current one.');
    setBusy(true);
    const sb = createClient();
    const { error: bad } = await sb.auth.signInWithPassword({ email: profile.email, password: f.cur });
    if (bad) { setBusy(false); return setErr('Your current password is incorrect.'); }
    const { error } = await sb.auth.updateUser({ password: f.pw });
    if (error) { setBusy(false); return setErr(error.message.includes('different') ? 'Choose a password you have not used before.' : 'Could not change the password. Try again.'); }
    await sb.rpc('password_changed');
    setBusy(false); setF({ cur: '', pw: '', pw2: '' }); toast('Password changed');
  }
  return (
    <>
      <section className="panel" id="account">
        <div className="prof-card"><span className="avatar lg" aria-hidden="true">{initials(profile.full_name)}</span>
          <div style={{ minWidth: 0 }}><h2 style={{ fontSize: 20 }}>{profile.full_name}</h2><div className="muted">{profile.position || ROLE[profile.role]}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}><span className={`badge ${profile.role === 'admin' ? 'b-accent' : profile.role === 'manager' ? 'b-info' : 'b-none'}`}>{ROLE[profile.role]}</span><span className="badge b-avail">Active</span></div></div></div>
        <div className="kv">
          <div><span className="label">Company email (sign-in)</span><b>{profile.email}</b></div>
          <div><span className="label">Employee ID</span><b className="tid" style={{ fontSize: 14, color: 'var(--fg)' }}>{profile.staff_code || '—'}</b></div>
          <div><span className="label">Job position</span><b>{profile.position || '—'}</b></div>
          {profile.role === 'staff' && <div><span className="label">Task capacity</span><b>{profile.max_tasks || 5} open tasks</b></div>}
          <div><span className="label">Member since</span><b>{fd(profile.created_at)}</b></div>
          <div><span className="label">Last sign-in</span><b>{profile.last_login_at ? fdt(profile.last_login_at) : '—'}</b></div>
        </div>
        <p className="small muted" style={{ padding: '0 22px 20px', margin: 0 }}>To change your name, email or position, ask an administrator.</p>
      </section>
      <section className="panel" id="password">
        <div className="ph"><span className="stat-ico"><Icon name="lock" size={17} /></span><div><h2>Change password</h2><div className="small muted">You stay signed in on this device.</div></div></div>
        <form className="pw-form" onSubmit={submit} noValidate>
          <div className="field"><label className="label" htmlFor="cur">Current password</label><input id="cur" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.cur} onChange={set('cur')} /></div>
          <div className="field"><label className="label" htmlFor="npw">New password</label><input id="npw" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.pw} onChange={set('pw')} />
            <span className="hint">At least 10 characters, with upper and lower case letters and a number.</span></div>
          <div className="field"><label className="label" htmlFor="npw2">Confirm new password</label><input id="npw2" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.pw2} onChange={set('pw2')} /></div>
          <label className="check"><input type="checkbox" className="chk" checked={show} onChange={(e) => setShow(e.target.checked)} />Show passwords</label>
          {err && <div className="err" role="alert">{err}</div>}
          <div><button className="btn primary" type="submit" disabled={busy || readOnly}>{busy ? 'Saving…' : 'Update password'}</button></div>
        </form>
      </section>
    </>
  );
}
