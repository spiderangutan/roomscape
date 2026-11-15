import { useState } from 'react'
import { formatLengthCompact } from '../lib/units.ts'
import { store, useStoreState } from '../lib/store.ts'
import { cx } from '../lib/util.ts'
import { InlineText } from './Fields.tsx'
import { ConfirmDialog } from './Dialogs.tsx'

interface Props {
  open: boolean
  onNewProject: () => void
  onNewRoom: () => void
  onClose: () => void
}

export default function ProjectsPanel({ open, onNewProject, onNewRoom, onClose }: Props) {
  const state = useStoreState()
  const project = state.projects.find((entry) => entry.id === state.projectId)
  const [pendingRoom, setPendingRoom] = useState<string | null>(null)
  const [pendingProject, setPendingProject] = useState<string | null>(null)

  const roomToDelete = project?.rooms.find((room) => room.id === pendingRoom)
  const projectToDelete = state.projects.find((entry) => entry.id === pendingProject)

  return (
    <aside className={cx('panel panel--left', open && 'panel--open')} aria-label="Projects and rooms">
      <div className="panel__head">
        <h2 className="panel__title">Projects</h2>
        <div className="panel__actions">
          <button type="button" className="btn btn--small" onClick={onNewProject}>
            New project
          </button>
          <button type="button" className="icon-btn panel__close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </div>
      </div>

      <div className="panel__scroll">
        {state.projects.length === 0 && (
          <p className="muted small">
            No projects yet. Create one, or load the sample home from the canvas.
          </p>
        )}

        <ul className="rows">
          {state.projects.map((entry) => (
            <li
              key={entry.id}
              className={cx('row', entry.id === state.projectId && 'row--active')}
              onClick={() => store.openProject(entry.id)}
            >
              <div className="row__main">
                <span className="row__name row__name--static">{entry.name}</span>
                <span className="row__meta">
                  {entry.rooms.length} {entry.rooms.length === 1 ? 'room' : 'rooms'} · {entry.unit}
                </span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="row-btn row-btn--danger"
                  aria-label={`Delete ${entry.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPendingProject(entry.id)
                  }}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>

        {project && (
          <section className="panel__section">
            <div className="panel__head panel__head--inner">
              <h3 className="panel__subtitle">Rooms</h3>
              <button type="button" className="btn btn--small" onClick={onNewRoom}>
                Add room
              </button>
            </div>

            {project.rooms.length === 0 && (
              <p className="muted small">No rooms in this project yet — add one with its length and width.</p>
            )}

            <ul className="rows">
              {project.rooms.map((room, index) => (
                <li
                  key={room.id}
                  className={cx('row', 'row--room', room.id === state.roomId && 'row--active')}
                  onClick={() => store.openRoom(room.id)}
                >
                  <div className="row__main">
                    <InlineText
                      ariaLabel={`Rename ${room.name}`}
                      className="row__name"
                      value={room.name}
                      onChange={(value) => store.renameRoom(room.id, value)}
                    />
                    <span className="row__meta">
                      {formatLengthCompact(room.length, project.unit)} × {formatLengthCompact(room.width, project.unit)} ·{' '}
                      {room.items.length} {room.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="row-btn"
                      aria-label="Move room up"
                      disabled={index === 0}
                      onClick={(event) => {
                        event.stopPropagation()
                        store.reorderRoom(room.id, -1)
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="row-btn"
                      aria-label="Move room down"
                      disabled={index === project.rooms.length - 1}
                      onClick={(event) => {
                        event.stopPropagation()
                        store.reorderRoom(room.id, 1)
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="row-btn"
                      aria-label={`Duplicate ${room.name}`}
                      title="Duplicate room with its furniture"
                      onClick={(event) => {
                        event.stopPropagation()
                        store.duplicateRoom(room.id)
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="row-btn row-btn--danger"
                      aria-label={`Delete ${room.name}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setPendingRoom(room.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(roomToDelete)}
        title="Delete this room?"
        message={roomToDelete ? `“${roomToDelete.name}” and its furniture will be removed. You can undo this.` : ''}
        confirmLabel="Delete room"
        onClose={() => setPendingRoom(null)}
        onConfirm={() => {
          if (roomToDelete) store.deleteRoom(roomToDelete.id)
          setPendingRoom(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(projectToDelete)}
        title="Delete this project?"
        message={projectToDelete ? `“${projectToDelete.name}” and all of its rooms will be removed. You can undo this.` : ''}
        confirmLabel="Delete project"
        onClose={() => setPendingProject(null)}
        onConfirm={() => {
          if (projectToDelete) store.deleteProject(projectToDelete.id)
          setPendingProject(null)
        }}
      />
    </aside>
  )
}
