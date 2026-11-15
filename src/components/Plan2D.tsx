import { useCallback, useEffect, useRef, useState } from 'react'
import type { Room } from '../types.ts'
import {
  WALL_THICKNESS,
  WALLS,
  homeBounds,
  roomLayout,
  roomRect,
  roomToWorld,
  snapValue,
  wallLength,
  wallOutward,
  wallPoint,
  wallRuns,
  wallSegmentObb,
} from '../lib/geometry.ts'
import { formatLengthCompact, snapStep } from '../lib/units.ts'
import { normalizeColor } from '../lib/catalog.ts'
import { getProject, store, useStoreState } from '../lib/store.ts'
import { clamp } from '../lib/util.ts'
import OverlayClose from './OverlayClose.tsx'

const MIN_ZOOM = 0.006
const MAX_ZOOM = 1.4

interface Pt {
  x: number
  y: number
}

interface ViewState {
  zoom: number
  panX: number
  panY: number
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number; moved: boolean }
  | {
      kind: 'room'
      roomId: string
      startX: number
      startY: number
      originX: number
      originY: number
      moved: boolean
    }

interface Props {
  view: ViewState
  onViewChange: (view: ViewState) => void
  onOpenRoom: (roomId: string) => void
}

function wallIsShared(room: Room, wall: (typeof WALLS)[number], rooms: Room[]): boolean {
  const length = wallLength(room, wall)
  const local = wallPoint(room, wall, length / 2)
  const point = roomToWorld(room, local)
  const outward = wallOutward(wall)
  const rotation = (roomLayout(room).rotation * Math.PI) / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const worldOut = { x: outward.x * cos - outward.y * sin, y: outward.x * sin + outward.y * cos }
  const probe = { x: point.x + worldOut.x * 90, y: point.y + worldOut.y * 90 }
  return rooms.some((other) => {
    if (other.id === room.id) return false
    const rect = roomRect(other)
    return probe.x > rect.minX && probe.x < rect.maxX && probe.y > rect.minY && probe.y < rect.maxY
  })
}

