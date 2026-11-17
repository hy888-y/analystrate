'use client';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { login } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return <button className="btn primary" type="submit" disabled={pending} style={{ padding: '12px' }}>{pending ? 'Signing in…' : 'Sign in'}</button>;
}

export default function LoginForm({ next }) {
  const [state, action] = useFormState(login, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label className="label" htmlFor="email">Company email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email || ''} placeholder="you@company.com" />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">Password</label>
        <div className="pw">
          <input id="password" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" />
          <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-controls="password">{show ? 'Hide' : 'Show'}</button>
        </div>
      </div>
      <div className="auth-row"><label className="check"><input type="checkbox" name="remember" className="chk" defaultChecked /> Remember me</label><a href="/forgot-password">Forgot password?</a></div>
      {state?.error && <div className="err" role="alert">{state.error}</div>}
      <Submit />
    </form>
  );
}
