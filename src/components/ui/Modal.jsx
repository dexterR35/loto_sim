import { useEffect } from 'react';
import { X } from 'lucide-react';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
  full: 'max-w-6xl'
};

export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  size = 'lg',
  children,
  footer,
  className = ''
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-2 sm:place-items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <section className={`relative grid max-h-[94vh] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-line bg-surface ${SIZES[size] || SIZES.lg} ${className}`}>
        <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-b border-line px-5 py-5 sm:px-6">
          {Icon ? <Icon size={20} className="mt-0.5 text-primary" /> : <span />}
          <div className="min-w-0">
            <h2 id="modal-title" className="text-lg font-bold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elevated text-muted transition-colors hover:text-primary"
          >
            <X size={18} />
          </button>
        </header>
        <div className="overflow-y-auto p-5 sm:p-6">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-line px-5 py-4 sm:px-6">{footer}</footer> : null}
      </section>
    </div>
  );
}
