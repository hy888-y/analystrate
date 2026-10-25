import { useState } from 'react';
import { Pagination } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Rec } from '../api';
import { CallsTable } from '../components/CallsTable';
import { QUICK } from '../components/Shell';
import { ErrorBox, Loading } from '../components/ui';

export function StocksPage() {
  const [q, setQ] = useState('');
  const [dq] = useDebouncedValue(q, 250);
  const list = useApi<{ code: string; name: string; sector: string | null; calls: number }[]>(`/stocks?q=${encodeURIComponent(dq)}`);
  return (
    <div className="page">
      <div className="ph"><div><h1>Stocks</h1><p>Open a stock to see every analyst call pinned on its price chart.</p></div></div>
      <div className="searchbox" style={{ maxWidth: 420, marginBottom: 16 }}>
        <span className="ic">⌕</span>
        <input id="stock-filter" placeholder="Filter by name or Bursa code, e.g. 1155" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      </div>
      {list.error && <ErrorBox message={list.error} />}
      {!list.data ? <Loading /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12 }}>
          {list.data.map((s) => (
            <Link key={s.code} to={`/stocks/${s.code}`} className="panel" style={{ padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="av" style={{ background: 'var(--sky)', color: 'var(--blue)' }}>{s.name.slice(0, 2)}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <b style={{ display: 'block' }}>{s.name}</b>
                <span className="mu num">{s.code}.KL{s.sector ? ` · ${s.sector}` : ''}</span>
              </span>
              <span className="mu num">{s.calls} calls</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const PER = 50;

export function CallsPage() {
  const [sp] = useSearchParams();
  const [page, setPage] = useState(1);
  const qs = sp.toString();
  const [lastQs, setLastQs] = useState(qs);
  if (qs !== lastQs) { setLastQs(qs); setPage(1); }
  const view = QUICK.find((c) => c.q === qs);
  const list = useApi<{ total: number; items: Rec[] }>(`/recommendations?${qs}${qs ? '&' : ''}limit=${PER}&offset=${(page - 1) * PER}`);
  return (
    <div className="page">
      <div className="ph">
        <div><h1>{view?.label ?? 'All calls'}</h1><p>{list.data ? `${list.data.total.toLocaleString()} calls` : '…'} · pick a quick view in the blue bar to filter</p></div>
      </div>
      <section className="panel">
        {list.error && <ErrorBox message={list.error} />}
        {list.data ? <CallsTable items={list.data.items} /> : <Loading />}
        {list.data && list.data.total > PER && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <Pagination total={Math.ceil(list.data.total / PER)} value={page} onChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}
