import { useEffect, useRef, useState } from 'react';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getJSON, postJSON, useApi, type Summary } from '../api';
import { day } from '../format';
import { Avatar } from './ui';

const LINKS = [
  { to: '/', label: 'Insights', end: true },
  { to: '/analysts', label: 'Analysts' },
  { to: '/stocks', label: 'Stocks' },
  { to: '/brokers', label: 'Brokers' },
  { to: '/calls', label: 'Screener' },
  { to: '/method', label: "How it's scored" },
];

export const QUICK = [
  { label: 'Calls by Grade A analysts', q: 'grade=A' },
  { label: 'High-risk open calls', q: 'risk=High&status=in_window' },
  { label: 'Biggest target gaps', q: 'sort=upside&status=in_window' },
  { label: 'Sell calls only', q: 'rating=SELL' },
  { label: 'Calls that played out', q: 'hit=1' },
];

interface SearchRes {
  stocks: { code: string; name: string; sector: string | null }[];
  analysts: { id: number; name: string; broker: string; grade: string }[];
}

function Search() {
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 200);
  const [res, setRes] = useState<SearchRes | null>(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dq.trim()) return setRes(null);
    getJSON<SearchRes>(`/search?q=${encodeURIComponent(dq.trim())}`).then(setRes).catch(() => setRes(null));
  }, [dq]);
  useEffect(() => {
    const h = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    setQ('');
    nav(to);
  };
  const first = res?.stocks[0] ? `/stocks/${res.stocks[0].code}` : res?.analysts[0] ? `/analysts/${res.analysts[0].id}` : null;

  return (
    <div className="searchbox" ref={box}>
      <span className="ic">⌕</span>
      <input
        id="global-search"
        placeholder="Search analyst, broker or stock"
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && first && go(first)}
        aria-label="Search analyst, broker or stock"
      />
      {open && res && (res.stocks.length > 0 || res.analysts.length > 0) && (
        <div className="drop">
          {res.stocks.length > 0 && <h6>STOCKS</h6>}
          {res.stocks.map((s) => (
            <a key={s.code} href={`/stocks/${s.code}`} onClick={(e) => { e.preventDefault(); go(`/stocks/${s.code}`); }}>
              <span className="av sm" style={{ background: 'var(--sky)', color: 'var(--blue)' }}>{s.name.slice(0, 2)}</span>
              <span><b>{s.name}</b> <span className="mu num">{s.code}.KL{s.sector ? ` · ${s.sector}` : ''}</span></span>
            </a>
          ))}
          {res.analysts.length > 0 && <h6>ANALYSTS</h6>}
          {res.analysts.map((a) => (
            <a key={a.id} href={`/analysts/${a.id}`} onClick={(e) => { e.preventDefault(); go(`/analysts/${a.id}`); }}>
              <Avatar name={a.name} grade={a.grade} size="sm" />
              <span><b>{a.name}</b> <span className="mu">{a.broker}</span></span>
            </a>
          ))}
        </div>
      )}
      {open && res && res.stocks.length === 0 && res.analysts.length === 0 && (
        <div className="drop"><div className="mu" style={{ padding: 10 }}>No stock or analyst matches “{dq}”.</div></div>
      )}
    </div>
  );
}

const DISCLAIMER =
  'AnalystRate rates how reliable analysts\u2019 past recommendations have been. It is not a stock recommender and nothing on this website is financial advice.';

function Footer() {
  const s = useApi<Summary>('/summary');
  const p = s.data?.pipeline;
  return (
    <footer className="foot">
      <div className="in">
        <div>
          <p className="warn"><b>Not financial advice.</b> {s.data?.disclaimer ?? DISCLAIMER}</p>
          <p>
            Free and open for every retail investor, in support of SDG 8 target 8.10 (access to financial services for all).
            Recommendations from {s.data?.brokers ?? 17} Malaysian brokers' public research reports; prices from Yahoo Finance.
          </p>
        </div>
        <div>
          <p>
            <b>Data</b> · {s.data ? `${s.data.recommendations.toLocaleString()} calls · ${s.data.analysts} analysts · ${s.data.stocks} stocks` : '…'}
            {p?.as_of && <> · prices up to {day(p.as_of)}</>}
            {p?.computed_at && <> · scores computed {day(p.computed_at)}</>}
          </p>
          <p>
            <b>Open data</b> · <a href="/api/export/recommendations.csv">Download all calls (CSV)</a> ·{' '}
            <a href="/api/export/analysts.csv">Download analyst scores (CSV)</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Usability feedback (IR 4.3): anonymous 1–5 ratings per page, summarised on the Method page. */
function Feedback() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [clarity, setClarity] = useState(0);
  const [useful, setUseful] = useState(0);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const page = loc.pathname.split('/')[1] || 'insights';
  useEffect(() => { setSent(false); setClarity(0); setUseful(0); setComment(''); }, [loc.pathname]);
  const send = () =>
    postJSON('/feedback', { page, clarity, useful: useful || null, comment: comment.trim() || null }).then(() => setSent(true)).catch(() => setSent(true));
  return (
    <>
      <button className="btn pri fbbtn" onClick={() => setOpen((o) => !o)}>{open ? '✕ Close' : '☺ Rate this page'}</button>
      {open && (
        <div className="fbcard" role="dialog" aria-label="Rate this page">
          {sent ? (
            <><h4>Thank you!</h4><p className="mu">Your rating is anonymous and helps make the explanations clearer.</p></>
          ) : (
            <>
              <h4>Was this page easy to understand?</h4>
              <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={clarity === n ? 'on' : ''} onClick={() => setClarity(n)}>{n}</button>)}</div>
              <h4>Does it help you judge which analyst to trust?</h4>
              <div className="stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} className={useful === n ? 'on' : ''} onClick={() => setUseful(n)}>{n}</button>)}</div>
              <textarea placeholder="Anything confusing? (optional, no personal details please)" value={comment} onChange={(e) => setComment(e.currentTarget.value)} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span className="mini">1 = not at all · 5 = very</span>
                <button className="btn pri" disabled={!clarity} onClick={send}>Send</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export function Shell() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => setMenu(false), [loc.pathname]);
  const activeQuick = loc.pathname === '/calls' ? loc.search.replace(/^\?/, '') : '';

  return (
    <>
      <header className="nav">
        <Link to="/" className="logo"><i>◆</i><span>Analyst<b>Rate</b></span></Link>
        <Search />
        <nav className={`links ${menu ? 'open' : ''}`}>
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'on' : '')}>{l.label}</NavLink>
          ))}
        </nav>
        <button className="iconbtn burger" aria-label="Menu" onClick={() => setMenu((m) => !m)}>☰</button>
        <button className="iconbtn" aria-label="Toggle dark mode" onClick={() => setColorScheme(scheme === 'light' ? 'dark' : 'light')}>
          {scheme === 'light' ? '☾' : '☀'}
        </button>
      </header>
      <div className="band">
        <b>⚡ Quick views</b>
        {QUICK.map((c) => (
          <button key={c.q} className={`chip ${activeQuick === c.q ? 'on' : ''}`} onClick={() => nav(`/calls?${c.q}`)}>{c.label}</button>
        ))}
      </div>
      <Outlet />
      <Footer />
      <Feedback />
    </>
  );
}
