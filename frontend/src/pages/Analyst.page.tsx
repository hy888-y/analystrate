import { useState } from 'react';
import { Pagination } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useApi, type AnalystDetail, type BreakdownRow, type Rec } from '../api';
import { CallsTable } from '../components/CallsTable';
import { Avatar, ErrorBox, Flags, GradeChip, Loading } from '../components/ui';
import { pct, signedPct } from '../format';

const PER = 15;

function verdict(a: AnalystDetail) {
  if (a.grade === 'N') return 'No calls have finished their 12-month window yet, so this analyst is not rated.';
  if (a.thin_sample) return 'Thin sample: the score leans on the market average until more calls are scored.';
  return { A: 'Top 20% of rated analysts.', B: 'Above the middle of the pack.', C: 'Below the middle. Check the factors before relying on a call.', D: 'Bottom 20%. Past calls have often not played out.' }[a.grade as 'A'];
}

function BiasCell({ title, v, m, max, flagged, fmt, note }: { title: string; v: number | null; m: number | null; max: number; flagged: boolean; fmt: (x: number) => string; note: string }) {
  const p = (x: number) => `${Math.max(0, Math.min(100, (x / max) * 100))}%`;
  return (
    <div>
      <div className="mu" style={{ fontWeight: 600 }}>{title}</div>
      <div className="v num" style={{ color: flagged ? '#C27A00' : undefined }}>{v === null ? '–' : fmt(v)}</div>
      <div className="track">
        <div className="ln" />
        {v !== null && <div className="fill" style={{ width: p(v), background: flagged ? 'var(--amber)' : 'var(--blue)' }} />}
        {m !== null && <div className="mk" style={{ left: p(m) }} title={`Market ${fmt(m)}`} />}
      </div>
      <div className="mu" style={{ fontSize: 12.5, marginTop: 4 }}>{flagged && <b style={{ color: '#C27A00' }}>Flagged. </b>}{m !== null ? `Black tick = market ${fmt(m)}. ` : 'No market benchmark yet. '}{note}</div>
    </div>
  );
}

function Breakdown({ title, note, rows, label, market }: { title: string; note: string; rows: BreakdownRow[]; label: (r: BreakdownRow) => string; market?: number }) {
  return (
    <section className="panel">
      <div className="ptitle">{title} <span>{note}</span></div>
      {rows.map((r) => (
        <div className="hbar" key={label(r)}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label(r)}>{label(r)}</span>
          <span className="b">
            <i style={{ width: `${r.hit_rate ?? 0}%`, background: r.hit_rate === null ? 'transparent' : undefined }} />
            {market !== undefined && <em style={{ left: `${market}%` }} title={`Market ${market}%`} />}
          </span>
          <span className="num">{r.hit_rate === null ? <span className="mu">not scored yet</span> : <><b>{r.hit_rate.toFixed(0)}%</b> <span className="mu">{r.hits}/{r.evaluated}</span></>}</span>
        </div>
      ))}
      {!rows.length && <div className="empty">No calls.</div>}
      <div className="tblnote">Bar = share of scored calls that played out · black tick = market average · {rows.reduce((a, r) => a + r.calls, 0)} calls in total</div>
    </section>
  );
}

