import { useEffect, useState } from 'react';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'N';
export type Rating = 'BUY' | 'HOLD' | 'SELL';
export type RiskLevel = 'Low' | 'Moderate' | 'Elevated' | 'High';

export interface AnalystRow {
  id: number;
  name: string;
  broker: string;
  brokers: string[];
  primary_sector: string | null;
  n_calls: number;
  n_evaluated: number;
  hit_rate: number | null;
  score: number | null;
  grade: Grade;
  thin_sample: boolean;
  flags: string[];
}

export interface Factor {
  key: string;
  label: string;
  description: string;
  value: number;
  weight: number;
  points: number;
}

export interface BiasStats {
  buy_share: number;
  hold_share: number;
  sell_share: number;
  buy_to_sell: number | null;
  tp_overshoot: number | null;
  tp_vs_consensus?: number | null;
  flags?: string[];
}

export interface BreakdownRow {
  sector?: string;
  year?: number;
  calls: number;
  evaluated: number;
  hits: number;
  hit_rate: number | null;
}

export interface AnalystDetail extends AnalystRow {
  breakdown?: { by_sector?: BreakdownRow[]; by_year?: BreakdownRow[] };
  rank?: number;
  of?: number;
  factors?: Factor[];
  strongest?: string;
  weakest?: string;
  bias?: BiasStats;
  computed_at?: string;
  market_bias: BiasStats;
  market_score: { hit_rate?: number; consensus_agree?: number; tp_accuracy?: number };
}

export interface RiskInfo {
  components: { track: number; volatility: number | null; implied_move: number | null; confidence: number | null; alignment: number };
  weights_used: Record<string, number>;
  prior_hit_rate: number;
  prior_n: number;
  prior_scope: 'stock' | 'analyst' | 'market';
  volatility_annual: number | null;
  implied_move_pct: number | null;
  confidence_score: number | null;
  peers: number;
  peer_view: Rating | null;
  peer_share: number | null;
}

/** One factor of a call's trust score, as known on the call date. */
export interface CallFactor {
  key: string;
  label: string;
  value: number;
  weight: number;
  points: number;
  evidence: string;
}

export interface Rec {
  id: number;
  report_date: string;
  stock: string;
  code: string;
  symbol: string;
  sector: string | null;
  rating: Rating;
  target_price: number | null;
  entry_price: number | null;
  price_12m: number | null;
  return_12m: number | null;
  eval_end_date: string | null;
  status: 'evaluated' | 'in_window' | 'no_price' | 'pending';
  hit: boolean | null;
  note: string | null;
  consensus_agree: boolean | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  risk: RiskInfo | null;
  analyst: string;
  analyst_id: number;
  broker: string;
  grade: Grade;
  score: number | null;
  confidence_score: number | null;
  confidence: CallFactor[];
  target_chart?: number | null;
  on_stock?: { calls: number; evaluated: number; hits: number; hit_rate: number | null };
  in_sector?: BreakdownRow | null;
  overall_hit_rate?: number | null;
  from?: Rating;
  direction?: 'Upgrade' | 'Downgrade';
}

export interface StockDetail {
  code: string;
  name: string;
  symbol: string;
  sector: string | null;
  last: { date: string; close: number; change: number | null } | null;
  counts: { total: number; open: number; BUY: number; HOLD: number; SELL: number };
  consensus: {
    from: string;
    to: string;
    counts: { BUY: number; HOLD: number; SELL: number };
    label: string;
    avg_target: number | null;
    analysts: number;
  } | null;
  covering: Rec[];
  recommendations: Rec[];
}

export interface Insights {
  date: string | null;
  since: string;
  counts: { total: number; BUY: number; HOLD: number; SELL: number };
  calls: Rec[];
  top: { id: number; name: string; broker: string; score: number; grade: Grade; hit_rate: number; n_evaluated: number; sector: string | null }[];
  changes: Rec[];
  market: BiasStats & { hit_rate?: number };
}

