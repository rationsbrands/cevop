import React, { useEffect, useMemo, useState } from 'react';

type ToastType = 'success' | 'error' | 'info';

const TOAST_EVENT = 'cevop:toast';

export function showToast(message: string, type: ToastType = 'success') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, type } }));
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: ToastType }>>([]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { message?: unknown; type?: unknown }
        | undefined;
      const message = typeof detail?.message === 'string' ? detail.message.trim() : '';
      const type: ToastType =
        detail?.type === 'error' ? 'error' : detail?.type === 'info' ? 'info' : 'success';
      if (!message) return;

      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, type }].slice(-3));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3200);
    };

    window.addEventListener(TOAST_EVENT, handler as EventListener);
    return () => window.removeEventListener(TOAST_EVENT, handler as EventListener);
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[60] space-y-2 w-[min(420px,calc(100vw-2rem))]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`card p-4 border ${
            t.type === 'error'
              ? 'border-[var(--danger)]/30 bg-[var(--surface)]'
              : t.type === 'info'
                ? 'border-[var(--border)] bg-[var(--surface)]'
                : 'border-[var(--success)]/30 bg-[var(--surface)]'
          }`}
        >
          <div
            className={`text-sm font-semibold ${
              t.type === 'error'
                ? 'text-[var(--danger)]'
                : t.type === 'info'
                  ? 'text-[var(--text)]'
                  : 'text-[var(--success)]'
            }`}
          >
            {t.type === 'error' ? 'Error' : t.type === 'info' ? 'Notice' : 'Success'}
          </div>
          <div className="text-sm text-[var(--muted)] mt-1 whitespace-pre-line">{t.message}</div>
        </div>
      ))}
    </div>
  );
}

type ConfirmVariant = 'default' | 'danger';

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const {
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    busy = false,
    onConfirm,
    onCancel,
  } = props;

  const confirmClass = useMemo(() => {
    if (variant === 'danger') return 'btn btn-danger';
    return 'btn btn-primary';
  }, [variant]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-md p-6 space-y-5 animate-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2">
          <h3
            className={`font-display text-2xl ${
              variant === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--text)]'
            }`}
          >
            {title}
          </h3>
          {message && <p className="text-sm text-[var(--muted)] whitespace-pre-line">{message}</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={confirmClass} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
