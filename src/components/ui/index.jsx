export { Modal } from './Modal';

export function IconButton({ label, icon: Icon, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white text-ink transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      <Icon size={18} />
    </button>
  );
}

export function Badge({ children, tone = 'default' }) {
  const palette = {
    default: 'border-line bg-white text-muted',
    primary: 'border-primary/25 bg-primary/10 text-primary',
    teal: 'border-teal/25 bg-teal/10 text-teal',
    coral: 'border-coral/25 bg-coral/10 text-coral',
    gold: 'border-gold/30 bg-gold/15 text-amber-800',
    grape: 'border-grape/25 bg-grape/10 text-grape'
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${palette[tone]}`}>{children}</span>;
}

export function Panel({ title, icon: Icon, action, children, className = '', bodyClassName = 'p-4' }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-line bg-white shadow-card ${className}`}>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line bg-field/60 px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-black text-ink">
          {Icon ? <Icon size={18} className="shrink-0 text-primary" /> : null}
          <span className="truncate">{title}</span>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Tabs({ items, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition ${active === key ? 'border-primary bg-primary text-white shadow-sm' : 'border-line bg-white text-muted hover:border-primary/30 hover:text-primary'}`}
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
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}
    </div>
  );
}
