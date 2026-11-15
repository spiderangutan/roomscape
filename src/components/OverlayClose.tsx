import { cx } from '../lib/util.ts'

interface Props {
  label: string
  onClose: () => void
  className?: string
}

/** Dismiss button shared by every floating card in the editors. */
export default function OverlayClose({ label, onClose, className }: Props) {
  return (
    <button
      type="button"
      className={cx('overlay-close', className)}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span aria-hidden="true">×</span>
    </button>
  )
}
