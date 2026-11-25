import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useApi, type Analyst, type StockSummary } from '../api';

export const QUICK = [
  { label: 'Grade A analysts', q: 'grade=A' },
  { label: 'High-risk open calls', q: 'risk=High' },
  { label: 'Biggest target gaps', q: 'sort=upside' },
  { label: 'Sell calls only', q: 'rating=SELL' },
  { label: 'Calls that played out', q: 'status=evaluated&hit=1' },
];

export const LINKS = [
  { to: '/', label: 'Insights', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12h2V7H2v5zm4 0h2V4H6v8zm4 0h2V9h-2v3z" fill="currentColor"/></svg>
  )},
  { to: '/analysts', label: 'Analysts', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 13c0-2.485 2.015-4.5 4.5-4.5s4.5 2.015 4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" strokeWidth="1.4"/><path d="M14.5 13c0-1.657-1.12-3.08-2.667-3.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
  )},
  { to: '/stocks', label: 'Stocks', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 10l3-4 3 2 3-5 2 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
  )},
  { to: '/brokers', label: 'Brokers', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="9" width="3" height="4" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="6.5" y="6" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.4"/><rect x="11" y="3" width="3" height="10" rx="1" stroke="currentColor" strokeWidth="1.4"/></svg>
  )},
  { to: '/calls', label: 'Screener', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.4"/><path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
  )},
  { to: '/method', label: 'How it\'s scored', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
  )},
];

function Search() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const analysts = useApi<Analyst[]>(q.length >= 2 ? `/search/analysts?q=${encodeURIComponent(q)}` : null);
  const stocks = useApi<StockSummary[]>(q.length >= 2 ? `/search/stocks?q=${encodeURIComponent(q)}` : null);
  const show = open && q.length >= 2;

  return (
    <div className="searchbox" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <svg className="search-ic" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search analysts, stocks…"
      />
      {show && (
        <div className="drop">
          {analysts.data?.length ? (
            <>
              <h6>Analysts</h6>
              {analysts.data.slice(0, 4).map((a) => (
                <Link key={a.id} to={`/analysts/${a.id}`} onMouseDown={() => { setOpen(false); setQ(''); }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--blue-soft)', color: 'var(--blue)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {a.name.split(' ').filter((w: string) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w: string) => w[0]).join('')}
                  </span>
                  <span>{a.name} <small style={{ color: 'var(--mute)' }}>{a.broker}</small></span>
                </Link>
              ))}
            </>
          ) : null}
          {stocks.data?.length ? (
            <>
              <h6>Stocks</h6>
              {stocks.data.slice(0, 4).map((s) => (
                <Link key={s.code} to={`/stocks/${s.code}`} onMouseDown={() => { setOpen(false); setQ(''); }}>
                  <span style={{ fontWeight: 700, color: 'var(--blue)', minWidth: 36, fontSize: 12 }}>{s.code}</span>
                  <span style={{ color: 'var(--mute)', fontSize: 12 }}>{s.name}</span>
                </Link>
              ))}
            </>
          ) : null}
          {!analysts.data?.length && !stocks.data?.length && (
            <div style={{ padding: '8px 10px', color: 'var(--mute)', fontSize: 13 }}>No results for "{q}"</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="in one">
        <p className="warn">⚠ Not investment advice.</p>
        <p>AnalystRate scores broker research calls on Bursa Malaysia for educational purposes only. All data is historical; past accuracy does not predict future performance.</p>
        <p>Data sourced from public broker reports. <a href="/method">Methodology</a>.</p>
      </div>
    </footer>
  );
}

function Feedback() {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) return (
    <button className="btn pri fbbtn" onClick={() => setSent(false)} style={{ padding: '9px 15px' }}>
      ✓ Thanks!
    </button>
  );

  return (
    <>
      {open && (
        <div className="fbcard">
          <h4>How useful is this?</h4>
          <p style={{ margin: '0 0 6px', color: 'var(--mute)', fontSize: 12 }}>Rate your experience</p>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className={rating === n ? 'on' : ''} onClick={() => setRating(n)}>{n}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Any comments? (optional)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn pri" style={{ flex: 1 }} onClick={() => { setSent(true); setOpen(false); }}>Send</button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <button className="btn fbbtn" onClick={() => setOpen(!open)}>
        {open ? '✕ Close' : '✦ Feedback'}
      </button>
    </>
  );
}

export function Shell() {
  const [sideOpen, setSideOpen] = useState(false);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const isDark = scheme === 'dark';
  const nav = useNavigate();

  return (
    <>
      {sideOpen && <div className="sb-overlay" onClick={() => setSideOpen(false)} />}

      <aside className={`sidebar ${sideOpen ? 'open' : ''}`}>
        <div className="sb-top">
          <Link to="/" className="logo" onClick={() => setSideOpen(false)}>
            <i>AR</i>
            <span>Analyst<b>Rate</b></span>
          </Link>
        </div>

        <nav className="sidenav">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) => `snav-item${isActive ? ' on' : ''}`}
              onClick={() => setSideOpen(false)}
            >
              {l.icon}
              <span>{l.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sb-divider" />

        <div className="sb-quick">
          <div className="sb-section-label">Quick views</div>
          {QUICK.map((c) => (
            <button
              key={c.q}
              className="sb-filter"
              onClick={() => { nav(`/calls?${c.q}`); setSideOpen(false); }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="sb-foot">
          <button
            className="sb-toggle"
            onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
          >
            {isDark
              ? <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M7.5 1v1M7.5 13v1M1 7.5h1M13 7.5h1M3 3l.7.7M11.3 11.3l.7.7M3 12l.7-.7M11.3 3.7l.7-.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              : <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M12 8.5A5 5 0 0 1 6.5 3c0-.6.1-1.2.3-1.7A5.5 5.5 0 1 0 13.7 8.2c-.5.2-1.1.3-1.7.3z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      <div className="main-wrap">
        <div className="topbar">
          <button className="burger" onClick={() => setSideOpen(!sideOpen)} aria-label="Menu">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <Search />
        </div>

        <div className="content-area">
          <Outlet />
          <Footer />
        </div>
      </div>

      <Feedback />
    </>
  );
}
