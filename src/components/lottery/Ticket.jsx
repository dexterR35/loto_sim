import { RefreshCw, Ticket } from 'lucide-react';

export function TicketSlip({
  gameLabel = 'Loto',
  title = 'Ticket',
  subtitle,
  footer,
  columns = 3,
  children
}) {
  return (
    <article className={`ticket ticket--cols-${columns}`}>
      <header className="ticket__header">
        <Ticket size={22} className="ticket__icon" />
        <div className="ticket__heading">
          <div className="ticket__kicker">{gameLabel}</div>
          <div className="ticket__title">{title}</div>
        </div>
        {subtitle ? <div className="ticket__meta">{subtitle}</div> : null}
      </header>
      <div className="ticket__body">{children}</div>
      {footer ? <footer className="ticket__footer">{footer}</footer> : null}
    </article>
  );
}

export function TicketPanel({ label, badges, actions, children, footer, compact = true }) {
  return (
    <section className={compact ? 'ticket-panel ticket-panel--compact' : 'ticket-panel'}>
      <header className="ticket-panel__header">
        <div className="ticket-panel__identity">
          <span className="ticket-panel__letter">{label}</span>
          {badges ? <div className="ticket-panel__badges">{badges}</div> : null}
        </div>
        {actions ? <div className="ticket-panel__actions">{actions}</div> : null}
      </header>
      <div className="ticket-panel__body">{children}</div>
      {footer ? <footer className="ticket-panel__footer">{footer}</footer> : null}
    </section>
  );
}

export function TicketBall({
  value,
  tone = 'default',
  size = 'md',
  selected = false,
  hint = false,
  locked = false,
  grid = false,
  disabled = false,
  onClick,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed
}) {
  const state = selected
    ? (tone === 'joker' ? 'is-joker' : 'is-selected')
    : grid
      ? (locked ? 'is-locked' : hint ? 'is-hint' : 'is-idle')
      : tone === 'primary'
        ? 'is-selected'
        : `is-${tone}`;
  const className = [
    'ticket-ball',
    `ticket-ball--${size}`,
    grid ? 'ticket-ball--grid' : '',
    state
  ].filter(Boolean).join(' ');

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={onClick}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
      >
        {value}
      </button>
    );
  }

  return <span className={className}>{value}</span>;
}

export function TicketPasteField({
  value,
  onChange,
  disabled = false,
  valid = true,
  placeholder = '2 · 5 · 12 · 20 · 24 · 40',
  label = 'Paste six numbers with dots, commas, or spaces',
  onUseLatest,
  latestDisabled = false
}) {
  return (
    <div className="ticket-paste">
      <label className="ticket-paste__field">
        <span className="ticket-paste__label">{label}</span>
        <input
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`ticket-input${valid ? '' : ' is-invalid'}`}
        />
      </label>
      {onUseLatest ? (
        <button type="button" className="ticket-btn ticket-btn--ghost" onClick={onUseLatest} disabled={latestDisabled || disabled}>
          <RefreshCw size={14} /> Use latest
        </button>
      ) : null}
    </div>
  );
}

export function TicketStatus({ ok, children }) {
  return <div className={`ticket-status ${ok ? 'is-ok' : 'is-bad'}`}>{children}</div>;
}
