'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import Icon from '@/components/icons';
import { Toaster, initials } from '@/components/ui';
import { stopPreview } from '@/app/manager/settings/preview-actions';
import NotificationBell from '@/components/NotificationBell';
import { useDropdown } from '@/components/useDropdown';

const IDLE_MIN = Number(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES || 30);
const COMPANY = process.env.NEXT_PUBLIC_COMPANY_NAME || 'Company workspace';

// Signs the user out after inactivity (the server also enforces this on every request)
function IdleLogout() {
  const t = useRef();
  useEffect(() => {
    const remember = /(?:^|;\s*)yl_rem_ui=1/.test(document.cookie);
    const ms = remember ? 7 * 24 * 3600000 : IDLE_MIN * 60000;
    const out = () => {
      const f = document.createElement('form'); f.method = 'POST'; f.action = '/auth/signout?reason=timeout';
      document.body.appendChild(f); f.submit();
    };
    const reset = () => { clearTimeout(t.current); t.current = setTimeout(out, ms); };
    const ev = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    ev.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(t.current); ev.forEach((e) => window.removeEventListener(e, reset)); };
  }, []);
  return null;
}

function Denied() {
  const sp = useSearchParams();
  return sp.get('denied') ? <div className="notice bad" role="alert">You don't have access to that page. Contact your administrator if you need it.</div> : null;
}

export function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <rect x="2" y="2" width="52" height="52" rx="16" fill="#A855F7" />
      <rect x="14" y="15" width="28" height="5" rx="2.5" fill="#fff" />
      <rect x="14" y="25.5" width="20" height="5" rx="2.5" fill="#fff" opacity=".85" />
      <rect x="14" y="36" width="12" height="5" rx="2.5" fill="#E9D5FF" />
      <circle cx="38" cy="38.5" r="4" fill="#E9D5FF" />
    </svg>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.style === 'dark'); }, []);
  const flip = () => {
    const next = !dark; setDark(next);
    document.documentElement.dataset.style = next ? 'dark' : '';
    try { localStorage.setItem('tl-style', next ? 'dark' : 'light'); } catch {}
  };
  return <button type="button" className="icon-btn" onClick={flip} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}><Icon name={dark ? 'sun' : 'moon'} /></button>;
}

function ProfileMenu({ profile, sub, profileHref, settingsHref }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="dd" ref={ref}>
      <button type="button" className="me-chip" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar" aria-hidden="true">{initials(profile.full_name)}</span>
        <span className="me-txt"><b>{profile.full_name}</b><small>{sub}</small></span>
        <Icon name="chevd" size={16} className="muted" />
      </button>
      {open && (
        <div className="dd-menu narrow" role="menu">
          <div className="dd-head"><div style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{profile.full_name}</b><span className="small muted">{profile.email}</span></div></div>
          <a href={profileHref} role="menuitem"><Icon name="account" size={17} />My profile</a>
          <a href={`${profileHref}#password`} role="menuitem"><Icon name="lock" size={17} />Change password</a>
          {settingsHref && <a href={settingsHref} role="menuitem"><Icon name="sliders" size={17} />Settings</a>}
          <form method="POST" action="/auth/signout"><button className="mi bad" type="submit" role="menuitem"><Icon name="logout" size={17} />Log out</button></form>
        </div>
      )}
    </div>
  );
}

// nav entries: [href, label, icon, badge] or ['#', 'Group label']
export default function Shell({ portal, profile, nav, children, searchPath, preview, profileHref, settingsHref, notify }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const roleLabel = { admin: 'Admin', manager: 'Manager', staff: 'Staff' }[profile.role];
  const links = nav.filter(([h]) => h !== '#');
  const roots = ['/manager', '/staff'];
  const current = links.find(([href]) => href === path)
    || links.filter(([href]) => !roots.includes(href) && path.startsWith(href)).sort((a, b) => b[0].length - a[0].length)[0];
  const sub = profile.position && profile.position !== roleLabel ? `${roleLabel} · ${profile.position}` : roleLabel;
  return (
    <div className="app">
      <aside className={`side${open ? ' open' : ''}`} aria-label="Main navigation">
        <a href="/" className="brand-row"><Logo /><b>TaskLedger</b></a>
        <button className="icon-btn only-mobile side-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        <div className="ws-box"><span className="ws-dot" aria-hidden="true">{initials(COMPANY)}</span><span style={{ minWidth: 0 }}><b>{COMPANY}</b><small>{portal}</small></span></div>
        <nav className="side-nav">
          {nav.map(([href, label, icon, badge], i) => {
            if (href === '#') return <div key={`g${i}`} className="side-label">{label}</div>;
            const on = current && current[0] === href;
            return (
              <a key={href} href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
                <Icon name={icon} /><span>{label}</span>{badge ? <em className="nav-badge">{badge}</em> : null}
              </a>
            );
          })}
        </nav>
        <div className="side-foot">
          <a href={profileHref} className="side-me"><span className="avatar" aria-hidden="true">{initials(profile.full_name)}</span><span style={{ minWidth: 0 }}><b>{profile.full_name}</b><small>{sub}</small></span></a>
          <form method="POST" action="/auth/signout"><button className="side-out" type="submit"><Icon name="logout" /><span>Log out</span></button></form>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      <div className="maincol">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <form className="top-search" action={searchPath} method="GET" role="search">
            <Icon name="search" size={17} />
            <input type="search" name="q" placeholder="Search tasks…" aria-label="Search tasks" />
          </form>
          <div className="spacer" />
          <span className="live" title="Changes from other people appear instantly"><i />Live</span>
          <ThemeToggle />
          {notify && <NotificationBell {...notify} />}
          <ProfileMenu profile={profile} sub={sub} profileHref={profileHref} settingsHref={settingsHref} />
        </header>
        {preview && (
          <div className="preview-bar" role="status">
            <Icon name="eye" size={16} /><span><b>Preview: {preview}.</b> This is exactly what they see. Read-only; nothing can be changed here.</span>
            <form action={stopPreview}><button className="btn small" type="submit">Exit preview</button></form>
          </div>
        )}
        <main className="page fade-in" key={path}>
          <Suspense fallback={null}><Denied /></Suspense>
          {children}
        </main>
      </div>
      <IdleLogout />
      <Toaster />
    </div>
  );
}
