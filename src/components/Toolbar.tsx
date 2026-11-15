import { useEffect, useState } from 'react'
import type { Unit } from '../types.ts'
import { UNIT_LABELS, isMetric } from '../lib/units.ts'
import { store } from '../lib/store.ts'
import { cx, formatClock, relativeTime } from '../lib/util.ts'
import type { State } from '../lib/store.ts'
import { InlineText } from './Fields.tsx'
import OverlayClose from './OverlayClose.tsx'

interface Props {
  state: State
  onNewRoom: () => void
  onCustomItem: () => void
  onToggleDrawer: (side: 'left' | 'right') => void
  drawer: 'none' | 'left' | 'right'
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘Z / Ctrl+Z', 'Undo'],
  ['⇧⌘Z / Ctrl+Y', 'Redo'],
  ['⌘D', 'Duplicate item'],
  ['R / ⇧R', 'Rotate item 90°'],
  ['Arrows', 'Nudge item (⇧ for a big step)'],
  ['Delete', 'Remove item or opening'],
  ['Esc', 'Clear selection'],
  ['Scroll', 'Zoom the canvas'],
  ['Drag furniture', 'Move it in 2D or 3D'],
  ['Shift-drag / right-drag', 'Pan in 3D; drag empty 2D space to pan'],
]

export default function Toolbar({ state, onNewRoom, onCustomItem, onToggleDrawer, drawer }: Props) {
  const [, setTick] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!helpOpen) return
    const onClick = () => setHelpOpen(false)
    window.addEventListener('pointerdown', onClick)
    return () => window.removeEventListener('pointerdown', onClick)
  }, [helpOpen])

  const project = state.projects.find((entry) => entry.id === state.projectId)
  const room = project?.rooms.find((entry) => entry.id === state.roomId)
  const unit: Unit = project?.unit ?? 'ft'

  const saveLabel =
    state.saveState === 'saving'
      ? 'Saving…'
      : state.saveState === 'error'
        ? "Couldn't save in this browser"
        : state.savedAt
          ? `Saved ${relativeTime(state.savedAt)}`
          : 'All changes saved'

  return (
    <header className="toolbar">
      <div className="toolbar__group toolbar__group--brand">
        <button
          type="button"
          className={cx('icon-btn', 'drawer-toggle', drawer === 'left' && 'is-active')}
          onClick={() => onToggleDrawer('left')}
          aria-label="Projects and rooms"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <span className="brand">
          <span className="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <path d="M16 5.5l10 8V26h-7v-6.6h-6V26H6V13.5z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand__name">Roomscape</span>
        </span>
      </div>

      <div className="toolbar__group toolbar__group--names">
        {project ? (
          <>
            <label className="name-field">
              <span className="name-field__label">Project</span>
              <InlineText
                ariaLabel="Project name"
                className="name-field__input"
                value={project.name}
                onChange={(value) => store.renameProject(project.id, value)}
              />
            </label>
            <span className="name-divider" aria-hidden="true">
              /
            </span>
            <label className="name-field">
              <span className="name-field__label">Room</span>
              <InlineText
                ariaLabel="Room name"
                className="name-field__input"
                value={room?.name ?? ''}
                disabled={!room}
                placeholder="No room selected"
                onChange={(value) => room && store.renameRoom(room.id, value)}
              />
            </label>
          </>
        ) : (
          <span className="muted small">No project open yet</span>
        )}
      </div>

      <div className="toolbar__group toolbar__group--actions">
        <div className="toolbar__buttons">
          <button
            type="button"
            className="icon-btn"
            disabled={!state.canUndo}
            onClick={() => store.undo()}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <path
                d="M7 5.5H5.2A3.2 3.2 0 002 8.7v0a3.2 3.2 0 003.2 3.2H13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M9 2.5L5.5 5.5 9 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!state.canRedo}
            onClick={() => store.redo()}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <path
                d="M13 5.5h1.8A3.2 3.2 0 0118 8.7v0a3.2 3.2 0 01-3.2 3.2H7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path d="M11 2.5l3.5 3L11 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="seg seg--small" role="group" aria-label="Room or whole home">
          <button
            type="button"
            aria-pressed={state.scope === 'room'}
            onClick={() => store.setScope('room')}
            title="Edit the selected room"
          >
            Room
          </button>
          <button
            type="button"
            aria-pressed={state.scope === 'home'}
            onClick={() => store.setScope('home')}
            disabled={(project?.rooms.length ?? 0) === 0}
            title="Arrange every room together"
          >
            Whole home
          </button>
        </div>

        <div className="seg seg--small" role="group" aria-label="View mode">
          <button type="button" aria-pressed={state.view === '2d'} onClick={() => store.setView('2d')} title="2D editor">
            2D
          </button>
          <button type="button" aria-pressed={state.view === '3d'} onClick={() => store.setView('3d')} title="3D view">
            3D
          </button>
        </div>

        <div className="toolbar__adds">
          <button type="button" className="btn btn--small" onClick={onNewRoom} disabled={!project}>
            Add room
          </button>
          <button type="button" className="btn btn--small" onClick={onCustomItem} disabled={!project}>
            Custom item
          </button>
        </div>

        <div className={cx('save-status', state.saveState === 'saving' && 'save-status--saving', state.saveState === 'error' && 'save-status--error')}>
          <span className="save-status__dot" aria-hidden="true" />
          <span className="save-status__text">
            {saveLabel}
            {state.saveState === 'saved' && state.savedAt ? ` · ${formatClock(state.savedAt)}` : ''}
          </span>
        </div>

        <div className="toolbar__help">
          <button
            type="button"
            className="icon-btn"
            aria-label="Keyboard shortcuts"
            aria-expanded={helpOpen}
            onPointerDown={(event) => {
              event.stopPropagation()
              setHelpOpen((open) => !open)
            }}
          >
            <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7.9 7.6a2.1 2.1 0 013.9 1c0 1.4-2 1.7-2 2.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9.9" cy="14" r="0.9" fill="currentColor" />
            </svg>
          </button>
          {helpOpen && (
            <div className="help-pop" role="dialog" aria-label="Shortcuts and tips">
              <OverlayClose label="Close shortcuts and tips" onClose={() => setHelpOpen(false)} />
              <h4>One home, two views</h4>
              <p className="muted small">
                The 2D editor and the 3D view share the same layout. Move, rotate, recolour and delete furniture in
                either view — changes appear in both and save automatically.
              </p>
              <p className="muted small">
                Switch scope to “Whole home” to arrange every room together in 2D and 3D. Rooms that touch share a
                single wall.
              </p>
              <dl className="help-pop__list">
                {SHORTCUTS.map(([keys, description]) => (
                  <div className="help-pop__row" key={keys}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{description}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">
                Unit: {UNIT_LABELS[unit]} — switch it in the room properties. {isMetric(unit) ? 'Metric grid.' : 'Imperial grid.'}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          className={cx('icon-btn', 'drawer-toggle', drawer === 'right' && 'is-active')}
          onClick={() => onToggleDrawer('right')}
          aria-label="Furniture and properties"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
            <rect x="3" y="3" width="14" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12.5 3v14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </header>
  )
}
