import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, type Rating, type StockDetail } from '../api';
import { CallsTable } from '../components/CallsTable';
import { PriceChart, type Range } from '../components/PriceChart';
import { ErrorBox, GRADE_HEX, Loading, Pill, Who } from '../components/ui';
import { day, pct } from '../format';

type Tab = 'ALL' | Rating | 'OPEN';

export function StockPage() {
  const { code } = useParams();
  const s = useApi<StockDetail>(`/stocks/${code}`);
  const px = useApi<{ time: string; value: number }[]>(`/stocks/${code}/prices`);
  const [range, setRange] = useState<Range>('3Y');
  const [tab, setTab] = useState<Tab>('ALL');
  const recs = s.data?.recommendations ?? [];
  const shown = useMemo(
    () => (tab === 'ALL' ? recs : tab === 'OPEN' ? recs.filter((r) => r.status === 'in_window') : recs.filter((r) => r.rating === tab)),
    [recs, tab]
  );
  if (s.error) return <ErrorBox message={s.error} />;
  if (!s.data) return <Loading />;
  const d = s.data, c = d.consensus, last = d.last;
  const chg = last?.change ?? null;
  const tot = c ? c.counts.BUY + c.counts.HOLD + c.counts.SELL : 0;
  const best = d.covering.find((r) => r.grade === 'A' || r.grade === 'B');

  return (
    <main className="ws">
      <section className="main">
        <div className="sym">
          <div className="lg">{d.name.slice(0, 2)}</div>
          <div><h1>{d.name}</h1><div className="sub num">{d.symbol} · Bursa Malaysia{d.sector ? ` · ${d.sector}` : ''}</div></div>
          {last && (
            <div>
              <span className="px num">{last.close.toFixed(3)}</span>{' '}
              {chg !== null && <b className={`num ${chg >= 0 ? 'up' : 'dn'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(3)} ({((chg / (last.close - chg)) * 100).toFixed(2)}%)</b>}
              <div className="sub">close {day(last.date)} · Yahoo Finance</div>
            </div>
          )}
          <div className="tf">
            {(['6M', '1Y', '3Y', 'All'] as Range[]).map((r) => (
              <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="legend">
          {(['A', 'B', 'C', 'D'] as const).map((g) => <span key={g}><i style={{ background: GRADE_HEX[g] }} />Grade {g}</span>)}
          <span>▲ BUY ▼ SELL ● HOLD · dashed line = open target · hover a pin for details</span>
        </div>
        {px.data ? <PriceChart prices={px.data} calls={recs} range={range} /> : <Loading />}
        <div className="tabs" style={{ borderTop: '1px solid var(--line)' }}>
          {([['ALL', '▦ TOTAL CALLS', d.counts.total], ['BUY', '▲ BUY', d.counts.BUY], ['HOLD', '● HOLD', d.counts.HOLD], ['SELL', '▼ SELL', d.counts.SELL], ['OPEN', '⏳ OPEN', d.counts.open]] as [Tab, string, number][]).map(([k, l, n]) => (
            <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              <div className={`t ${k === 'BUY' ? 'up' : k === 'SELL' ? 'dn' : ''}`}>{l}</div>
              <div className="n num">{n}</div>
            </button>
          ))}
        </div>
        <CallsTable items={shown} show={['analyst']} />
      </section>

      <aside className="side">
        {c && (
          <div className="cons">
            <div className="row"><b>Analyst consensus</b><span className="mu">{day(c.from)} – {day(c.to)}</span></div>
            <div className={`label ${c.label.includes('Buy') ? 'up' : c.label.includes('Sell') ? 'dn' : ''}`}>{c.label}</div>
            <div className="bar">
              <span style={{ width: `${(c.counts.BUY / tot) * 100}%`, background: 'var(--up)' }} />
              <span style={{ width: `${(c.counts.HOLD / tot) * 100}%`, background: '#C5CCD6' }} />
              <span style={{ width: `${(c.counts.SELL / tot) * 100}%`, background: 'var(--dn)' }} />
            </div>
            <div className="row num"><span className="up">{c.counts.BUY} Buy</span><span className="mu">{c.counts.HOLD} Hold</span><span className="dn">{c.counts.SELL} Sell</span></div>
            {c.avg_target && last && (
              <div className="row num" style={{ marginTop: 8 }}>
                <span className="mu">Avg target ({c.analysts} analysts)</span>
                <b>RM {c.avg_target.toFixed(2)}</b>
              </div>
            )}
          </div>
        )}
        <div className="ptitle">Analysts covering {d.name} <span>by reliability</span></div>
        {d.covering.map((r) => (
          <Link key={r.analyst_id} to={`/analysts/${r.analyst_id}`} className="an">
            <div style={{ minWidth: 0 }}>
              <Who name={r.analyst} sub={`${r.broker}${r.score ? ` · score ${r.score.toFixed(1)}` : ''}`} grade={r.grade} />
              <div className="chipset" style={{ marginLeft: 44 }}>
                <span title="Their scored calls on this stock">
                  On {d.name}: {r.on_stock?.evaluated ? `${r.on_stock.hits}/${r.on_stock.evaluated} played out` : 'none scored yet'}
                </span>
                {d.sector && (
                  <span title={`Their scored calls on any ${d.sector} stock`}>
                    {d.sector}: {r.in_sector?.hit_rate != null ? `${r.in_sector.hit_rate.toFixed(0)}% of ${r.in_sector.evaluated}` : 'none scored'}
                  </span>
                )}
              </div>
            </div>
            <span className="r"><Pill r={r.rating} /><div className="num">{r.target_price ? `TP ${r.target_price.toFixed(2)}` : day(r.report_date)}</div></span>
          </Link>
        ))}
        {best && (
          <div className="card-ai">
            <h4>✦ Reading this stock</h4>
            <p>
              The most reliable analyst covering it, {best.analyst} (Grade {best.grade}), last said <b>{best.rating}</b>
              {best.target_price ? ` with a RM${best.target_price.toFixed(2)} target` : ''} on {day(best.report_date)}.
              {' '}Of {d.counts.total} calls on this stock, {pct((recs.filter((r) => r.hit).length / Math.max(1, recs.filter((r) => r.status === 'evaluated').length)) * 100, 0)} of the scored ones played out.
            </p>
          </div>
        )}
      </aside>
    </main>
  );
}
