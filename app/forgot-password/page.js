import { Logo } from '@/components/Brand';

// Password reset by email needs company email (SMTP), so for now an Admin resets passwords:
// Employee Management → Reset password → Temporary password.
export const metadata = { title: 'Forgot password · TaskLedger' };
export default function ForgotPage() {
  return (
    <main className="auth-side" style={{ minHeight: '100vh' }}>
      <div className="auth-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 20 }}><Logo size={36} />TaskLedger</div>
        <div><h1>Forgot your password?</h1><p className="sub" style={{ marginTop: 6 }}>For security, passwords are reset by your administrator.</p></div>
        <section className="panel" style={{ padding: 20, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}><span className="stat-ico" style={{ flex: 'none' }}>1</span><span>Contact your administrator or manager and ask for a password reset.</span></div>
          <div style={{ display: 'flex', gap: 12 }}><span className="stat-ico" style={{ flex: 'none' }}>2</span><span>They will give you a temporary password.</span></div>
          <div style={{ display: 'flex', gap: 12 }}><span className="stat-ico" style={{ flex: 'none' }}>3</span><span>Sign in with it. You'll be asked to choose a new password straight away.</span></div>
        </section>
        <a className="btn primary" href="/login" style={{ justifyContent: 'center' }}>Back to sign in</a>
      </div>
    </main>
  );
}
