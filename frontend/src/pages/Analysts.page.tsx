import { useState } from 'react';
import { Pagination, Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi, type AnalystRow, type Meta, type Summary } from '../api';
import { ErrorBox, Flags, GradeChip, Loading, Who } from '../components/ui';
import { pct } from '../format';

const PER = 25;

export function AnalystsPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 250);
  const [sector, setSector] = useState<string | null>(null);
  const [sp] = useSearchParams();
  const [broker, setBroker] = useState<string | null>(sp.get('broker'));
  const [min, setMin] = useState('30');
  const [sort, setSort] = useState('score');
  const [page, setPage] = useState(1);
  const meta = useApi<Meta>('/meta');
  const sum = useApi<Summary>('/summary');
  const p = new URLSearchParams({ sort, min_calls: min });
  if (dq) p.set('q', dq);
  if (sector) p.set('sector', sector);
  if (broker) p.set('broker', broker);
  const list = useApi<{ count: number; items: AnalystRow[] }>(`/analysts?${p}`);
  const key = p.toString();
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) { setLastKey(key); setPage(1); }
  const s = sum.data;

  return (
    <div className="page">
      <div className="ph">
        <div><h1>Analyst rankings</h1><p>Ranked by Explainable Confidence Score: how often their calls actually played out, and why.</p></div>
      </div>
      {s && (
        <div className="stat4">
          <div><b className="num">{s.analysts}</b><span>analysts tracked across {s.brokers} brokers</span></div>
          <div><b className="num">{(s.pipeline.status?.evaluated ?? 0).toLocaleString()}</b><span>calls scored after 12 months</span></div>
          <div><b className="num">{pct(s.market_score.hit_rate)}</b><span>market hit rate</span></div>
          <div><b className="num">{s.market_bias.buy_to_sell?.toFixed(1)} : 1</b><span>buy-to-sell ratio</span></div>
        </div>
      )}
      <section className="panel">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: 14, borderBottom: '1px solid var(--line)', alignItems: 'center' }}>
          <div className="searchbox" style={{ flex: '1 1 240px' }}>
            <span className="ic">⌕</span>
            <input id="an-search" placeholder="Filter by analyst or broker" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
          </div>
          <Select id="sector" placeholder="All sectors" data={meta.data?.sectors ?? []} value={sector} onChange={setSector} clearable w={190} />
          <Select id="broker" placeholder="All brokers" data={meta.data?.brokers ?? []} value={broker} onChange={setBroker} clearable searchable w={190} />
          <div className="tf" style={{ marginLeft: 0 }}>
            {[['0', 'All'], ['30', '≥30 scored'], ['100', '≥100']].map(([v, l]) => (
              <button key={v} className={min === v ? 'on' : ''} onClick={() => setMin(v)}>{l}</button>
            ))}
          </div>
        </div>
        {list.error && <ErrorBox message={list.error} />}
        {!list.data ? <Loading /> : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {[['name', 'ANALYST'], ['', 'MAIN SECTOR'], ['n_evaluated', 'SCORED CALLS'], ['hit_rate', 'HIT RATE'], ['score', 'CONFIDENCE SCORE'], ['', 'BIAS FLAGS']].map(([k, l]) => (
                    <th key={l} style={{ cursor: k ? 'pointer' : 'default', color: sort === k ? 'var(--blue)' : undefined }} onClick={() => k && setSort(k)}>
                      {l}{sort === k ? ' ↓' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.items.slice((page - 1) * PER, page * PER).map((a, i) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/analysts/${a.id}`)}>
                    <td className="mu num">{(page - 1) * PER + i + 1}</td>
                    <td><Who name={a.name} sub={a.broker} grade={a.grade} /></td>
                    <td>{a.primary_sector ?? '–'}</td>
                    <td className="num">{a.n_evaluated}</td>
                    <td className="num">{pct(a.hit_rate)}</td>
                    <td><span className="scorebar"><b className="num">{a.score?.toFixed(1) ?? '–'}</b><span className="b"><i style={{ width: `${a.score ?? 0}%` }} /></span><GradeChip g={a.grade} /></span></td>
                    <td><Flags flags={a.flags} thin={a.thin_sample} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.data.count && <div className="empty">No analysts match. Clear the filters or choose “All”.</div>}
          </div>
        )}
        {list.data && list.data.count > PER && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14 }}>
            <span className="mu">{list.data.count} analysts</span>
            <Pagination total={Math.ceil(list.data.count / PER)} value={page} onChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