export function AnalystPage() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const a = useApi<AnalystDetail>(`/analysts/${id}`);
  const recs = useApi<{ total: number; items: Rec[] }>(`/analysts/${id}/recommendations?limit=${PER}&offset=${(page - 1) * PER}`);
  if (a.error) return <ErrorBox message={a.error} />;
  if (!a.data) return <Loading />;
  const d = a.data, b = d.bias, m = d.market_bias, flags = b?.flags ?? [];

  return (
    <div className="page">
      <div className="hero">
        <div className="idcard">
          <div className="top">
            <Avatar name={d.name} grade={d.grade} />
            <div><h1>{d.name}</h1><div className="firm">{d.broker} · {d.primary_sector ?? 'mixed sectors'}</div>
              {d.brokers.length > 1 && <div className="firm" style={{ fontSize: 12 }}>Also published for: {d.brokers.filter((b) => b !== d.broker).join(', ')}</div>}
            </div>
          </div>
          <div className="big num">{d.score?.toFixed(1) ?? '–'}<small> / 100</small></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <GradeChip g={d.grade} />
            <span style={{ color: '#A9C1E4' }}>{d.rank ? `Rank ${d.rank} of ${d.of}` : ''}</span>
          </div>
          <p style={{ color: '#D6E4F7', fontSize: 13.5, margin: '10px 0 0' }}>{verdict(d)}</p>
          <div className="stats">
            <div><b className="num">{d.n_evaluated}</b><span>scored calls</span></div>
            <div><b className="num">{pct(d.hit_rate, 0)}</b><span>hit rate</span></div>
            <div><b className="num">{pct(d.market_score.hit_rate, 0)}</b><span>market</span></div>
          </div>
        </div>

        <section className="panel">
          <div className="ptitle">Why this score <span>each factor 0–100 × its weight = points</span></div>
          {d.factors?.map((f) => (
            <div className="fac" key={f.key}>
              <div><b>{f.label}</b><small>{f.description}</small></div>
              <div className="bar"><i style={{ width: `${f.value}%` }} /></div>
              <div className="mu num" style={{ textAlign: 'right' }}>{f.value.toFixed(0)} × {Math.round(f.weight * 100)}%</div>
              <b className="num" style={{ textAlign: 'right' }}>+{f.points.toFixed(1)}</b>
            </div>
          ))}
          <div className="fac" style={{ borderTop: '2px solid var(--ink)' }}>
            <b>Confidence score</b><div /><div /><b className="num" style={{ textAlign: 'right', fontSize: 16 }}>{d.score?.toFixed(1)}</b>
          </div>
          {d.strongest && (
            <div className="card-ai">
              <h4>✦ In plain words</h4>
              <p>
                Strongest on <b>{d.strongest.toLowerCase()}</b>, weakest on <b>{d.weakest?.toLowerCase()}</b>.
                {b?.tp_vs_consensus != null && ` Their target-price error is ${b.tp_vs_consensus.toFixed(2)}× the consensus error${b.tp_vs_consensus < 1 ? ', so more accurate than the crowd.' : '.'}`}
                {flags.length ? ` Watch for: ${flags.join(', ').toLowerCase()}.` : ''}
              </p>
            </div>
          )}
        </section>
      </div>

      {b && (
        <section className="panel" style={{ marginTop: 18 }}>
          <div className="ptitle">Analyst Bias Detection <Flags flags={flags} /></div>
          <div className="bias3">
            <BiasCell title="Buy-rating share" v={b.buy_share} m={m.buy_share} max={100} flagged={flags.includes('Optimism bias')} fmt={(x) => `${x.toFixed(1)}%`}
              note={`Buy:sell ${b.buy_to_sell ? `${b.buy_to_sell.toFixed(1)} : 1` : 'no sells'}.`} />
            <BiasCell title="Sell-rating share" v={b.sell_share} m={m.sell_share} max={Math.max(30, b.sell_share * 1.2)} flagged={flags.includes('Sell avoidance')} fmt={(x) => `${x.toFixed(1)}%`}
              note="Sells are rare across brokers." />
            <BiasCell title="Target overshoot on BUYs" v={b.tp_overshoot} m={m.tp_overshoot} max={Math.max(60, (b.tp_overshoot ?? 0) * 1.2)} flagged={flags.includes('Inflated targets')} fmt={(x) => signedPct(x)}
              note="Average gap between BUY targets and the price 12 months later." />
          </div>
        </section>
      )}

      {d.breakdown && (
        <div className="cols2" style={{ marginTop: 18 }}>
          <Breakdown title="Record by sector" note="is this analyst reliable in the sector you are looking at?" rows={d.breakdown.by_sector ?? []}
            label={(r) => r.sector ?? '–'} market={d.market_score.hit_rate} />
          <Breakdown title="Record by report year" note="cohort view: calls grouped by the year they were published" rows={d.breakdown.by_year ?? []}
            label={(r) => String(r.year)} market={d.market_score.hit_rate} />
        </div>
      )}

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="ptitle">Every call · Recommendation Risk Meter <span>trust score per call · click a row to see why and what drives its risk</span></div>
        {recs.error && <ErrorBox message={recs.error} />}
        {recs.data ? <CallsTable items={recs.data.items} show={['stock']} /> : <Loading />}
        {recs.data && recs.data.total > PER && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <Pagination total={Math.ceil(recs.data.total / PER)} value={page} onChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