export default function Plan2D({ view, onViewChange, onOpenRoom }: Props) {
  const state = useStoreState()
  const project = getProject(state)
  const rooms = project?.rooms ?? []
  const unit = project?.unit ?? 'ft'
  const step = snapStep(unit)

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 960, h: 640 })
  const [helpOpen, setHelpOpen] = useState(true)
  const [roomCardOpen, setRoomCardOpen] = useState(true)
  const viewRef = useRef(view)
  viewRef.current = view
  const setView = (next: ViewState | ((current: ViewState) => ViewState)) => {
    onViewChange(typeof next === 'function' ? next(viewRef.current) : next)
  }
  const dragRef = useRef<Drag | null>(null)
  const handledRef = useRef(false)
  const pressRef = useRef<{ child: boolean } | null>(null)

  const px = useCallback((value: number) => value / view.zoom, [view.zoom])

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const current = viewRef.current
    return {
      x: current.panX + (clientX - rect.left) / current.zoom,
      y: current.panY + (clientY - rect.top) / current.zoom,
    }
  }, [])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setSize({ w: Math.max(320, rect.width), h: Math.max(300, rect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitHome = useCallback(() => {
    if (!rooms.length) return
    const bounds = homeBounds(rooms, 500)
    const zoom = clamp(
      Math.min(
        Math.max(1, size.w - 80) / (bounds.maxX - bounds.minX),
        Math.max(1, size.h - 140) / (bounds.maxY - bounds.minY),
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    setView({
      zoom,
      panX: (bounds.minX + bounds.maxX) / 2 - size.w / (2 * zoom),
      // Leave room above the plan for the room name plates.
      panY: bounds.minY - 64 / zoom,
    })
  }, [rooms, size.w, size.h])

  const fittedRef = useRef('')
  useEffect(() => {
    if (!rooms.length) return
    const key = `${project?.id ?? ''}:${rooms.length}:${Math.round(size.w)}x${Math.round(size.h)}`
    if (fittedRef.current === key) return
    fittedRef.current = key
    fitHome()
  }, [project?.id, rooms.length, size.w, size.h, fitHome])

  const zoomBy = (factor: number) => {
    setView((current) => {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const centreX = current.panX + size.w / 2 / current.zoom
      const centreY = current.panY + size.h / 2 / current.zoom
      return { zoom, panX: centreX - size.w / 2 / zoom, panY: centreY - size.h / 2 / zoom }
    })
  }

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      setView((current) => {
        const factor = Math.exp(-event.deltaY * 0.0015)
        const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        const worldX = current.panX + screenX / current.zoom
        const worldY = current.panY + screenY / current.zoom
        return { zoom, panX: worldX - screenX / zoom, panY: worldY - screenY / zoom }
      })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const startRoomDrag = (event: React.PointerEvent, room: Room) => {
    event.stopPropagation()
    handledRef.current = true
    store.openRoom(room.id)
    const point = toWorld(event.clientX, event.clientY)
    const layout = roomLayout(room)
    dragRef.current = {
      kind: 'room',
      roomId: room.id,
      startX: point.x,
      startY: point.y,
      originX: layout.x,
      originY: layout.y,
      moved: false,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onRootPointerDown = (event: React.PointerEvent) => {
    const childHandled = handledRef.current
    handledRef.current = false
    if (dragRef.current) return
    pressRef.current = { child: childHandled }
    dragRef.current = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'pan') {
      const dx = (event.clientX - drag.startX) / view.zoom
      const dy = (event.clientY - drag.startY) / view.zoom
      if (Math.abs(event.clientX - drag.startX) > 2 || Math.abs(event.clientY - drag.startY) > 2) {
        drag.moved = true
      }
      setView((current) => ({ ...current, panX: drag.panX - dx, panY: drag.panY - dy }))
      return
    }
    const point = toWorld(event.clientX, event.clientY)
    const dx = point.x - drag.startX
    const dy = point.y - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) * view.zoom < 3) return
      drag.moved = true
      store.beginInteraction()
    }
    store.moveRoomLayout(
      drag.roomId,
      snapValue(drag.originX + dx, step, state.snapping),
      snapValue(drag.originY + dy, step, state.snapping),
    )
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    const press = pressRef.current
    if (drag?.kind === 'pan' && !drag.moved && press && !press.child) store.setSelection(null)
    dragRef.current = null
    pressRef.current = null
    handledRef.current = false
  }

  const selectedRoom =
    state.selection?.kind === 'room'
      ? rooms.find((room) => room.id === state.selection?.id) ?? rooms.find((room) => room.id === state.roomId)
      : rooms.find((room) => room.id === state.roomId)

  const gridStep = (() => {
    const candidates = [500, 1000, 2000, 5000, 10000]
    return candidates.find((candidate) => candidate * view.zoom >= 10) ?? 20000
  })()
  const gridOrigin = {
    x: Math.floor(view.panX / gridStep) * gridStep,
    y: Math.floor(view.panY / gridStep) * gridStep,
  }
  const gridWidth = size.w / view.zoom + gridStep * 2
  const gridHeight = size.h / view.zoom + gridStep * 2
  const gridId = `plan-grid-${gridStep}-${Math.round(view.zoom * 1000)}`
  const totalArea = rooms.reduce((sum, room) => sum + room.length * room.width, 0) / 1_000_000

  if (!project) {
    return (
      <div className="stage stage--empty" ref={wrapRef}>
        <div className="empty-card">
          <h2>No project open</h2>
          <p>Create a project to arrange its rooms side by side.</p>
        </div>
      </div>
    )
  }

  if (!rooms.length) {
    return (
      <div className="stage stage--empty" ref={wrapRef}>
        <div className="empty-card">
          <h2>No rooms to arrange</h2>
          <p>Add a room first — it will appear here in the whole-home plan.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="stage" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="editor-svg"
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={onRootPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id={gridId} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`} fill="none" stroke="#e7e1d6" strokeWidth={px(1)} />
          </pattern>
        </defs>

        <g transform={`translate(${-view.panX * view.zoom} ${-view.panY * view.zoom}) scale(${view.zoom})`}>
          <rect x={gridOrigin.x} y={gridOrigin.y} width={gridWidth} height={gridHeight} fill={`url(#${gridId})`} />

          {rooms.map((room) => {
            const layout = roomLayout(room)
            const runs = wallRuns(room)
            const selected = state.selection?.kind === 'room' && state.selection.id === room.id
            return (
              <g
                key={room.id}
                transform={`translate(${layout.x} ${layout.y}) rotate(${layout.rotation}) translate(${-room.length / 2} ${-room.width / 2})`}
                onPointerDown={(event) => startRoomDrag(event, room)}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  onOpenRoom(room.id)
                }}
                style={{ cursor: 'move' }}
              >
                <rect x={0} y={0} width={room.length} height={room.width} fill="#faf5ec" />
                <g pointerEvents="none">
                  {WALLS.map((wall) => {
                    if (wallIsShared(room, wall, rooms)) return null
                    const run = runs.find((entry) => entry.wall === wall)
                    if (!run) return null
                    return run.segments.map(([start, end]) => {
                      const obb = wallSegmentObb(room, wall, start, end, WALL_THICKNESS)
                      return (
                        <rect
                          key={`${wall}-${start}-${end}`}
                          x={obb.x - obb.w / 2}
                          y={obb.y - obb.d / 2}
                          width={obb.w}
                          height={obb.d}
                          fill="#e6dbc8"
                          stroke="#cec1ab"
                          strokeWidth={px(0.8)}
                        />
                      )
                    })
                  })}
                  {room.openings.map((opening) => {
                    const horizontal = opening.wall === 'n' || opening.wall === 's'
                    const start = wallPoint(room, opening.wall, opening.offset)
                    const end = wallPoint(room, opening.wall, opening.offset + opening.width)
                    const x = horizontal
                      ? Math.min(start.x, end.x)
                      : opening.wall === 'w'
                        ? 0
                        : room.length - WALL_THICKNESS
                    const y = horizontal
                      ? opening.wall === 'n'
                        ? 0
                        : room.width - WALL_THICKNESS
                      : Math.min(start.y, end.y)
                    return (
                      <rect
                        key={opening.id}
                        x={x}
                        y={y}
                        width={horizontal ? opening.width : WALL_THICKNESS}
                        height={horizontal ? WALL_THICKNESS : opening.width}
                        fill={opening.type === 'door' ? '#f7f1e7' : '#e7f0f4'}
                        stroke="#c9d3d8"
                        strokeWidth={px(0.8)}
                      />
                    )
                  })}
                  {room.items.map((item) => (
                    <g key={item.id} transform={`rotate(${item.rotation} ${item.x} ${item.y})`}>
                      {item.shape === 'round' ? (
                        <ellipse
                          cx={item.x}
                          cy={item.y}
                          rx={item.w / 2}
                          ry={item.d / 2}
                          fill={normalizeColor(item.color)}
                          opacity={0.92}
                        />
                      ) : (
                        <rect
                          x={item.x - item.w / 2}
                          y={item.y - item.d / 2}
                          width={item.w}
                          height={item.d}
                          rx={Math.min(40, item.w * 0.04)}
                          fill={normalizeColor(item.color)}
                          opacity={0.92}
                        />
                      )}
                    </g>
                  ))}
                </g>
                {selected && (
                  <rect
                    x={-px(10)}
                    y={-px(10)}
                    width={room.length + px(20)}
                    height={room.width + px(20)}
                    fill="none"
                    stroke="#a86a4e"
                    strokeWidth={px(2)}
                    strokeDasharray={`${px(9)} ${px(6)}`}
                    pointerEvents="none"
                  />
                )}
              </g>
            )
          })}

          {/* Names sit just above each room so they stay upright at any rotation. */}
          <g pointerEvents="none">
            {rooms.map((room) => {
              const rect = roomRect(room)
              const label = `${room.name}  ${formatLengthCompact(room.length, unit)} × ${formatLengthCompact(room.width, unit)}`
              const width = label.length * 6.1 + 22
              const top = rect.minY - 34 / view.zoom
              return (
                <g key={`label-${room.id}`}>
                  <rect
                    x={rect.minX + (rect.maxX - rect.minX) / 2 - width / 2 / view.zoom}
                    y={top}
                    width={width / view.zoom}
                    height={20 / view.zoom}
                    rx={10 / view.zoom}
                    fill="rgba(253, 251, 247, 0.94)"
                    stroke="#e3dacd"
                    strokeWidth={px(1)}
                  />
                  <text
                    x={rect.minX + (rect.maxX - rect.minX) / 2}
                    y={top + 10 / view.zoom}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={11 / view.zoom}
                    fill="#4b4339"
                  >
                    {label}
                  </text>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="stage__overlay stage__overlay--left">
        {helpOpen && (
          <div className="card card--caption">
            <OverlayClose label="Close whole-home tips" onClose={() => setHelpOpen(false)} />
            <span className="pill pill--muted">Whole home</span>
            <h3 className="card__title card__title--lead">{project.name}</h3>
            <p className="muted small">
              {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} · {totalArea.toFixed(1)} m² · drag a room to move
              it, double-click to edit it.
            </p>
          </div>
        )}
        {selectedRoom && roomCardOpen && (
          <div className="card card--caption">
            <OverlayClose label="Close room controls" onClose={() => setRoomCardOpen(false)} />
            <div className="card__head">
              <span className="card__title">{selectedRoom.name}</span>
              <span className="pill">{roomLayout(selectedRoom).rotation}°</span>
            </div>
            <div className="btn-row btn-row--tight">
              <button type="button" className="btn btn--small" onClick={() => store.rotateRoomLayout(selectedRoom.id, -90)}>
                ⟲ Rotate
              </button>
              <button type="button" className="btn btn--small" onClick={() => store.rotateRoomLayout(selectedRoom.id, 90)}>
                ⟳ Rotate
              </button>
              <button
                type="button"
                className="btn btn--small btn--primary"
                onClick={() => onOpenRoom(selectedRoom.id)}
              >
                Edit room
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stage__overlay stage__overlay--right">
        <div className="view-chips">
          <div className="view-chips__row">
            <button
              type="button"
              className="chip"
              aria-pressed={helpOpen}
              onClick={() => setHelpOpen(!helpOpen)}
              title="Show or hide the whole-home tips"
            >
              Help
            </button>
            {selectedRoom && (
              <button
                type="button"
                className="chip"
                aria-pressed={roomCardOpen}
                onClick={() => setRoomCardOpen(!roomCardOpen)}
                title="Show or hide the room controls"
              >
                Room controls
              </button>
            )}
          </div>
        </div>
        <div className="zoom-group">
          <button type="button" className="zoom-btn" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-value">{Math.round(view.zoom * 1000) / 10}%</span>
          <button type="button" className="zoom-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="zoom-btn zoom-btn--wide" onClick={fitHome}>
            Fit home
          </button>
        </div>
      </div>
    </div>
  )
}
