import { Alert, Group, Loader } from '@mantine/core';
import type { Grade, Rating, RiskLevel } from '../api';

export const GRADE_HEX: Record<string, string> = { A: 'var(--gA)', B: 'var(--gB)', C: 'var(--gC)', D: 'var(--gD)', N: 'var(--gN)' };
export const GRADE_RAW: Record<string, string> = { A: '#0E9F6E', B: '#1F6FEB', C: '#E8A33D', D: '#E5484D', N: '#94A3B8' };
const RISK_N: Record<string, number> = { Low: 1, Moderate: 2, Elevated: 3, High: 4 };
const RISK_C = ['', '#089981', '#8DB33A', '#F5A524', '#F23645'];

export const initials = (n: string) =>
  n.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export function Avatar({ name, grade, size }: { name: string; grade: Grade | string; size?: 'sm' }) {
  return (
    <span className={`av ${size ?? ''}`} style={{ background: GRADE_HEX[grade] ?? GRADE_HEX.N }} title={`Grade ${grade}`}>
      {initials(name)}
      <em style={{ background: GRADE_HEX[grade] ?? GRADE_HEX.N }}>{grade === 'N' ? '–' : grade}</em>
    </span>
  );
}

export function Who({ name, sub, grade, size }: { name: string; sub?: string; grade: Grade | string; size?: 'sm' }) {
  return (
    <span className="who">
      <Avatar name={name} grade={grade} size={size} />
      <span style={{ minWidth: 0 }}>
        <b>{name}</b>
        {sub && <small>{sub}</small>}
      </span>
    </span>
  );
}

export const Pill = ({ r }: { r: Rating }) => <span className={`pill ${r}`}>{r}</span>;

export function GradeChip({ g }: { g: Grade | string }) {
  return <span className="grade" style={{ background: GRADE_HEX[g] ?? GRADE_HEX.N }}>{g === 'N' ? 'NR' : g}</span>;
}

export function Risk({ level }: { level: RiskLevel | null }) {
  if (!level) return <span className="mu">–</span>;
  const n = RISK_N[level];
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="meter">
        {[1, 2, 3, 4].map((i) => <i key={i} style={i <= n ? { background: RISK_C[n] } : undefined} />)}
      </span>
      <span style={{ color: RISK_C[n], fontWeight: 600 }}>{level}</span>
    </span>
  );
}

export function Flags({ flags, thin }: { flags: string[]; thin?: boolean }) {
  if (!flags.length && !thin) return <span className="mu">–</span>;
  return (
    <span>
      {thin && <span className="flag" style={{ background: 'var(--hold-soft)', color: 'var(--mute)' }}>Thin sample</span>}
      {flags.map((f) => <span key={f} className="flag">⚠ {f}</span>)}
    </span>
  );
}

export const Loading = () => (
  <Group justify="center" py={48}>
    <Loader />
  </Group>
);

export const ErrorBox = ({ message }: { message: string }) => (
  <Alert color="red" title="Could not load data" m="md">
    {message}
  </Alert>
);
