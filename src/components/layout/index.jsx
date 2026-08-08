import { Menu, Sparkles, X } from 'lucide-react';
import { GAMES, VIEWS } from '../../lib/constants';
import { formatNumber } from '../../lib/api';
import { GameSwitcher } from '../lottery';
import { IconButton } from '../ui';

export function Sidebar({ activeView, onViewChange, summary, mobileOpen, onClose }) {
  return (
    <aside
      className={
        mobileOpen
          ? 'fixed inset-y-0 left-0 z-50 flex w-52 flex-col border-r border-line bg-white shadow-panel lg:hidden'
          : 'hidden w-52 shrink-0 flex-col border-r border-line bg-white lg:flex lg:min-h-screen'
      }
    >
      <div className="flex min-h-14 items-center justify-between border-b border-line bg-field/50 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-dark to-primary text-white shadow-sm">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-ink">loto-gpt</div>
            <div className="truncate text-[10px] font-semibold text-slate-500">workspace</div>
          </div>
        </div>
        {mobileOpen ? <IconButton label="Close navigation" icon={X} onClick={onClose} className="lg:hidden" /> : null}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {VIEWS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              onViewChange(key);
              onClose?.();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-black transition ${
              activeView === key
                ? 'bg-primary text-white shadow-sm shadow-primary/20'
                : 'text-slate-600 hover:bg-primary/5 hover:text-primary'
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </nav>

      <div className="border-t border-line px-3 py-2.5 text-[10px] font-semibold text-slate-500">
        <div className="rounded-md bg-field px-2 py-1.5">
          <span className="font-black text-ink">{formatNumber(summary?.games?.length || GAMES.length)}</span> games in archive
        </div>
      </div>
    </aside>
  );
}

export function PageHeader({ activeView, onMenu, game, onGameChange, gameLabel, loading = false }) {
  const title = VIEWS.find((item) => item.key === activeView)?.label || 'Dashboard';

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-field/95 backdrop-blur">
      <div className="space-y-3 px-4 py-3 lg:px-6">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <IconButton label="Open navigation" icon={Menu} onClick={onMenu} className="lg:hidden" />
            <div>
              <div className="text-[10px] font-bold uppercase text-slate-500">Workspace</div>
              <h1 className="truncate text-lg font-black text-ink">{title}</h1>
            </div>
          </div>
          {gameLabel ? (
            <div className="hidden text-right sm:block">
              <div className="text-[10px] font-bold uppercase text-slate-500">Active game</div>
              <div className="text-sm font-black text-primary">{gameLabel}</div>
            </div>
          ) : null}
        </div>
        <div className="game-bar bg-gradient-to-b from-primary-soft/80 to-white">
          <GameSwitcher game={game} onGameChange={onGameChange} disabled={loading} />
        </div>
      </div>
    </header>
  );
}
