import { useApi, type Meta } from '../api';
import { ErrorBox, GradeChip, Loading } from '../components/ui';
import { day, pct } from '../format';

const RISK_LABELS: Record<string, string> = {
  track: 'Analyst’s stock-specific track record known at the call date (inverse)',
  volatility: 'Stock price volatility, trailing 1 year (percentile)',
  implied_move: 'Size of the promised target move (percentile)',
  confidence: 'The call’s own trust score (inverse)',
  alignment: 'Score alignment: share of other analysts holding the same view (inverse)',
};
const FACTOR_NAMES: Record<string, string> = {
  success: 'Historical success rate', tp_accuracy: 'Target price accuracy', experience: 'Experience depth',
  sector: 'Sector consistency', consensus: 'Consensus consistency',
};
const RISK_COLOR: Record<string, string> = { Low: '#089981', Moderate: '#8DB33A', Elevated: '#F5A524', High: '#F23645' };

function Bars({ rows, max = 100, base }: { rows: { label: React.ReactNode; value: number | null; right: React.ReactNode; color?: string }[]; max?: number; base?: number }) {
  return (
    <div style={{ padding: '6px 0' }}>
      {rows.map((r, i) => (
        <div className="hbar" key={i}>
          <span>{r.label}</span>
          <span className="b">
            <i style={{ width: `${Math.max(0, Math.min(100, ((r.value ?? 0) / max) * 100))}%`, background: r.color }} />
            {base !== undefined && <em style={{ left: `${(base / max) * 100}%` }} title={`Average ${base}`} />}
          </span>
          <span className="num">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

interface FeedbackSummary { responses: number; by_page: { page: string; responses: number; clarity: number | null; useful: number | null }[]; recent_comments: string[] }

export function MethodPage() {
  const meta = useApi<Meta>('/meta');
  const fb = useApi<FeedbackSummary>('/feedback/summary');
  if (meta.error) return <ErrorBox message={meta.error} />;
  if (!meta.data) return <Loading />;
  const m = meta.data;
  const v = m.validation;
  const p = m.pipeline;
  const base = v.base_rate_test !== undefined ? +(v.base_rate_test * 100).toFixed(1) : undefined;
  const ok = v.status === 'ok';

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>How it’s scored, and how well it works</h1>
          <p>CRISP-DM Modelling and Evaluation. Every number on this page is produced by the backend pipeline from the cleaned dataset and Yahoo Finance prices.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href="/api/export/recommendations.csv">⬇ All calls (CSV)</a>
          <a className="btn" href="/api/export/analysts.csv">⬇ Analyst scores (CSV)</a>
        </div>
      </div>

      <div className="cols2">
        <section className="panel">
          <div className="ptitle">Module 1 · Explainable Confidence Score <span>weighted sum, every factor 0–100</span></div>
          <div className="tbl"><table className="wrap"><tbody>
            {m.weights.map((w) => (
              <tr key={w.key}><td style={{ whiteSpace: 'normal' }}><b>{w.label}</b><div className="mini">{w.description}</div></td>
                <td className="num" style={{ textAlign: 'right' }}><b>{Math.round(w.weight * 100)}%</b></td></tr>
            ))}
          </tbody></table></div>
          <div className="pad mini">
            <p><b>Analyst score</b>: the factors over all of an analyst’s scored calls; small records are shrunk toward the market rate. Grades: top 20% A, next 30% B, next 30% C, bottom 20% D.</p>
            <p><b>Trust score of each call</b>: the same five factors and weights, measured only from what was known on the call date (earlier calls that had already reached 12 months, and other analysts’ views in the previous 90 days).</p>
          </div>
        </section>

        <section className="panel">
          <div className="ptitle">Module 3 · Recommendation Risk Meter <span>graded, not pass / fail</span></div>
          <div className="tbl"><table className="wrap"><tbody>
            {Object.entries(m.risk_weights).map(([k, w]) => (
              <tr key={k}><td style={{ whiteSpace: 'normal' }}>{RISK_LABELS[k] ?? k}</td><td className="num" style={{ textAlign: 'right' }}><b>{Math.round(w * 100)}%</b></td></tr>
            ))}
          </tbody></table></div>
          <div className="pad mini">
            <p>Levels: {m.risk_levels.map((l, i) => `${l.label} ${i === m.risk_levels.length - 1 ? `≥ ${m.risk_levels[i - 1].below}` : `< ${l.below}`}`).join(' · ')}. Missing parts are left out and the other weights re-scaled.</p>
          </div>
        </section>

        <section className="panel">
          <div className="ptitle">Outcome rules <span>12-month window</span></div>
          <div className="pad mini">
            <p>BUY is a hit if the price is higher 12 months after the report; SELL if it is lower; HOLD if it moved less than ±10%.</p>
            <p>Target price accuracy = |price after 12 months − target| ÷ price at the call (capped at 100%).</p>
            <p>Targets are put on the same basis as Yahoo prices using recorded stock splits. A delisted or suspended stock is scored at its last traded price. Calls younger than 12 months stay “in window”.</p>
          </div>
        </section>

        <section className="panel">
          <div className="ptitle">Module 2 · Analyst Bias Detection <span>compared with the market</span></div>
          <div className="pad mini">
            <p><b>Optimism bias</b>: buy share more than 10 points above the market’s.</p>
            <p><b>Sell avoidance</b>: sell share under half the market’s.</p>
            <p><b>Inflated targets</b>: the average deviation of BUY targets from the realised 12-month price is 8+ points above the market’s.</p>
            {m.market_bias && <p>Market today: {pct(m.market_bias.buy_share)} BUY · {pct(m.market_bias.sell_share)} SELL · {m.market_bias.buy_to_sell?.toFixed(1)} : 1 · average BUY target overshoot {pct(m.market_bias.tp_overshoot)}.</p>}
          </div>
        </section>
      </div>

      <h2 style={{ margin: '28px 0 6px', fontSize: 22 }}>Evaluation against real 12-month outcomes</h2>
      {!ok ? (
        <div className="panel pad">{v.status === 'not run' ? 'Run `flask --app wsgi compute` to produce the evaluation.' : String(v.reason ?? v.status)}</div>
      ) : (
        <>
          <p className="mu" style={{ marginTop: 0 }}>
            Time-based test: everything that is learnt (model weights, grades, bias flags) uses only calls made before {day(v.split_date)}; it is then
            checked on the {v.n_test?.toLocaleString()} calls made after that date ({v.n_train?.toLocaleString()} before). Base hit rate in the test period: {pct(base)}.
          </p>
          <div className="kv panel" style={{ marginBottom: 18 }}>
            <div><b className="num">{v.weighted_auc?.toFixed(3)}</b><span>Trust score AUC (chosen model)</span></div>
            <div><b className="num">{v.logit_auc?.toFixed(3)}</b><span>Logistic regression AUC</span></div>
            <div><b className="num">{v.risk_meter_auc?.toFixed(3)}</b><span>Risk meter AUC</span></div>
            <div><b className="num">{v.n_test?.toLocaleString()}</b><span>test calls</span></div>
          </div>

          <div className="cols2">
            <section className="panel">
              <div className="ptitle">Model comparison <span>same five factors · {v.model_calls?.n_test.toLocaleString()} test calls with history</span></div>
              <div className="tbl"><table className="wrap">
                <thead><tr><th>MODEL</th><th>AUC</th><th>ACCURACY</th><th>BRIER</th><th>EXPLAINABLE TO AN INVESTOR</th></tr></thead>
                <tbody>
                  {v.model_comparison?.map((r) => (
                    <tr key={r.key} style={r.key === 'weighted' ? { background: 'var(--sky)' } : undefined}>
                      <td><b>{r.model}</b></td><td className="num">{r.auc?.toFixed(3)}</td><td className="num">{r.accuracy?.toFixed(3) ?? '–'}</td>
                      <td className="num">{r.brier?.toFixed(3) ?? '–'}</td><td style={{ whiteSpace: 'normal' }}>{r.explainable}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="pad mini">
                <p>Calls whose analyst already had {v.model_calls?.min_history ?? 1}+ scored call on the call date ({v.model_calls?.n_train.toLocaleString()} train / {v.model_calls?.n_test.toLocaleString()} test); before that every factor is only the market default. AUC 0.5 = no better than chance. Best AUC: {v.comparison_summary?.best_auc_model} ({v.comparison_summary && v.comparison_summary.auc_gap_vs_best > 0 ? `${v.comparison_summary.auc_gap_vs_best.toFixed(3)} above` : 'equal to'} the weighted score).
                  The weighted score is kept because its explanation on screen is exact, which the black-box models cannot give (Rudin, 2019).</p>
              </div>
            </section>

            <section className="panel">
              <div className="ptitle">Factor weights vs logistic regression <span>do both approaches agree?</span></div>
              <div className="tbl"><table className="wrap">
                <thead><tr><th>FACTOR</th><th>WEIGHT</th><th>LOGIT COEF.</th><th>COEF. SHARE</th><th>RF IMPORTANCE</th><th>DIRECTION</th></tr></thead>
                <tbody>
                  {v.weights_vs_coef?.map((r) => (
                    <tr key={r.factor}>
                      <td><b>{FACTOR_NAMES[r.factor] ?? r.factor}</b></td>
                      <td className="num">{Math.round(r.weight * 100)}%</td>
                      <td className="num">{r.coefficient.toFixed(3)}</td>
                      <td className="num">{(r.coef_share * 100).toFixed(0)}%</td>
                      <td className="num">{(r.rf_importance * 100).toFixed(0)}%</td>
                      <td>{r.same_direction ? <span className="ok" title="positive, same as the weight">✓ +</span> : <span className="no" title="negative, opposite to the weight">✗ −</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              <div className="pad mini"><p>Coefficients are standardised (one standard deviation of each factor). “Coef. share” = |coefficient| ÷ the sum of all |coefficients|, to put it on the same scale as the weights.</p></div>
            </section>

            <section className="panel">
              <div className="ptitle">Module 1 check: does a higher trust score mean more calls played out? <span>test calls with history</span></div>
              <Bars base={base} rows={(v.confidence_test?.by_quintile ?? []).map((q) => ({
                label: `Quintile ${q.quintile} (avg ${q.avg_score.toFixed(0)})`, value: q.hit_rate, right: <><b>{pct(q.hit_rate)}</b> <span className="mu">{q.calls}</span></>,
              }))} />
              <div className="ptitle" style={{ borderTop: '1px solid var(--line)' }}>By analyst grade <span>grades from pre-split data only</span></div>
              <Bars base={base} rows={(v.confidence_test?.by_grade ?? []).map((g) => ({
                label: <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><GradeChip g={g.grade} /> <span className="mu">{g.analysts} analysts</span></span>,
                value: g.hit_rate, right: <><b>{pct(g.hit_rate)}</b> <span className="mu">{g.calls}</span></>,
              }))} />
              <div className="tblnote">Bar = hit rate of the test calls · black tick = base hit rate · right = calls</div>
            </section>

            <section className="panel">
              <div className="ptitle">Module 3 check: hit rate by risk level <span>test calls</span></div>
              <Bars base={base} rows={(v.risk_test ?? []).map((r) => ({
                label: <b style={{ color: RISK_COLOR[r.level] }}>{r.level}</b>, value: r.hit_rate, color: RISK_COLOR[r.level],
                right: <><b>{pct(r.hit_rate)}</b> <span className="mu">{r.calls}</span></>,
              }))} />
              <div className="pad mini"><p>A useful risk meter shows fewer calls playing out as the level rises. Risk meter AUC {v.risk_meter_auc?.toFixed(3)}.</p></div>

              <div className="ptitle" style={{ borderTop: '1px solid var(--line)' }}>Module 2 check: do flagged analysts keep the behaviour? <span>flags from pre-split calls, behaviour after</span></div>
              <div className="tbl"><table className="wrap">
                <thead><tr><th>FLAG</th><th>GROUP</th><th>ANALYSTS</th><th>BUY SHARE</th><th>SELL SHARE</th><th>BUY OVERSHOOT</th><th>BUY HIT RATE</th></tr></thead>
                <tbody>
                  {v.bias_test?.flatMap((b) => [b.flagged, b.not_flagged].map((g, i) => (
                    <tr key={b.flag + g.group}>
                      <td>{i === 0 ? <><b>{b.flag}</b><div className="mini">{b.persists === null ? '' : b.persists ? <span className="ok">✓ persists</span> : <span className="no">✗ does not persist</span>}</div></> : ''}</td>
                      <td className="mu">{g.group}</td><td className="num">{g.analysts}</td>
                      <td className="num" style={{ fontWeight: b.measure === 'buy_share' ? 800 : undefined }}>{pct(g.buy_share)}</td>
                      <td className="num" style={{ fontWeight: b.measure === 'sell_share' ? 800 : undefined }}>{pct(g.sell_share)}</td>
                      <td className="num" style={{ fontWeight: b.measure === 'avg_overshoot' ? 800 : undefined }}>{pct(g.avg_overshoot)}</td>
                      <td className="num">{pct(g.buy_hit_rate)}</td>
                    </tr>
                  )))}
                </tbody>
              </table></div>
              <div className="tblnote">Bold = the behaviour each flag measures. “Persists” = the flagged group still shows more of it after the split date.</div>
            </section>

            {v.lime_test && (
              <section className="panel">
                <div className="ptitle">Explainability: transparent factors vs LIME <span>{v.lime_test.cases} test calls · {v.lime_test.model}</span></div>
                <div className="tbl"><table className="wrap">
                  <thead><tr><th>CHECK</th><th>TRANSPARENT SCORE</th><th>LIME ON BLACK BOX</th></tr></thead>
                  <tbody>
                    <tr><td>Fidelity (R² of the explanation)</td><td className="num ok">{v.lime_test.transparent_fidelity_r2.toFixed(2)}</td><td className="num">{v.lime_test.lime_fidelity_r2.toFixed(2)}</td></tr>
                    <tr><td>Same top factor when explained twice</td><td className="num ok">{v.lime_test.transparent_stable_pct}%</td><td className="num">{v.lime_test.lime_top_factor_stable_pct}%</td></tr>
                    <tr><td>Top factor agrees with the transparent one</td><td className="num">–</td><td className="num">{v.lime_test.lime_agrees_with_transparent_pct}%</td></tr>
                  </tbody>
                </table></div>
                <div className="pad mini"><p>LIME (Ribeiro et al., 2016) fits a local linear model around each call. {v.lime_test.note}</p></div>
              </section>
            )}

            {v.min_calls && (
              <section className="panel">
                <div className="ptitle">How many scored calls make a score meaningful? <span>“thin sample” below {v.min_calls.threshold_used}</span></div>
                <div className="tbl"><table className="wrap">
                  <thead><tr><th>CALLS (n)</th><th>95% CI OF A HIT RATE</th><th>RELIABILITY</th><th>ANALYSTS WITH 2n</th></tr></thead>
                  <tbody>
                    {v.min_calls.rows.map((r) => (
                      <tr key={r.n} style={r.n === v.min_calls!.threshold_used ? { background: 'var(--sky)' } : undefined}>
                        <td className="num"><b>{r.n}</b></td><td className="num">± {r.ci_half_width_pts} pts</td>
                        <td className="num">{r.reliability?.toFixed(2) ?? '–'}</td><td className="num">{r.analysts_with_2n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <div className="pad mini"><p>Reliability = split-half correlation of two disjoint sets of n calls (Spearman–Brown corrected). Rule: {v.min_calls.rule} → <b>{v.min_calls.suggested ?? '–'}</b> calls. Below that, the score leans on the market average (shrinkage k = 20) and shows a “Thin sample” tag.</p></div>
              </section>
            )}
          </div>

          {v.cohorts && (
            <section className="panel" style={{ marginTop: 18 }}>
              <div className="ptitle">Cohorts by report year <span>IR 3.5.9</span></div>
              <div className="tbl"><table>
                <thead><tr><th>YEAR</th><th>CALLS</th><th>SCORED</th><th>HIT RATE</th><th>BUY SHARE</th><th>SELL SHARE</th><th>AVG TRUST</th></tr></thead>
                <tbody>
                  {v.cohorts.map((c) => (
                    <tr key={c.year}><td><b>{c.year}</b></td><td className="num">{c.calls.toLocaleString()}</td><td className="num">{c.evaluated.toLocaleString()}</td>
                      <td className="num">{pct(c.hit_rate)}</td><td className="num">{pct(c.buy_share)}</td><td className="num">{pct(c.sell_share)}</td><td className="num">{c.avg_trust?.toFixed(1) ?? '–'}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          )}
        </>
      )}

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="ptitle">Usability feedback from visitors <span>the “Rate this page” button, 1–5</span></div>
        {fb.data && fb.data.responses > 0 ? (
          <div className="tbl"><table className="wrap">
            <thead><tr><th>PAGE</th><th>RESPONSES</th><th>EASY TO UNDERSTAND</th><th>HELPS DECIDE WHOM TO TRUST</th></tr></thead>
            <tbody>{fb.data.by_page.map((r) => (
              <tr key={r.page}><td><b>{r.page}</b></td><td className="num">{r.responses}</td><td className="num">{r.clarity?.toFixed(2) ?? '–'}</td><td className="num">{r.useful?.toFixed(2) ?? '–'}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="pad mini">No ratings yet. Visitors can rate any page with the button at the bottom right.</div>}
      </section>

      {p?.computed_at && (
        <p className="mini" style={{ marginTop: 14 }}>
          Pipeline last run {p.computed_at.replace('T', ' ')} UTC · prices up to {day(p.as_of)} · {Object.entries(p.status ?? {}).map(([k, n]) => `${n.toLocaleString()} ${k.replace('_', ' ')}`).join(' · ')} ·
          refresh with <code>flask --app wsgi refresh</code>
        </p>
      )}
    </div>
  );
}
