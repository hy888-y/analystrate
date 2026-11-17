'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SK, dueInfo, doneInfo } from '@/lib/tasks';

export const StatusPill = ({ s }) => <span className={`st st-${SK[s]}`}>{s}</span>;
export const Priority = ({ p }) => (p ? <span className={`pr pr-${p}`}>{p}</span> : null);
export const Note = ({ info }) => (info ? <div className="small" style={{ color: `var(--${info.tone})` }}>{info.text}</div> : null);
export const DueNote = ({ t }) => <Note info={dueInfo(t)} />;
export const DoneNote = ({ t }) => <Note info={doneInfo(t)} />;

export function Progress({ value, over }) {
  const p = Math.max(0, Math.min(100, Math.round(value || 0)));
  return <div className="prog"><div className={`track${over ? ' over' : ''}`}><i style={{ width: `${p}%` }} /></div><span>{p}%</span></div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const [host, setHost] = useState(null);
  useEffect(() => setHost(document.body), []);
  if (!host) return null;
  // Rendered on <body> so it covers the whole screen, not just the page area
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(760px,100%)' } : undefined}>{children}</div>
    </div>, host);
}

// Two-click confirm for destructive actions
export function ConfirmButton({ children, onConfirm, className = 'btn small danger', confirmText = 'Click again to confirm' }) {
  const [armed, setArmed] = useState(false);
  const t = useRef();
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <button type="button" className={className} onClick={() => {
      if (!armed) { setArmed(true); t.current = setTimeout(() => setArmed(false), 4000); return; }
      setArmed(false); onConfirm();
    }}>{armed ? confirmText : children}</button>
  );
}

let pushToast;
export function Toaster() {
  const [msg, setMsg] = useState('');
  const t = useRef();
  pushToast = (m) => { setMsg(m); clearTimeout(t.current); t.current = setTimeout(() => setMsg(''), 2800); };
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
export const toast = (m) => pushToast && pushToast(m);

export function friendlyError(error) {
  const m = (error && (error.message || String(error))) || '';
  if (/row-level security|permission|not allowed/i.test(m)) return "You don't have permission to do that.";
  if (/due_after_start/.test(m)) return 'The due date is before the start date.';
  if (/fetch|network/i.test(m)) return 'Connection problem. Try again.';
  return m || 'Something went wrong. Try again.';
}

export function useDebounced(fn, ms = 250) {
  const t = useRef();
  return useCallback((...a) => { clearTimeout(t.current); t.current = setTimeout(() => fn(...a), ms); }, [fn, ms]);
}

// Animated number (counts from the previous value)
export function CountUp({ v, decimals = 0, suffix = '' }) {
  const n = Number(v);
  const [shown, setShown] = useState(Number.isFinite(n) ? n : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (!Number.isFinite(n)) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = from.current, t0 = performance.now(), dur = 600;
    if (reduce || start === n) { setShown(n); from.current = n; return; }
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setShown(start + (n - start) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = n;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  if (!Number.isFinite(n)) return <>{v}</>;
  return <>{shown.toFixed(decimals)}{suffix}</>;
}

export function Skeleton({ rows = 5 }) {
  return <div className="skel-rows" aria-hidden="true">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: i === 0 ? 18 : 40, width: i === 0 ? '30%' : '100%' }} />)}</div>;
}

export function Ring({ value, label, color = 'var(--accent)' }) {
  const r = 52, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="ring" role="img" aria-label={`${label}: ${Math.round(p)}%`}>
      <svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r={r} fill="none" stroke="var(--sunk)" strokeWidth="12" />
        <circle className="val" cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} /></svg>
      <div className="rv"><div>{Math.round(p)}%<small>{label}</small></div></div>
    </div>
  );
}

export const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
