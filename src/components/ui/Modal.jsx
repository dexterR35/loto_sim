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
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div className={`relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-panel ${SIZES[size] || SIZES.lg} ${className}`}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-field/50 px-5 py-4">
          <div className="min-w-0">
            {Icon ? (
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon size={18} />
              </div>
            ) : null}
            <h2 id="modal-title" className="text-lg font-black text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-ink transition hover:border-primary hover:text-primary"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line bg-field/30 px-5 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
