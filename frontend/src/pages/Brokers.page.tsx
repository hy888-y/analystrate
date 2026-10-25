import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi, type BiasStats, type BrokerRow } from '../api';
import { Trust } from '../components/CallsTable';
import { ErrorBox, Loading } from '../components/ui';
import { pct } from '../format';

type Key = 'calls' | 'hit_rate' | 'buy_share' | 'sell_share' | 'avg_trust';

/** Institution-level view (IR Table 3: the broker variable is "used for institution-level analysis"). */
export function BrokersPage() {
  const nav = useNavigate();
  const [sort, setSort] = useState<Key>('calls');
  const { data, error } = useApi<{ items: BrokerRow[]; market: BiasStats & { hit_rate?: number } }>('/brokers');
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const rows = [...data.items].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  const m = data.market;
  const head: [Key | '', string][] = [['', 'BROKER'], ['calls', 'CALLS'], ['', 'ANALYSTS'], ['hit_rate', 'HIT RATE'], ['buy_share', 'BUY / HOLD / SELL'], ['sell_share', 'SELL SHARE'], ['', 'BUY : SELL'], ['avg_trust', 'AVG TRUST']];

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Brokers</h1>
          <p>The 17 investment banks and securities firms behind the calls: how often their calls played out and how one-sided their ratings are.</p>
        </div>
      </div>
      <div className="stat4">
        <div><b className="num">{data.items.length}</b><span>brokers</span></div>
        <div><b className="num">{pct(m.hit_rate)}</b><span>market hit rate</span></div>
        <div><b className="num">{pct(m.buy_share)}</b><span>of all calls are BUY</span></div>
        <div><b className="num">{m.buy_to_sell?.toFixed(1)} : 1</b><span>market buy-to-sell ratio</span></div>
      </div>
      <section className="panel">
        <div className="tbl">
          <table>
            <thead>
              <tr>
                {head.map(([k, l]) => (
                  <th key={l} style={{ cursor: k ? 'pointer' : 'default', color: sort === k ? 'var(--blue)' : undefined }} onClick={() => k && setSort(k)}>
                    {l}{sort === k ? ' ↓' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="click" onClick={() => nav(`/analysts?broker=${encodeURIComponent(b.name)}`)}>
                  <td><b>{b.name}</b></td>
                  <td className="num">{b.calls.toLocaleString()}</td>
                  <td className="num">{b.analysts}</td>
                  <td className="num">
                    {pct(b.hit_rate)}{' '}
                    {b.hit_rate !== null && m.hit_rate !== undefined && (
                      <span className={b.hit_rate >= m.hit_rate ? 'up' : 'dn'}>({b.hit_rate >= m.hit_rate ? '+' : ''}{(b.hit_rate - m.hit_rate).toFixed(1)})</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', height: 9, width: 160, borderRadius: 5, overflow: 'hidden', background: 'var(--line)' }}>
                      <span style={{ width: `${b.buy_share}%`, background: 'var(--up)' }} />
                      <span style={{ width: `${b.hold_share}%`, background: '#C5CCD6' }} />
                      <span style={{ width: `${b.sell_share}%`, background: 'var(--dn)' }} />
                    </div>
                  </td>
                  <td className="num">{pct(b.sell_share)}</td>
                  <td className="num">{b.buy_to_sell ? `${b.buy_to_sell.toFixed(1)} : 1` : 'no sells'}</td>
                  <td><Trust v={b.avg_trust} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tblnote">Hit rate in brackets = points above or below the market. Click a broker to see its analysts.</div>
      </section>
    </div>
  );
}
