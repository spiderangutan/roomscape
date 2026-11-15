import type { FurnitureItem, Project, Room, Unit, Wall } from '../types.ts'
import {
  WALLS,
  WALL_NAMES,
  clampLshapeThickness,
  doorHinge,
  doorSwing,
  lshapeThickness,
  roomLayout,
  roomRect,
  roomTopLeft,
  wallLength,
} from '../lib/geometry.ts'
import { ITEM_COLORS } from '../lib/catalog.ts'
import { UNIT_LABELS, UNITS, formatLengthCompact } from '../lib/units.ts'
import { getSelectedItem, getSelectedOpening, store } from '../lib/store.ts'
import type { State } from '../lib/store.ts'
import { cx } from '../lib/util.ts'
import { InlineText, UnitField } from './Fields.tsx'

interface Props {
  state: State
  project: Project
  room: Room
}

function floorArea(room: Room, unit: Unit): string {
  const squareMetres = (room.length * room.width) / 1_000_000
  if (unit === 'ft' || unit === 'in') {
    return `${Math.round(squareMetres * 10.7639)} sq ft`
  }
  return `${squareMetres.toFixed(1)} m²`
}

export default function PropertiesPanel({ state, project, room }: Props) {
  const unit = project.unit
  const item = getSelectedItem(state)
  const opening = getSelectedOpening(state)

  return (
    <section className="panel__section panel__section--grow properties" aria-label="Properties">
      <div className="panel__head">
        <h2 className="panel__title">Properties</h2>
        <span className="pill pill--muted">
          {state.selection ? (item ? 'Item' : opening ? 'Opening' : 'Room') : 'Room'}
        </span>
      </div>

      <div className="properties__scroll">
        {state.scope === 'home' && <HomeCard project={project} room={room} unit={unit} />}

        <div className="card">
          <div className="card__head">
            <h3 className="card__title">Room</h3>
            <span className="pill">{floorArea(room, unit)}</span>
          </div>
          <div className="grid-2">
            <UnitField
              label="Length"
              value={room.length}
              unit={unit}
              min={600}
              max={40000}
              onChange={(mm) => store.updateRoom(room.id, { length: mm })}
            />
            <UnitField
              label="Width"
              value={room.width}
              unit={unit}
              min={600}
              max={40000}
              onChange={(mm) => store.updateRoom(room.id, { width: mm })}
            />
            <UnitField
              label="Wall height"
              value={room.wallHeight}
              unit={unit}
              min={1200}
              max={6000}
              onChange={(mm) => store.updateRoom(room.id, { wallHeight: mm })}
            />
            <label className="field">
              <span className="field__label">Units</span>
              <select
                className="field__input"
                value={unit}
                onChange={(event) => store.setUnit(event.target.value as Unit)}
              >
                {UNITS.map((entry) => (
                  <option key={entry} value={entry}>
                    {UNIT_LABELS[entry]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn--small" onClick={() => store.rotateCurrentRoom(-1)}>
              ⟲ Rotate 90°
            </button>
            <button type="button" className="btn btn--small" onClick={() => store.rotateCurrentRoom(1)}>
              ⟳ Rotate 90°
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                store.setScope('room')
                store.setView('2d')
              }}
            >
              Edit in 2D
            </button>
          </div>
          <p className="field__hint">
            Rotating turns the walls, doors, windows and furniture together. Furniture keeps its own dimensions.
          </p>
        </div>

        <div className="card">
          <div className="card__head">
            <h3 className="card__title">Doors &amp; windows</h3>
            <div className="btn-row btn-row--tight">
              <button type="button" className="btn btn--small" onClick={() => store.addOpening('door')}>
                + Door
              </button>
              <button type="button" className="btn btn--small" onClick={() => store.addOpening('window')}>
                + Window
              </button>
            </div>
          </div>

          {room.openings.length === 0 ? (
            <p className="muted small">No openings yet. Add a door or window and drag it along the wall.</p>
          ) : (
            <ul className="rows rows--tight">
              {room.openings.map((entry) => (
                <li
                  key={entry.id}
                  className={cx('row', 'row--compact', opening?.id === entry.id && 'row--active')}
                  onClick={() => store.setSelection({ kind: 'opening', id: entry.id })}
                >
                  <div className="row__main">
                    <span className="row__name row__name--static">
                      {entry.type === 'door' ? 'Door' : 'Window'} · {WALL_NAMES[entry.wall]}
                    </span>
                    <span className="row__meta">
                      {formatLengthCompact(entry.width, unit)} wide
                      {entry.type === 'door'
                        ? ` · ${doorHinge(entry)} hinge · opens ${doorSwing(entry) === 'out' ? 'out' : 'in'}`
                        : ` · ${formatLengthCompact(entry.offset + entry.width / 2, unit)} from corner`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="row-btn row-btn--danger"
                    aria-label={`Delete ${entry.type}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      store.deleteOpening(entry.id)
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {opening && (
            <div className="subcard">
              <div className="grid-2">
                <label className="field">
                  <span className="field__label">Wall</span>
                  <select
                    className="field__input"
                    value={opening.wall}
                    onChange={(event) => store.updateOpening(opening.id, { wall: event.target.value as Wall })}
                  >
                    {WALLS.map((wall) => (
                      <option key={wall} value={wall}>
                        {WALL_NAMES[wall]}
                      </option>
                    ))}
                  </select>
                </label>
                <UnitField
                  label="Distance from corner"
                  value={opening.offset}
                  unit={unit}
                  min={0}
                  max={wallLength(room, opening.wall) - opening.width}
                  onChange={(mm) => store.updateOpening(opening.id, { offset: mm })}
                />
                <UnitField
                  label="Width"
                  value={opening.width}
                  unit={unit}
                  min={400}
                  max={wallLength(room, opening.wall) - 200}
                  onChange={(mm) => store.updateOpening(opening.id, { width: mm })}
                />
                {opening.type === 'window' ? (
                  <>
                    <UnitField
                      label="Height"
                      value={opening.height}
                      unit={unit}
                      min={300}
                      max={2400}
                      onChange={(mm) => store.updateOpening(opening.id, { height: mm })}
                    />
                    <UnitField
                      label="Sill height"
                      value={opening.sill}
                      unit={unit}
                      min={0}
                      max={1800}
                      onChange={(mm) => store.updateOpening(opening.id, { sill: mm })}
                    />
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span className="field__label">Hinge side</span>
                      <select
                        className="field__input"
                        value={doorHinge(opening)}
                        onChange={(event) =>
                          store.updateOpening(opening.id, { hinge: event.target.value === 'right' ? 'right' : 'left' })
                        }
                      >
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label className="field">
                      <span className="field__label">Swing</span>
                      <select
                        className="field__input"
                        value={doorSwing(opening)}
                        onChange={(event) =>
                          store.updateOpening(opening.id, { swing: event.target.value === 'out' ? 'out' : 'in' })
                        }
                      >
                        <option value="in">Into the room</option>
                        <option value="out">Away from the room</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              <p className="field__hint">
                {opening.type === 'door'
                  ? 'The 2D plan and the 3D view both show the chosen hinge and swing. Clear space is checked on the side the door opens towards.'
                  : `Windows keep a ${formatLengthCompact(300, unit)} clear zone; low furniture in front of a window is fine.`}
              </p>
            </div>
          )}
        </div>

        {item ? (
          <ItemCard item={item} unit={unit} />
        ) : (
          <div className="card card--quiet">
            <h3 className="card__title">Nothing selected</h3>
            <p className="muted small">
              Select a piece of furniture in either view to move, rotate, resize, recolour, duplicate or delete it.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

interface HomeCardProps {
  project: Project
  room: Room
  unit: Unit
}

function HomeCard({ project, room, unit }: HomeCardProps) {
  const layout = roomLayout(room)
  const rect = roomRect(room)
  const topLeft = roomTopLeft(room)
  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title">Whole-home layout</h3>
        <span className="pill">{layout.rotation}°</span>
      </div>
      <p className="muted small">
        “{room.name}” is one of {project.rooms.length} rooms. Drag rooms in the plan to move them; edges that touch
        share a single wall in 3D.
      </p>
      <div className="grid-2">
        <UnitField
          label="From left"
          value={topLeft.x}
          unit={unit}
          min={-100000}
          max={100000}
          onChange={(mm) => store.setRoomTopLeft(room.id, mm, topLeft.y)}
        />
        <UnitField
          label="From top"
          value={topLeft.y}
          unit={unit}
          min={-100000}
          max={100000}
          onChange={(mm) => store.setRoomTopLeft(room.id, topLeft.x, mm)}
        />
      </div>
      <p className="field__hint">
        Plan footprint: {formatLengthCompact(rect.maxX - rect.minX, unit)} ×{' '}
        {formatLengthCompact(rect.maxY - rect.minY, unit)}
      </p>
      <div className="btn-row">
        <button type="button" className="btn btn--small" onClick={() => store.rotateRoomLayout(room.id, -90)}>
          ⟲ Rotate in plan
        </button>
        <button type="button" className="btn btn--small" onClick={() => store.rotateRoomLayout(room.id, 90)}>
          ⟳ Rotate in plan
        </button>
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={() => {
            store.openRoom(room.id)
            store.setScope('room')
            store.setView('2d')
          }}
        >
          Edit room
        </button>
      </div>
      <p className="field__hint">
        Rotating here turns the whole room in the home layout; the room's own furniture stays where it is.
      </p>
    </div>
  )
}

interface ItemCardProps {
  item: FurnitureItem
  unit: Unit
}

function ItemCard({ item, unit }: ItemCardProps) {
  const custom = item.catalogId?.startsWith('custom_')
  const isLshape = item.shape === 'lshape'
  const thickness = lshapeThickness(item)
  return (
    <div className="card">
      <div className="card__head">
        <h3 className="card__title">{item.name}</h3>
        {item.fixed && <span className="pill pill--muted">Fixture</span>}
        {item.overlappable && <span className="pill pill--muted">Layers</span>}
      </div>

      <InlineText
        ariaLabel="Item name"
        className="inline-text--boxed"
        value={item.name}
        onChange={(value) => store.updateItem(item.id, { name: value })}
      />

      <div className="grid-3">
        <UnitField
          label="Width"
          value={item.w}
          unit={unit}
          min={80}
          max={12000}
          onChange={(mm) => store.updateItem(item.id, { w: mm })}
        />
        <UnitField
          label="Depth"
          value={item.d}
          unit={unit}
          min={80}
          max={12000}
          onChange={(mm) => store.updateItem(item.id, { d: mm })}
        />
        <UnitField
          label="Height"
          value={item.h}
          unit={unit}
          min={10}
          max={4000}
          onChange={(mm) => store.updateItem(item.id, { h: mm })}
        />
      </div>

      {isLshape && (
        <div className="subcard subcard--tight">
          <UnitField
            label="Leg thickness"
            value={thickness}
            unit={unit}
            min={50}
            max={Math.max(50, Math.min(item.w, item.d) - 90)}
            onChange={(mm) =>
              store.updateItem(item.id, {
                thickness: clampLshapeThickness(mm, item.w, item.d),
              })
            }
          />
          <p className="field__hint">
            The legs keep this thickness when you resize the overall width or depth. Both arms stay at least{' '}
            {formatLengthCompact(90, unit)} long.
          </p>
        </div>
      )}

      <div className="grid-3">
        <UnitField
          label="From left"
          value={item.x}
          unit={unit}
          min={-4000}
          max={40000}
          onChange={(mm) => store.updateItem(item.id, { x: mm })}
        />
        <UnitField
          label="From top"
          value={item.y}
          unit={unit}
          min={-4000}
          max={40000}
          onChange={(mm) => store.updateItem(item.id, { y: mm })}
        />
        <label className="field">
          <span className="field__label">Rotation</span>
          <input
            className="field__input"
            inputMode="numeric"
            value={Math.round(item.rotation)}
            onChange={(event) => {
              const parsed = Number.parseFloat(event.target.value)
              if (Number.isFinite(parsed)) store.updateItem(item.id, { rotation: parsed })
            }}
          />
        </label>
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn--small" onClick={() => store.rotateItem(item.id, -90)}>
          ⟲ 90°
        </button>
        <button type="button" className="btn btn--small" onClick={() => store.rotateItem(item.id, 90)}>
          ⟳ 90°
        </button>
        <button type="button" className="btn btn--small" onClick={() => store.duplicateItem(item.id)}>
          Duplicate
        </button>
        <button type="button" className="btn btn--small btn--danger" onClick={() => store.deleteItem(item.id)}>
          Delete
        </button>
      </div>

      <div className="field">
        <span className="field__label">Colour</span>
        <div className="swatches">
          {ITEM_COLORS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className={cx('swatch', item.color.toLowerCase() === entry.value && 'swatch--active')}
              style={{ background: entry.value }}
              aria-label={`Set colour ${entry.name}`}
              title={entry.name}
              onClick={() => store.updateItem(item.id, { color: entry.value })}
            />
          ))}
        </div>
        <p className="field__hint">The same colour is used in the 2D plan and the 3D view.</p>
      </div>

      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(item.fixed)}
            onChange={(event) => store.updateItem(item.id, { fixed: event.target.checked })}
          />
          <span>Fixture — never flagged for blocking a door</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(item.overlappable)}
            onChange={(event) => store.updateItem(item.id, { overlappable: event.target.checked })}
          />
          <span>{custom ? 'Layers over other items' : 'Layers over other items (rugs and carpets)'}</span>
        </label>
      </div>
    </div>
  )
}
