import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Rec } from '../api';
import { day, rm, signedPct } from '../format';
import { Pill, Risk, Who } from './ui';

type Col = 'analyst' | 'stock';

function Outcome({ r }: { r: Rec }) {
  if (r.status === 'in_window') return <span className="mu">⏳ in window</span>;
  if (r.status !== 'evaluated') return <span className="mu">no price data</span>;
  return (
    <span>
      <b className={r.hit ? 'up' : 'dn'}>{r.hit ? '✓ Hit' : '✗ Miss'}</b>{' '}
      <span className="mu num">{signedPct((r.return_12m ?? 0) * 100)}</span>
      {r.note === 'delisted_exit' && <span className="mu"> · delisted</span>}
    </span>
  );
}

/** Recommendation trust score (Explainable Confidence Score of this call, as known on the call date). */
export function Trust({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span className="mu">–</span>;
  const c = v >= 60 ? 'var(--up)' : v >= 50 ? 'var(--blue)' : v >= 40 ? 'var(--amber)' : 'var(--dn)';
  return (
    <span className="trust" title="Trust score of this call (0–100), from what was known on the call date">
      <b className="num">{v.toFixed(0)}</b>
      <span className="b"><i style={{ width: `${v}%`, background: c }} /></span>
    </span>
  );
}

const RISK_NAMES: Record<string, string> = {
  track: 'Track record (inverse)',
  volatility: 'Volatility',
  confidence: 'Call trust score (inverted)',
};

function Details({ r }: { r: Rec }) {
  const k = r.risk;
  const scope = !k ? '' : k.prior_scope === 'stock' ? `${k.prior_n} earlier resolved calls on this stock`
    : k.prior_scope === 'analyst' ? `${k.prior_n} earlier resolved calls (any stock)` : 'market average (no history yet)';
  return (
    <div className="details">
      <div>
        <div className="dh">Why trust this call? <span>score {r.confidence_score?.toFixed(1) ?? '–'} / 100 · known on {day(r.report_date)}</span></div>
        {r.confidence?.map((f) => (
          <div className="drow" key={f.key}>
            <span><b>{f.label}</b><small>{f.evidence}</small></span>
            <span className="num mu">{f.value.toFixed(0)} × {Math.round(f.weight * 100)}%</span>
            <b className="num">+{f.points.toFixed(1)}</b>
          </div>
        ))}
      </div>
      {k && (
        <div>
          <div className="dh">What drives its risk <span>{r.risk_level} · {r.risk_score?.toFixed(0)} / 100</span></div>
          {Object.entries(k.components).map(([key, val]) => (
            <div className="drow" key={key}>
              <span>
                <b>{RISK_NAMES[key] ?? key}</b>
                <small>
                  {key === 'track' && `${k.prior_hit_rate.toFixed(0)}% hits · ${scope}`}
                  {key === 'volatility' && (k.volatility_annual !== null ? `${k.volatility_annual}% a year, trailing 1 year` : 'not enough price history')}
                  {key === 'confidence' && `trust score ${k.confidence_score?.toFixed(0) ?? '–'}`}
                </small>
              </span>
              <span className="num mu">{val === null ? '–' : val.toFixed(0)} × {Math.round((k.weights_used[key] ?? 0) * 100)}%</span>
              <span className="mbar"><i style={{ width: `${val ?? 0}%` }} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CallsTable({ items, show = ['analyst', 'stock'], empty = 'No calls match.' }: { items: Rec[]; show?: Col[]; empty?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return <div className="empty">{empty}</div>;
  const cols = 8 + show.length;
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr>
            <th>DATE</th>
            {show.includes('stock') && <th>STOCK</th>}
            {show.includes('analyst') && <th>ANALYST</th>}
            <th>CALL</th><th>PRICE</th><th>TARGET</th><th>UPSIDE</th><th title="Recommendation trust score">TRUST</th><th>12M RESULT</th><th>RISK</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const up = r.entry_price && r.target_price ? (r.target_price / r.entry_price - 1) * 100 : null;
            return (
              <Fragment key={r.id}>
                <tr className="click" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <td className="num mu">{day(r.report_date)}</td>
                  {show.includes('stock') && (
                    <td>
                      <Link to={`/stocks/${r.code}`} onClick={(e) => e.stopPropagation()}><b>{r.stock}</b></Link>{' '}
                      <span className="mu num">{r.code}</span>
                    </td>
                  )}
                  {show.includes('analyst') && (
                    <td>
                      <Link to={`/analysts/${r.analyst_id}`} onClick={(e) => e.stopPropagation()}>
                        <Who name={r.analyst} sub={r.broker} grade={r.grade} size="sm" />
                      </Link>
                    </td>
                  )}
                  <td>{r.from ? <><Pill r={r.from} /> <span className="mu">→</span> </> : null}<Pill r={r.rating} /></td>
                  <td className="num">{rm(r.entry_price)}</td>
                  <td className="num">{rm(r.target_price)}</td>
                  <td className={`num ${up === null ? 'mu' : up >= 0 ? 'up' : 'dn'}`}>{up === null ? '–' : signedPct(up)}</td>
                  <td><Trust v={r.confidence_score} /></td>
                  <td><Outcome r={r} /></td>
                  <td><Risk level={r.risk_level} /></td>
                </tr>
                {open === r.id && (
                  <tr className="detail"><td colSpan={cols}><Details r={r} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="tblnote">Click a call to see why it can (or can’t) be trusted and what drives its risk.</div>
    </div>
  );
}
