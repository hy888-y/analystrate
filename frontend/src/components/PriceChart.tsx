/* TradingView lightweight-charts (Apache-2.0, github.com/tradingview/lightweight-charts):
   price area + every analyst call pinned on the chart + dashed lines for open targets. */
import { useEffect, useRef, useState } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import type { Rec } from '../api';
import { signedPct } from '../format';
import { GRADE_RAW } from './ui';
import { snapToTradingDay } from '../utils/snap';

export type Range = '6M' | '1Y' | '3Y' | 'All';
const DAYS: Record<Range, number> = { '6M': 183, '1Y': 365, '3Y': 1095, All: 99999 };

export function PriceChart({ prices, calls, range }: { prices: { time: string; value: number }[]; calls: Rec[]; range: Range }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; calls: Rec[] } | null>(null);
  const dark = useComputedColorScheme('light') === 'dark';

  useEffect(() => {
    if (!box.current || !prices.length) return;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: dark ? '#111A2B' : '#FFFFFF' }, textColor: dark ? '#8B9AB3' : '#64748B', fontFamily: 'Onest' },
      grid: { vertLines: { color: dark ? '#1A2538' : '#F1F4F8' }, horzLines: { color: dark ? '#1A2538' : '#F1F4F8' } },
      rightPriceScale: { borderColor: dark ? '#22304A' : '#E3E8EF' },
      timeScale: { borderColor: dark ? '#22304A' : '#E3E8EF' },
      crosshair: { mode: 0 },
    });
    const series = chart.addAreaSeries({
      lineColor: '#1F6FEB', topColor: 'rgba(31,111,235,.28)', bottomColor: 'rgba(31,111,235,0)', lineWidth: 2,
      priceFormat: { type: 'price', precision: 3, minMove: 0.005 },
    });
    series.setData(prices.map((p) => ({ time: p.time as Time, value: p.value })));

    // snap each call to the first trading day on/after its report date.
    // Returns undefined when:
    //   - the report date is before the first available price date (would snap to wrong first day)
    //   - the report date is after the last available price date (beyond history)
    // Both cases are excluded from chart markers rather than being misplaced.
    const days = prices.map((p) => p.time);
    const byDay = new Map<string, Rec[]>();
    calls.forEach((c) => {
      const t = snapToTradingDay(c.report_date, days);
      if (t === undefined) return;   // skip calls outside the price history range
      byDay.set(t, [...(byDay.get(t) ?? []), c]);
    });
    series.setMarkers(
      [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([t, cs]) =>
        cs.map((c) => ({
          time: t as Time,
          position: c.rating === 'SELL' ? ('aboveBar' as const) : ('belowBar' as const),
          color: GRADE_RAW[c.grade] ?? GRADE_RAW.N,
          shape: c.rating === 'BUY' ? ('arrowUp' as const) : c.rating === 'SELL' ? ('arrowDown' as const) : ('circle' as const),
          text: cs.length > 1 ? '' : c.analyst.split(' ')[0],
        })))
    );

    // dashed target line for each analyst's latest open call
    const seen = new Set<number>();
    [...calls].sort((a, b) => (a.report_date < b.report_date ? 1 : -1)).forEach((c) => {
      if (seen.has(c.analyst_id)) return;
      seen.add(c.analyst_id);
      if (c.status !== 'in_window' || !c.target_chart) return;
      series.createPriceLine({ price: c.target_chart, color: GRADE_RAW[c.grade] ?? GRADE_RAW.N, lineStyle: 2, lineWidth: 1,
        axisLabelVisible: true, title: `${c.analyst.split(' ')[0]} TP` });
    });

    chart.subscribeCrosshairMove((p) => {
      const cs = p.time ? byDay.get(p.time as string) : undefined;
      if (!cs || !p.point) return setTip(null);
      setTip({ x: p.point.x, y: p.point.y, calls: cs });
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [prices, calls, dark]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !prices.length) return;
    const end = new Date(prices[prices.length - 1].time);
    const start = new Date(end.getTime() - DAYS[range] * 864e5);
    if (range === 'All') chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: start.toISOString().slice(0, 10) as Time, to: prices[prices.length - 1].time as Time });
  }, [range, prices, dark]);

  const w = box.current?.clientWidth ?? 800;
  return (
    <div className="chartbox" ref={box}>
      {!prices.length && <div className="empty">No Yahoo Finance price history for this stock.</div>}
      {tip && (
        <div className="ctip" style={{ left: Math.min(tip.x + 14, w - 262), top: Math.max(8, tip.y - 110) }}>
          {tip.calls.slice(0, 3).map((c) => {
            const up = c.entry_price && c.target_price ? (c.target_price / c.entry_price - 1) * 100 : null;
            return (
              <div key={c.id} style={{ marginBottom: 6 }}>
                <b>{c.analyst}</b> <span className={`pill ${c.rating}`}>{c.rating}</span>
                <div className="mu">{c.broker} · Grade {c.grade}{c.score ? ` (${c.score.toFixed(1)})` : ''}</div>
                <div>Target RM{c.target_price?.toFixed(2) ?? '–'} {up !== null && <span className={up >= 0 ? 'up' : 'dn'}>({signedPct(up)})</span>}</div>
                <div>
                  {c.status === 'in_window' ? <span className="mu">Still inside its 12-month window</span>
                    : c.status === 'evaluated' ? <>12 months later: <b className={c.hit ? 'up' : 'dn'}>{c.hit ? 'played out' : "didn't play out"}</b> ({signedPct((c.return_12m ?? 0) * 100)})</>
                      : <span className="mu">No price data</span>}
                </div>
              </div>
            );
          })}
          {tip.calls.length > 3 && <div className="mu">+{tip.calls.length - 3} more calls this day</div>}
        </div>
      )}
    </div>
  );
}
