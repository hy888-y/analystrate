import { createTheme, MantineColorsTuple } from '@mantine/core';

// "Ledger teal": deep blue-green of a broker research sheet, with an amber marker for bias flags.
const ledger: MantineColorsTuple = [
  '#e6f5f4', '#cfe7e6', '#a1cfcd', '#6fb5b2', '#489f9c', '#30918e',
  '#1f8986', '#0e7672', '#006965', '#005b57',
];
const marker: MantineColorsTuple = [
  '#fff6e1', '#ffecca', '#fdd799', '#fbc163', '#f9ae36', '#f8a219',
  '#f89c06', '#dc8800', '#c47800', '#aa6700',
];

export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: { light: 6, dark: 5 },
  colors: { ledger, marker },
  fontFamily: '"Onest", "Segoe UI", system-ui, sans-serif',
  fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, Consolas, monospace',
  headings: {
    fontFamily: '"Onest", "Segoe UI", system-ui, sans-serif',
    fontWeight: '700',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  components: {
    Paper: { defaultProps: { withBorder: true, p: 'lg' } },
    Badge: { defaultProps: { variant: 'light', radius: 'sm' } },
  },
});

export const RISK_COLOR: Record<string, string> = {
  Low: 'teal.6',
  Moderate: 'lime.7',
  Elevated: 'marker.6',
  High: 'red.6',
};
export const GRADE_COLOR: Record<string, string> = { A: 'teal', B: 'ledger', C: 'marker', D: 'red', N: 'gray' };
export const RATING_COLOR: Record<string, string> = { BUY: 'teal', HOLD: 'gray', SELL: 'red' };
