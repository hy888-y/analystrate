'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Brand from '@/components/Brand';

function checkPassword(p) {
  if (p.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) return 'Use upper and lower case letters and at least one number.';
  return '';
}

export default function ResetForm() {
  const forced = useSearchParams().get('forced') === '1';
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr('');
    const problem = checkPassword(pw); if (problem) return setErr(problem);
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    const sb = createClient();
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) { setBusy(false); return setErr(error.message.includes('different') ? 'Choose a password you have not used before.' : 'Could not change the password. The link may have expired; request a new one.'); }
    await sb.rpc('password_changed');
    await fetch('/auth/signout', { method: 'POST' });
    window.location.href = '/login?e=reset';
  }

  return (
    <div className="auth-wrap"><div className="auth">
      <div className="lhead"><Brand big /><p className="sub" style={{ margin: 0 }}>{forced ? 'Set a new password before you continue' : 'Choose a new password'}</p></div>
      <form onSubmit={submit} noValidate>
        <div className="field"><label className="label" htmlFor="pw">New password</label>
          <div className="pw"><input id="pw" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button></div>
          <span className="hint">At least 10 characters, with upper and lower case letters and a number.</span></div>
        <div className="field"><label className="label" htmlFor="pw2">Confirm new password</label>
          <input id="pw2" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ padding: 10 }}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div></div>
  );
}
