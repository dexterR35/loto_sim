export { Modal } from './Modal';
export { DataTable, DEFAULT_PAGE_SIZE } from './DataTable';

export function IconButton({ label, icon: Icon, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-elevated text-muted transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}

export function Badge({ children, tone = 'default' }) {
  const palette = {
    default: 'border-line bg-elevated text-muted',
    primary: 'border-primary/25 bg-primary/10 text-primary',
    teal: 'border-teal/25 bg-teal/10 text-teal',
    coral: 'border-coral/25 bg-coral/10 text-coral',
    gold: 'border-gold/30 bg-gold/10 text-gold',
    grape: 'border-grape/25 bg-grape/10 text-grape'
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${palette[tone]}`}>{children}</span>;
}

export function Chip({ active = false, children, className = '' }) {
  return (
    <span className={['choice-chip', active ? 'is-active' : '', className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}

export function ChoiceChip({ active = false, disabled = false, children, className = '', ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      className={['choice-chip', active ? 'is-active' : '', className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}

export function MetricCard({ label, value, detail, className = '', children }) {
  return (
    <article className={['metric-card', className].filter(Boolean).join(' ')}>
      {label ? <p>{label}</p> : null}
      {value !== undefined ? <strong>{value ?? '—'}</strong> : null}
      {detail ? <span>{detail}</span> : null}
      {children}
    </article>
  );
}

export function MetricGrid({ wide = false, className = '', children }) {
  return (
    <div className={['metric-grid', wide ? 'metric-grid--wide' : '', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

export function Panel({ title, icon: Icon, action, children, className = '', bodyClassName = '' }) {
  return (
    <section className={`chart-card ${className} ${bodyClassName}`}>
      <header className="chart-card__head chart-card__head--row">
        <h2 className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon size={16} className="shrink-0 text-primary" /> : null}
          <span className="truncate">{title}</span>
        </h2>
        {action || null}
      </header>
      {children}
    </section>
  );
}

export function Tabs({ items, active, onChange }) {
  return (
    <div className="grid max-w-full auto-cols-max grid-flow-col gap-1 overflow-x-auto rounded-full border border-line bg-field p-1">
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-bold transition-colors sm:text-sm ${active === key ? 'bg-primary text-field' : 'text-muted hover:bg-elevated hover:text-ink'}`}
        >
          {Icon ? <Icon size={16} /> : null}
          {label}
        </button>
      ))}
    </div>
  );
}

export function LoadingBlock({ rows = 4 }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-2xl bg-elevated" />)}
    </div>
  );
}
