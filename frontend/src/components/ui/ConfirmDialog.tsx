import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cx } from './primitives'

interface Props {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Modal confirmation for state-changing actions, built on <dialog>. */
export function ConfirmDialog({ open, title, children, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal?.()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[min(92vw,460px)] rounded-xl border border-line-strong bg-card p-0 text-fg shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-[2px]"
      aria-labelledby="confirm-title"
    >
      <div className="p-6">
        <div className="flex items-start gap-3">
          <span className={cx('mt-0.5 rounded-full p-2', danger ? 'bg-bad-soft text-bad' : 'bg-accent-soft text-accent')}>
            <AlertTriangle size={20} />
          </span>
          <div>
            <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
            <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-fg hover:bg-inset disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cx(
              'rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60',
              danger ? 'bg-bad hover:brightness-110' : 'bg-accent text-[#04202a] hover:brightness-110',
            )}
          >
            {busy ? 'Waiting for hardware…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
