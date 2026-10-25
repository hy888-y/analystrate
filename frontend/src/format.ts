export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '–' : `${v.toFixed(digits)}%`;

export const signedPct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '–' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;

export const rm = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `RM${v.toFixed(2)}`);

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '–';

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
