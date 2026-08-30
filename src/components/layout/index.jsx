import { Menu, Orbit, X } from 'lucide-react';
import { GAMES, VIEWS } from '../../lib/constants';
import { formatNumber } from '../../lib/api';
import { GameSwitcher } from '../lottery';
import { TicketStack } from '../lottery/CompactTicket';
import { IconButton } from '../ui';

export function Sidebar({ activeView, onViewChange, summary, mobileOpen, onClose }) {
  return (
    <aside
      className={
        mobileOpen
          ? 'fixed inset-y-0 left-0 z-50 grid w-72 grid-rows-[auto_1fr_auto] border-r border-line bg-surface lg:hidden'
          : 'hidden min-h-svh w-60 shrink-0 grid-rows-[auto_1fr_auto] border-r border-line bg-surface lg:grid'
      }
    >
      <header className="flex min-h-20 items-center justify-between px-5">
        <p className="flex min-w-0 items-center gap-2">
          <Orbit size={24} className="shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-tight text-ink">loto-gpt</span>
            <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">ticket lab</span>
          </span>
        </p>
        {mobileOpen ? <IconButton label="Close navigation" icon={X} onClick={onClose} className="lg:hidden" /> : null}
      </header>

      <nav className="grid content-start gap-1 px-3 py-2">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              onViewChange(key);
              onClose?.();
            }}
            className={`grid w-full grid-cols-[auto_1fr] items-center gap-3 rounded-full px-4 py-3 text-left text-xs font-bold transition-colors ${
              activeView === key
                ? 'bg-primary text-field'
                : 'text-muted hover:bg-elevated hover:text-ink'
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>

      <footer className="m-3 rounded-full border border-line px-4 py-3 text-[10px] font-semibold text-muted">
        <span className="font-bold text-ink">{formatNumber(summary?.games?.length || GAMES.length)}</span> games in archive
      </footer>
    </aside>
  );
}

export function PageHeader({ activeView, onMenu, game, onGameChange, loading = false }) {
  const title = VIEWS.find((item) => item.key === activeView)?.label || 'Dashboard';

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-field/85 px-4 py-3 backdrop-blur-xl lg:px-7">
      <section className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <section className="flex min-w-0 items-center gap-3">
          <IconButton label="Open navigation" icon={Menu} onClick={onMenu} className="lg:hidden" />
          <h1 className="truncate text-base font-bold tracking-tight text-ink sm:text-lg">{title}</h1>
        </section>
        <GameSwitcher game={game} onGameChange={onGameChange} disabled={loading} />
      </section>
    </header>
  );
}

export function TicketRail({ tickets = [], game, onOpen, onClear, onNumberClick }) {
  if (!tickets.length) return null;

  return (
    <aside className="ticket-rail">
      <strong>Active tickets</strong>
      <TicketStack tickets={tickets} onNumberClick={onNumberClick} onOpen={onOpen} />
      <button type="button" onClick={onClear} className="mt-3 rounded-full bg-elevated px-3 py-1.5 text-xs font-bold text-muted hover:text-primary">
        Clear
      </button>
    </aside>
  );
}
