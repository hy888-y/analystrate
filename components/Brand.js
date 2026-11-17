// TaskLedger logo: a ledger of task lines with a completion dot
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true" style={{ flex: 'none', display: 'block' }}>
      <rect x="2" y="2" width="52" height="52" rx="16" fill="#A855F7" />
      <rect x="14" y="15" width="28" height="5" rx="2.5" fill="#fff" />
      <rect x="14" y="25.5" width="20" height="5" rx="2.5" fill="#fff" opacity=".85" />
      <rect x="14" y="36" width="12" height="5" rx="2.5" fill="#E9D5FF" />
      <circle cx="38" cy="38.5" r="4" fill="#E9D5FF" />
    </svg>
  );
}

export default function Brand({ big }) {
  return big ? (
    <>
      <Logo size={52} />
      <h1>TaskLedger</h1>
    </>
  ) : (
    <a href="/" className="brand"><Logo size={28} />TaskLedger</a>
  );
}
