import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, type Insights, type Rating } from '../api';
import { CallsTable } from '../components/CallsTable';
import { ErrorBox, GradeChip, Loading, Pill, Who } from '../components/ui';
import { day, pct } from '../format';

const RANGES = [{ d: 1, l: 'Latest day' }, { d: 7, l: '7 days' }, { d: 30, l: '30 days' }];

export function InsightsPage() {
  const [days, setDays] = useState(1);
  const [filter, setFilter] = useState<Rating | 'ALL'>('ALL');
  const { data, error } = useApi<Insights>(`/insights?days=${days}`);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const calls = filter === 'ALL' ? data.calls : data.calls.filter((c) => c.rating === filter);

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Daily Market Insights</h1>
          <p>Bursa Malaysia · broker research calls, each checked against what the price did 12 months later</p>
        </div>
        <div className="tf" style={{ marginLeft: 0 }}>
          {RANGES.map((r) => (
            <button key={r.d} className={days === r.d ? 'on' : ''} onClick={() => setDays(r.d)}>{r.l}</button>
          ))}
        </div>
      </div>

      <div className="grid2">
        <div style={{ display: 'grid', gap: 18 }}>
          <section className="panel">
            <div className="ptitle">
              Calls of {days === 1 ? 'the day' : `the last ${days} days`}
              <span>{days === 1 ? day(data.date) : `${day(data.since)} – ${day(data.date)}`} · latest data in the dataset</span>
            </div>
            <div className="tabs">
              {(['ALL', 'BUY', 'HOLD', 'SELL'] as const).map((k) => (
                <button key={k} className={`tab ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                  <div className={`t ${k === 'BUY' ? 'up' : k === 'SELL' ? 'dn' : ''}`}>
                    {k === 'ALL' ? '▦ TOTAL CALLS' : k === 'BUY' ? '▲ BUY' : k === 'SELL' ? '▼ SELL' : '● HOLD'}
                  </div>
                  <div className="n num">{k === 'ALL' ? data.counts.total : data.counts[k]}</div>
                </button>
              ))}
            </div>
            <CallsTable items={calls} empty="No calls of this type in this period." />
          </section>

          <section className="panel">
            <div className="ptitle">Top experts <span>highest Explainable Confidence Score · ≥30 scored calls</span></div>
            <div className="tbl">
              <table>
                <thead><tr><th>#</th><th>ANALYST</th><th>MAIN SECTOR</th><th>SCORED CALLS</th><th>HIT RATE</th><th>SCORE</th></tr></thead>
                <tbody>
                  {data.top.map((a, i) => (
                    <tr key={a.id}>
                      <td className="mu num">{i + 1}</td>
                      <td><Link to={`/analysts/${a.id}`}><Who name={a.name} sub={a.broker} grade={a.grade} /></Link></td>
                      <td>{a.sector ?? '–'}</td>
                      <td className="num">{a.n_evaluated}</td>
                      <td className="num">{pct(a.hit_rate)} <span className="mu">vs {pct(data.market.hit_rate)} mkt</span></td>
                      <td><span className="scorebar"><b className="num">{a.score.toFixed(1)}</b><span className="b"><i style={{ width: `${a.score}%` }} /></span><GradeChip g={a.grade} /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '10px 16px' }}><Link to="/analysts" className="btn">See full rankings</Link></div>
          </section>
        </div>

        <aside className="panel" style={{ overflow: 'hidden' }}>
          <div className="ptitle">Latest rating changes</div>
          <div className="feed">
            {data.changes.map((c) => (
              <Link key={c.id} to={`/stocks/${c.code}`}>
                <div className="h"><span>{c.analyst} · {c.broker}</span><span>{day(c.report_date)}</span></div>
                <p>
                  <span className={c.direction === 'Upgrade' ? 'up' : 'dn'}>{c.direction === 'Upgrade' ? '▲' : '▼'} {c.direction}</span>{' '}
                  {c.stock}: <Pill r={c.from!} /> → <Pill r={c.rating} />
                  {c.target_price ? <span className="mu num"> · TP RM{c.target_price.toFixed(2)}</span> : null}
                </p>
              </Link>
            ))}
            {!data.changes.length && <div className="empty">No recent rating changes.</div>}
          </div>
          <div className="card-ai">
            <h4>✦ How to read this</h4>
            <p>
              Across all brokers, {pct(data.market.buy_share)} of calls are BUY and only {pct(data.market.sell_share)} are SELL
              (about {data.market.buy_to_sell?.toFixed(0)} : 1). A BUY from a Grade A analyst carries more weight than one from a Grade D analyst.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