export interface Summary {
  brokers: number;
  analysts: number;
  stocks: number;
  recommendations: number;
  pipeline: {
    as_of?: string;
    computed_at?: string;
    first_call?: string;
    last_call?: string;
    status?: Record<string, number>;
    risk_levels?: Record<string, number>;
  };
  market_score: { hit_rate?: number };
  market_bias: BiasStats;
  disclaimer?: string;
}

export interface BrokerRow {
  id: number;
  name: string;
  calls: number;
  analysts: number;
  evaluated: number;
  hit_rate: number | null;
  buy_share: number;
  hold_share: number;
  sell_share: number;
  buy_to_sell: number | null;
  avg_trust: number | null;
}

export interface ModelRow {
  model: string;
  key: string;
  trained: boolean;
  auc: number | null;
  accuracy: number | null;
  brier: number | null;
  explainable: string;
}

export interface Validation {
  status: string;
  reason?: string;
  split_date?: string;
  n_train?: number;
  n_test?: number;
  base_rate_test?: number;
  weighted_auc?: number;
  logit_auc?: number;
  risk_meter_auc?: number;
  model_comparison?: ModelRow[];
  comparison_summary?: { best_auc_model: string; auc_gap_vs_best: number };
  weights_vs_coef?: { factor: string; weight: number; coefficient: number; coef_share: number; rf_importance: number; same_direction: boolean }[];
  confidence_test?: {
    by_quintile: { quintile: number; calls: number; hit_rate: number; avg_score: number }[];
    by_grade: { grade: Grade; analysts: number; calls: number; hit_rate: number }[];
  };
  bias_test?: { flag: string; measure: 'buy_share' | 'sell_share' | 'avg_overshoot'; flagged: BiasGroup; not_flagged: BiasGroup; persists: boolean | null }[];
  model_calls?: { min_history: number; n_train: number; n_test: number; base_rate_test: number };
  risk_test?: { level: RiskLevel; calls: number; hit_rate: number }[];
  lime_test?: {
    model: string;
    cases: number;
    lime_fidelity_r2: number;
    lime_top_factor_stable_pct: number;
    lime_agrees_with_transparent_pct: number;
    transparent_fidelity_r2: number;
    transparent_stable_pct: number;
    note: string;
  };
  min_calls?: {
    rows: { n: number; ci_half_width_pts: number; analysts_with_2n: number; split_half_r: number | null; reliability: number | null }[];
    market_hit_rate: number;
    threshold_used: number;
    rule: string;
    suggested: number | null;
  };
  cohorts?: { year: number; calls: number; evaluated: number; hit_rate: number | null; buy_share: number; sell_share: number; avg_trust: number | null }[];
}

export interface BiasGroup {
  group: string;
  analysts: number;
  calls: number;
  buy_share: number | null;
  sell_share: number | null;
  avg_overshoot: number | null;
  buy_hit_rate: number | null;
  buy_calls: number;
}

export interface Meta {
  sectors: string[];
  brokers: string[];
  weights: { key: string; label: string; description: string; weight: number }[];
  risk_weights: Record<string, number>;
  risk_levels: { below: number; label: RiskLevel }[];
  thin_sample: number;
  validation: Validation;
  pipeline?: Summary['pipeline'];
  market_score?: { hit_rate?: number; n_evaluated?: number };
  market_bias?: BiasStats;
}

/** Minimal analyst shape returned by /search */
export interface Analyst {
  id: number;
  name: string;
  broker: string;
  grade: Grade;
}

/** Minimal stock shape returned by /search */
export interface StockSummary {
  code: string;
  name: string;
  sector: string | null;
}

export async function postJSON(path: string, body: unknown) {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return res.json();
}

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    throw new Error(
      res.status === 404 ? 'Not found.' : `The server answered ${res.status}. Check the Flask terminal for the error.`
    );
  }
  return res.json() as Promise<T>;
}

/** Tiny data hook: refetches when `path` changes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    getJSON<T>(path)
      .then((d) => alive && setData(d))
      .catch((e: Error) =>
        alive &&
        setError(
          e.message === 'Failed to fetch'
            ? 'Cannot reach the API. Start the backend with `python wsgi.py` in the backend folder.'
            : e.message
        )
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  return { data, error, loading };
}
