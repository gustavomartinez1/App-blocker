import { useEffect, useState, type ReactNode } from 'react';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="stack">{children}</div>
        {footer && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const toastTarget = new EventTarget();

export function toast(message: string): void {
  toastTarget.dispatchEvent(new CustomEvent('toast', { detail: message }));
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3500);
    };
    toastTarget.addEventListener('toast', on);
    return () => toastTarget.removeEventListener('toast', on);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Ejecuta una acción mostrando errores como aviso. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const r = await fn();
    if (success) toast(success);
    return r;
  } catch (e) {
    toast((e as Error).message);
    return undefined;
  }
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 100;
  return (
    <div className={`progress ${value >= max ? 'over' : ''}`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
