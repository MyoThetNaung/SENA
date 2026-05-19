export function DetailList({ items }) {
  if (!items?.length) return null;
  return (
    <dl className="mem-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {items.map(([label, value]) => (
        <div key={label}>
          <label>{label}</label>
          <p className="status-card-value" style={{ fontSize: '0.95rem', marginTop: '0.25rem' }}>
            {value == null || value === '' ? '—' : String(value)}
          </p>
        </div>
      ))}
    </dl>
  );
}
