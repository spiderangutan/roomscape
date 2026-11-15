import { useEffect, useState } from 'react'
import type { ItemShape, Unit } from '../types.ts'
import { CUSTOM_COLORS } from '../lib/catalog.ts'
import { clampLshapeThickness } from '../lib/geometry.ts'
import { UNIT_LABELS, UNITS, fromUnit, isMetric } from '../lib/units.ts'
import { store } from '../lib/store.ts'
import { cx } from '../lib/util.ts'
import { UnitField } from './Fields.tsx'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: React.ReactNode
  footer: React.ReactNode
  width?: number
}

export function Modal({ open, title, description, onClose, children, footer, width = 460 }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal">
      <button type="button" className="modal__backdrop" aria-label="Close dialog" onClick={onClose} />
      <div className="modal__panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {description && <p className="muted small">{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__foot">{footer}</div>
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={400}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal__text">{message}</p>
    </Modal>
  )
}

interface DialogProps {
  open: boolean
  onClose: () => void
}

export function NewProjectDialog({ open, onClose }: DialogProps) {
  const [name, setName] = useState('My home')
  const [unit, setUnit] = useState<Unit>('ft')

  return (
    <Modal
      open={open}
      title="New project"
      description="A project holds as many rooms as you like."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              store.createProject(name, unit)
              onClose()
            }}
          >
            Create project
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Project name</span>
        <input
          className="field__input"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              store.createProject(name, unit)
              onClose()
            }
          }}
        />
      </label>
      <label className="field">
        <span className="field__label">Measurement units</span>
        <select className="field__input" value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>
          {UNITS.map((entry) => (
            <option key={entry} value={entry}>
              {UNIT_LABELS[entry]}
            </option>
          ))}
        </select>
      </label>
      <p className="field__hint">
        You can type measurements in any format — “12 ft 6 in”, “2.4 m”, “85 cm” — whatever the display unit is.
      </p>
    </Modal>
  )
}

interface NewRoomDialogProps extends DialogProps {
  unit: Unit
}

export function NewRoomDialog({ open, onClose, unit }: NewRoomDialogProps) {
  const metric = isMetric(unit)
  const defaults = metric
    ? { name: 'New room', length: 4000, width: 3200, wall: 2700 }
    : { name: 'New room', length: fromUnit(12, 'ft'), width: fromUnit(10, 'ft'), wall: fromUnit(9, 'ft') }
  const [name, setName] = useState(defaults.name)
  const [length, setLength] = useState(defaults.length)
  const [width, setWidth] = useState(defaults.width)
  const [wallHeight, setWallHeight] = useState(defaults.wall)

  useEffect(() => {
    if (!open) return
    setName(defaults.name)
    setLength(defaults.length)
    setWidth(defaults.width)
    setWallHeight(defaults.wall)
    // Defaults follow the project unit each time the dialog opens.
  }, [open, defaults.name, defaults.length, defaults.width, defaults.wall])

  const valid = length >= 600 && width >= 600 && wallHeight >= 1200

  return (
    <Modal
      open={open}
      title="Add a room"
      description="Rooms start from their length and width. Both can be changed later."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!valid}
            onClick={() => {
              store.addRoom({ name, length, width, wallHeight })
              onClose()
            }}
          >
            Add room
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Room name</span>
        <input className="field__input" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="grid-2">
        <UnitField label="Length" value={length} unit={unit} min={600} max={40000} onChange={setLength} />
        <UnitField label="Width" value={width} unit={unit} min={600} max={40000} onChange={setWidth} />
      </div>
      <UnitField
        label="Wall height"
        value={wallHeight}
        unit={unit}
        min={1200}
        max={6000}
        onChange={setWallHeight}
      />
      {!valid && <p className="field__error">Rooms need to be at least 2 ft / 60 cm on each side.</p>}
    </Modal>
  )
}

interface CustomItemDialogProps extends DialogProps {
  unit: Unit
  hasRoom: boolean
}

const SHAPES: Array<{ id: ItemShape; label: string; hint: string }> = [
  { id: 'box', label: 'Box', hint: 'Rectangular footprint' },
  { id: 'lshape', label: 'L-shape', hint: 'Two joined rectangles' },
  { id: 'round', label: 'Round', hint: 'Circular footprint' },
]

export function CustomItemDialog({ open, onClose, unit, hasRoom }: CustomItemDialogProps) {
  const [name, setName] = useState('Custom item')
  const [shape, setShape] = useState<ItemShape>('box')
  const [width, setWidth] = useState(fromUnit(3, 'ft'))
  const [depth, setDepth] = useState(fromUnit(2, 'ft'))
  const [height, setHeight] = useState(fromUnit(2, 'ft'))
  const [thickness, setThickness] = useState(240)
  const [color, setColor] = useState(CUSTOM_COLORS[0])

  useEffect(() => {
    if (!open) return
    setName('Custom item')
    setShape('box')
    setWidth(fromUnit(3, 'ft'))
    setDepth(fromUnit(2, 'ft'))
    setHeight(fromUnit(2, 'ft'))
    setThickness(240)
    setColor(CUSTOM_COLORS[0])
  }, [open])

  const valid = width >= 80 && depth >= 80 && height >= 10
  const lshapeThicknessValue = clampLshapeThickness(thickness, width, depth)

  return (
    <Modal
      open={open}
      title="Create a custom item"
      description="Simple block shapes at the right scale — no furniture modelling needed."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!valid || !hasRoom}
            onClick={() => {
              store.createCustomItem({
                name,
                kind: shape,
                shape,
                w: width,
                d: depth,
                h: height,
                thickness: shape === 'lshape' ? lshapeThicknessValue : undefined,
                color,
                category: 'Custom',
              })
              onClose()
            }}
          >
            Create and place
          </button>
        </>
      }
    >
      {!hasRoom && <p className="field__error">Open a room first — custom items are placed in the current room.</p>}
      <label className="field">
        <span className="field__label">Name</span>
        <input className="field__input" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="grid-3">
        <UnitField label="Width" value={width} unit={unit} min={80} max={12000} onChange={setWidth} />
        <UnitField label="Depth" value={depth} unit={unit} min={80} max={12000} onChange={setDepth} />
        <UnitField label="Height" value={height} unit={unit} min={10} max={4000} onChange={setHeight} />
      </div>
      <div className="field">
        <span className="field__label">Shape</span>
        <div className="chip-row">
          {SHAPES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx('chip', shape === entry.id && 'chip--active')}
              aria-pressed={shape === entry.id}
              title={entry.hint}
              onClick={() => setShape(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {shape === 'lshape' && (
        <UnitField
          label="Leg thickness"
          value={lshapeThicknessValue}
          unit={unit}
          min={50}
          max={Math.max(50, Math.min(width, depth) - 90)}
          onChange={setThickness}
        />
      )}
      <div className="field">
        <span className="field__label">Colour</span>
        <div className="swatches">
          {CUSTOM_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={cx('swatch', color === entry && 'swatch--active')}
              style={{ background: entry }}
              aria-label={`Use colour ${entry}`}
              onClick={() => setColor(entry)}
            />
          ))}
        </div>
      </div>
      {!valid && <p className="field__error">Give the item a little more size — at least {isMetric(unit) ? '8 cm' : '3 in'}.</p>}
    </Modal>
  )
}
