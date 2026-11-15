import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FurnitureItem, Opening, Room, Wall } from '../types.ts'
import {
  WALL_THICKNESS,
  WALLS,
  doorSwingGeometry,
  issuesByItem,
  itemPolygon,
  roomFitIssues,
  snapValue,
  sortForDisplay,
  wallLength,
  wallPoint,
  wallRuns,
  wallSegmentObb,
} from '../lib/geometry.ts'
import { normalizeColor } from '../lib/catalog.ts'
import { formatLengthCompact, snapStep } from '../lib/units.ts'
import {
  getProject,
  getRoom,
  getSelectedItem,
  getSelectedOpening,
  store,
  useStoreState,
} from '../lib/store.ts'
import { clamp, cx, tidyMm } from '../lib/util.ts'
import OverlayClose from './OverlayClose.tsx'

const MIN_ZOOM = 0.012
const MAX_ZOOM = 1.8
const MIN_ITEM = 150

interface Pt {
  x: number
  y: number
}

interface ViewState {
  /** Screen pixels per millimetre. */
  zoom: number
  /** World millimetre coordinate at the top-left of the viewport. */
  panX: number
  panY: number
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number; moved: boolean }
  | { kind: 'move'; itemId: string; dx: number; dy: number }
  | { kind: 'resize'; itemId: string; signX: number; signY: number; fixed: Pt; rotation: number }
  | { kind: 'rotate'; itemId: string }
  | { kind: 'opening'; openingId: string; width: number }

function openingBandRect(room: Room, opening: Opening) {
  const start = wallPoint(room, opening.wall, opening.offset)
  const end = wallPoint(room, opening.wall, opening.offset + opening.width)
  const horizontal = opening.wall === 'n' || opening.wall === 's'
  if (horizontal) {
    return {
      x: Math.min(start.x, end.x),
      y: opening.wall === 'n' ? 0 : room.width - WALL_THICKNESS,
      w: opening.width,
      h: WALL_THICKNESS,
      horizontal,
    }
  }
  return {
    x: opening.wall === 'w' ? 0 : room.length - WALL_THICKNESS,
    y: Math.min(start.y, end.y),
    w: WALL_THICKNESS,
    h: opening.width,
    horizontal,
  }
}

function nearestWall(room: Room, point: Pt): { wall: Wall; offset: number; distance: number } {
  let best: { wall: Wall; offset: number; distance: number } = { wall: 'n', offset: 0, distance: Infinity }
  for (const wall of WALLS) {
    const length = wallLength(room, wall)
    const raw =
      wall === 'n'
        ? point.x
        : wall === 'e'
          ? point.y
          : wall === 's'
            ? room.length - point.x
            : room.width - point.y
    const offset = clamp(raw, 0, length)
    const anchor = wallPoint(room, wall, offset)
    const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y)
    if (distance < best.distance) best = { wall, offset, distance }
  }
  return best
}

interface Props {
  view: ViewState
  onViewChange: (view: ViewState) => void
  onAddRoom: () => void
  onAddProject: () => void
}

export default function Editor2D({ view, onViewChange, onAddRoom, onAddProject }: Props) {
  const state = useStoreState()
  const project = getProject(state)
  const room = getRoom(state)
  const unit = project?.unit ?? 'ft'
  const step = snapStep(unit)
  const snapping = state.snapping

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 960, h: 640 })
  const viewRef = useRef(view)
  viewRef.current = view
  const setView = (next: ViewState | ((current: ViewState) => ViewState)) => {
    onViewChange(typeof next === 'function' ? next(viewRef.current) : next)
  }
  const dragRef = useRef<Drag | null>(null)
  const handledRef = useRef(false)
  const pressRef = useRef<{ child: boolean } | null>(null)
  const [fitOpen, setFitOpen] = useState(false)
  const [tipsOpen, setTipsOpen] = useState(true)
  const [note, setNote] = useState<{ itemId: string; text: string; at: number } | null>(null)

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

  // -------------------------------------------------------------- viewport

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

  const fitRoom = useCallback(() => {
    if (!room) return
    const pad = 1100
    const zoom = clamp(
      Math.min(size.w / (room.length + pad), size.h / (room.width + pad)),
      MIN_ZOOM,
      MAX_ZOOM,
    )
    setView({
      zoom,
      panX: room.length / 2 - size.w / (2 * zoom),
      panY: room.width / 2 - size.h / (2 * zoom),
    })
  }, [room, size.w, size.h])

  const fittedRef = useRef('')
  useEffect(() => {
    if (!room) return
    const key = `${room.id}:${Math.round(size.w)}x${Math.round(size.h)}`
    if (fittedRef.current === key) return
    fittedRef.current = key
    fitRoom()
  }, [room, size.w, size.h, fitRoom])

  const zoomBy = (factor: number) => {
    setView((current) => {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const centreX = current.panX + size.w / 2 / current.zoom
      const centreY = current.panY + size.h / 2 / current.zoom
      return {
        zoom,
        panX: centreX - size.w / 2 / zoom,
        panY: centreY - size.h / 2 / zoom,
      }
    })
  }

  // Native wheel handler so zooming can prevent the page from scrolling.
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

  // ------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return
      const snapshot = store.getSnapshot()
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (meta && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && key === 'y') {
        event.preventDefault()
        store.redo()
        return
      }
      const item = getSelectedItem(snapshot)
      const opening = getSelectedOpening(snapshot)
      if (meta && key === 'd') {
        if (item) {
          event.preventDefault()
          store.duplicateItem(item.id)
        }
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (item) {
          event.preventDefault()
          store.deleteItem(item.id)
        } else if (opening) {
          event.preventDefault()
          store.deleteOpening(opening.id)
        }
        return
      }
      if (event.key === 'Escape') {
        store.setSelection(null)
        return
      }
      if (!item) return
      const unitForStep = getProject(snapshot)?.unit ?? 'ft'
      const nudge = event.shiftKey ? snapStep(unitForStep) * 5 : snapStep(unitForStep)
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        store.nudgeItem(item.id, -nudge, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        store.nudgeItem(item.id, nudge, 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        store.nudgeItem(item.id, 0, -nudge)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        store.nudgeItem(item.id, 0, nudge)
      } else if (key === 'r') {
        event.preventDefault()
        store.rotateItem(item.id, event.shiftKey ? -90 : 90)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------------------------------------------------------- interactions

  const beginDrag = (event: React.PointerEvent, drag: Drag) => {
    dragRef.current = drag
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const startMove = (event: React.PointerEvent, item: FurnitureItem) => {
    event.stopPropagation()
    handledRef.current = true
    store.setSelection({ kind: 'item', id: item.id })
    const point = toWorld(event.clientX, event.clientY)
    store.beginInteraction()
    beginDrag(event, { kind: 'move', itemId: item.id, dx: item.x - point.x, dy: item.y - point.y })
  }

  const startResize = (event: React.PointerEvent, item: FurnitureItem, signX: number, signY: number) => {
    event.stopPropagation()
    handledRef.current = true
    const rad = (item.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const localX = (-signX * item.w) / 2
    const localY = (-signY * item.d) / 2
    const fixed = {
      x: item.x + localX * cos - localY * sin,
      y: item.y + localX * sin + localY * cos,
    }
    store.setSelection({ kind: 'item', id: item.id })
    store.beginInteraction()
    beginDrag(event, { kind: 'resize', itemId: item.id, signX, signY, fixed, rotation: item.rotation })
  }

  const startRotate = (event: React.PointerEvent, item: FurnitureItem) => {
    event.stopPropagation()
    handledRef.current = true
    store.setSelection({ kind: 'item', id: item.id })
    store.beginInteraction()
    beginDrag(event, { kind: 'rotate', itemId: item.id })
  }

  const startOpeningDrag = (event: React.PointerEvent, opening: Opening) => {
    event.stopPropagation()
    handledRef.current = true
    store.setSelection({ kind: 'opening', id: opening.id })
    store.beginInteraction()
    beginDrag(event, { kind: 'opening', openingId: opening.id, width: opening.width })
  }

  const onRootPointerDown = (event: React.PointerEvent) => {
    const childHandled = handledRef.current
    handledRef.current = false
    if (dragRef.current) return
    pressRef.current = { child: childHandled }
    beginDrag(event, {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false,
    })
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

    const liveRoom = getRoom(store.getSnapshot())
    if (!liveRoom) return
    const point = toWorld(event.clientX, event.clientY)

    if (drag.kind === 'move') {
      store.updateItemLive(drag.itemId, {
        x: tidyMm(snapValue(point.x + drag.dx, step, snapping)),
        y: tidyMm(snapValue(point.y + drag.dy, step, snapping)),
      })
      return
    }

    if (drag.kind === 'resize') {
      const rad = (drag.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = point.x - drag.fixed.x
      const dy = point.y - drag.fixed.y
      const localX = dx * cos + dy * sin
      const localY = -dx * sin + dy * cos
      const w = Math.max(MIN_ITEM, snapValue(Math.abs(localX), step, snapping))
      const d = Math.max(MIN_ITEM, snapValue(Math.abs(localY), step, snapping))
      const signX = localX >= 0 ? 1 : -1
      const signY = localY >= 0 ? 1 : -1
      store.updateItemLive(drag.itemId, {
        w: tidyMm(w),
        d: tidyMm(d),
        x: tidyMm(drag.fixed.x + ((cos * (signX * w)) / 2 - (sin * (signY * d)) / 2)),
        y: tidyMm(drag.fixed.y + ((sin * (signX * w)) / 2 + (cos * (signY * d)) / 2)),
      })
      return
    }

    if (drag.kind === 'rotate') {
      const item = liveRoom.items.find((entry) => entry.id === drag.itemId)
      if (!item) return
      const angle = (Math.atan2(point.y - item.y, point.x - item.x) * 180) / Math.PI + 90
      store.updateItemLive(drag.itemId, { rotation: ((Math.round(angle / 15) * 15) % 360 + 360) % 360 })
      return
    }

    const near = nearestWall(liveRoom, point)
    store.moveOpening(
      drag.openingId,
      near.wall,
      tidyMm(snapValue(near.offset - drag.width / 2, step, snapping)),
    )
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    const press = pressRef.current
    if (drag?.kind === 'pan' && !drag.moved && press && !press.child) store.setSelection(null)
    if (drag && (drag.kind === 'move' || drag.kind === 'resize' || drag.kind === 'rotate')) {
      const liveRoom = getRoom(store.getSnapshot())
      const liveItem = liveRoom?.items.find((item) => item.id === drag.itemId)
      const issue = liveRoom
        ? roomFitIssues(liveRoom).find((entry) => entry.itemIds.includes(drag.itemId))
        : undefined
      if (liveItem && issue) setNote({ itemId: liveItem.id, text: issue.message, at: Date.now() })
    }
    dragRef.current = null
    pressRef.current = null
    handledRef.current = false
  }

  // ------------------------------------------------------------ derived data

  const issues = useMemo(() => (room ? roomFitIssues(room) : []), [room])
  const issueMap = useMemo(() => issuesByItem(issues), [issues])
  const runs = useMemo(() => (room ? wallRuns(room) : []), [room])

  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), 2800)
    return () => clearTimeout(timer)
  }, [note])

  useEffect(() => {
    if (issues.length === 0) setFitOpen(false)
  }, [issues.length])

  const gridStep = useMemo(() => {
    const candidates = [50, 100, 250, 500, 1000, 2000, 5000, 10000]
    const visible = candidates.find((candidate) => candidate * view.zoom >= 9)
    return visible ?? 20000
  }, [view.zoom])

  const selectedItem =
    state.selection?.kind === 'item' ? room?.items.find((item) => item.id === state.selection?.id) : undefined
  const selectedOpening =
    state.selection?.kind === 'opening'
      ? room?.openings.find((opening) => opening.id === state.selection?.id)
      : undefined
  const noteItem = note ? room?.items.find((item) => item.id === note.itemId) : undefined

  const gridOrigin = { x: Math.floor(view.panX / gridStep) * gridStep, y: Math.floor(view.panY / gridStep) * gridStep }
  const gridWidth = size.w / view.zoom + gridStep * 2
  const gridHeight = size.h / view.zoom + gridStep * 2
  const gridId = `grid-${gridStep}-${Math.round(view.zoom * 1000)}`

  const renderFootprint = (item: FurnitureItem, props: React.SVGProps<SVGPathElement | SVGRectElement | SVGEllipseElement | SVGPolygonElement>) => {
    const x = item.x - item.w / 2
    const y = item.y - item.d / 2
    if (item.shape === 'round') {
      return <ellipse cx={item.x} cy={item.y} rx={item.w / 2} ry={item.d / 2} {...(props as React.SVGProps<SVGEllipseElement>)} />
    }
    if (item.shape === 'lshape') {
      const points = itemPolygon(item)
        .map((point) => `${point.x},${point.y}`)
        .join(' ')
      return <polygon points={points} {...(props as React.SVGProps<SVGPolygonElement>)} />
    }
    return (
      <rect
        x={x}
        y={y}
        width={item.w}
        height={item.d}
        rx={Math.min(60, item.w * 0.04)}
        {...(props as React.SVGProps<SVGRectElement>)}
      />
    )
  }

  const chip = (x: number, y: number, text: string, rotate = 0) => {
    const width = text.length * 7.4 + 16
    return (
      <g transform={`translate(${x} ${y}) rotate(${rotate})`} pointerEvents="none">
        <rect
          x={-width / 2}
          y={px(-9)}
          width={width}
          height={px(18)}
          rx={px(9)}
          fill="#fdfbf7"
          stroke="#e3dacd"
          strokeWidth={px(1)}
        />
        <text
          x={0}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={px(11)}
          fill="#6d6459"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {text}
        </text>
      </g>
    )
  }

  if (!project) {
    return (
      <div className="stage stage--empty" ref={wrapRef}>
        <div className="empty-card">
          <h2>Welcome to Roomscape</h2>
          <p>Plan a home in a scaled 2D editor, then preview each room in isometric 3D.</p>
          <div className="empty-card__actions">
            <button type="button" className="btn btn--primary" onClick={onAddProject}>
              Create a project
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                store.addSampleProject()
              }}
            >
              Load the sample home
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="stage stage--empty" ref={wrapRef}>
        <div className="empty-card">
          <h2>No rooms yet</h2>
          <p>Rooms start from their length and width — you can change both later.</p>
          <div className="empty-card__actions">
            <button type="button" className="btn btn--primary" onClick={onAddRoom}>
              Add a room
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                store.addSampleProject()
              }}
            >
              Load the sample home
            </button>
          </div>
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
        style={{ cursor: dragRef.current?.kind === 'pan' ? 'grabbing' : 'default' }}
      >
        <defs>
          <pattern id={gridId} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <path
              d={`M ${gridStep} 0 L 0 0 0 ${gridStep}`}
              fill="none"
              stroke="#e7e1d6"
              strokeWidth={px(1)}
            />
          </pattern>
          <pattern
            id={`${gridId}-major`}
            width={gridStep * 5}
            height={gridStep * 5}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridStep * 5} 0 L 0 0 0 ${gridStep * 5}`}
              fill="none"
              stroke="#ddd5c7"
              strokeWidth={px(1.4)}
            />
          </pattern>
        </defs>

        <g transform={`translate(${-view.panX * view.zoom} ${-view.panY * view.zoom}) scale(${view.zoom})`}>
          <rect x={gridOrigin.x} y={gridOrigin.y} width={gridWidth} height={gridHeight} fill={`url(#${gridId})`} />
          <rect
            x={gridOrigin.x}
            y={gridOrigin.y}
            width={gridWidth}
            height={gridHeight}
            fill={`url(#${gridId}-major)`}
          />

          {/* Floor */}
          <rect
            x={0}
            y={0}
            width={room.length}
            height={room.width}
            fill="#faf5ec"
            onPointerDown={() => store.setSelection({ kind: 'room', id: room.id })}
          />

          {/* Walls with door and window openings */}
          <g>
            {runs.map((run) =>
              run.segments.map(([start, end]) => {
                const obb = wallSegmentObb(room, run.wall, start, end)
                return (
                  <rect
                    key={`${run.wall}-${start}-${end}`}
                    x={obb.x - obb.w / 2}
                    y={obb.y - obb.d / 2}
                    width={obb.w}
                    height={obb.d}
                    fill="#e6dbc8"
                    stroke="#cec1ab"
                    strokeWidth={px(1)}
                    onPointerDown={() => store.setSelection({ kind: 'room', id: room.id })}
                  />
                )
              }),
            )}
          </g>

          {/* Openings */}
          <g>
            {room.openings.map((opening) => {
              const band = openingBandRect(room, opening)
              const selected = selectedOpening?.id === opening.id
              const door = opening.type === 'door' ? doorSwingGeometry(room, opening) : null
              return (
                <g key={opening.id}>
                  <rect
                    x={band.x}
                    y={band.y}
                    width={band.w}
                    height={band.h}
                    fill={opening.type === 'door' ? '#fbf7f0' : '#eef4f6'}
                    stroke="#c9d3d8"
                    strokeWidth={px(1)}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(event) => startOpeningDrag(event, opening)}
                  />
                  {opening.type === 'window' ? (
                    <line
                      x1={band.x + (band.horizontal ? 0 : band.w / 2)}
                      y1={band.y + (band.horizontal ? band.h / 2 : 0)}
                      x2={band.x + (band.horizontal ? band.w : band.w / 2)}
                      y2={band.y + (band.horizontal ? band.h / 2 : band.h)}
                      stroke="#a7bac4"
                      strokeWidth={px(2.5)}
                      pointerEvents="none"
                    />
                  ) : door ? (
                    <g pointerEvents="none">
                      <polyline
                        points={door.arc.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill="none"
                        stroke="#b09a83"
                        strokeWidth={px(1.1)}
                        strokeDasharray={`${px(4)} ${px(3)}`}
                      />
                      <line
                        x1={door.hinge.x}
                        y1={door.hinge.y}
                        x2={door.tip.x}
                        y2={door.tip.y}
                        stroke="#9c8770"
                        strokeWidth={px(2.4)}
                        strokeLinecap="round"
                      />
                      <circle cx={door.hinge.x} cy={door.hinge.y} r={px(3.2)} fill="#8c7458" />
                    </g>
                  ) : null}
                  {selected && (
                    <rect
                      x={band.x - px(2)}
                      y={band.y - px(2)}
                      width={band.w + px(4)}
                      height={band.h + px(4)}
                      fill="none"
                      stroke="#8a7563"
                      strokeWidth={px(1.6)}
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}
          </g>

          {/* Furniture */}
          <g>
            {sortForDisplay(room.items).map((item) => {
              const selected = selectedItem?.id === item.id
              const flagged = state.showWarnings && issueMap.has(item.id)
              return (
                <g key={item.id} transform={`rotate(${item.rotation} ${item.x} ${item.y})`}>
                  {renderFootprint(item, {
                    fill: normalizeColor(item.color),
                    stroke: selected ? '#6f5f4e' : '#00000022',
                    strokeWidth: px(selected ? 1.6 : 1),
                    style: { cursor: 'move' },
                    onPointerDown: (event: React.PointerEvent) => startMove(event, item),
                  })}
                  {flagged && (
                    <g pointerEvents="none">
                      {renderFootprint(item, {
                        fill: 'none',
                        stroke: '#c98a2c',
                        strokeWidth: px(2.4),
                        strokeDasharray: `${px(6)} ${px(4)}`,
                      })}
                    </g>
                  )}
                </g>
              )
            })}
          </g>

          {/* Labels stay horizontal whichever way an item is rotated */}
          <g pointerEvents="none">
            {room.items.map((item) => {
              const onScreen = Math.max(item.w, item.d) * view.zoom
              if (onScreen < 46) return null
              const selected = selectedItem?.id === item.id
              return (
                <g key={`label-${item.id}`} transform={`translate(${item.x} ${item.y})`}>
                  <text
                    y={px(selected && state.showDimensions ? -3 : 2)}
                    textAnchor="middle"
                    fontSize={px(11)}
                    fill="#4b4339"
                    fontWeight={500}
                  >
                    {item.name}
                  </text>
                  {state.showDimensions && (
                    <text
                      y={px(12)}
                      textAnchor="middle"
                      fontSize={px(9.5)}
                      fill="#8a8175"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatLengthCompact(item.w, unit)} × {formatLengthCompact(item.d, unit)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {/* Dimension lines */}
          {state.showDimensions && (
            <g pointerEvents="none">
              <line x1={0} y1={0} x2={0} y2={room.width + 420} stroke="#cfc4b2" strokeWidth={px(1)} />
              <line
                x1={room.length}
                y1={0}
                x2={room.length}
                y2={room.width + 420}
                stroke="#cfc4b2"
                strokeWidth={px(1)}
              />
              <line
                x1={0}
                y1={room.width + 320}
                x2={room.length}
                y2={room.width + 320}
                stroke="#a99b86"
                strokeWidth={px(1.2)}
              />              <line x1={-420} y1={0} x2={-420} y2={room.width} stroke="#cfc4b2" strokeWidth={px(1)} />
              <line x1={-380} y1={0} x2={0} y2={0} stroke="#cfc4b2" strokeWidth={px(1)} />
              <line
                x1={-380}
                y1={room.width}
                x2={0}
                y2={room.width}
                stroke="#cfc4b2"
                strokeWidth={px(1)}
              />
              <line x1={-320} y1={0} x2={-320} y2={room.width} stroke="#a99b86" strokeWidth={px(1.2)} />
              {chip(room.length / 2, room.width + 320, formatLengthCompact(room.length, unit))}
              {chip(-320, room.width / 2, formatLengthCompact(room.width, unit), -90)}
            </g>
          )}

          {/* Selection controls */}
          {selectedItem && (
            <g transform={`rotate(${selectedItem.rotation} ${selectedItem.x} ${selectedItem.y})`}>
              <rect
                x={selectedItem.x - selectedItem.w / 2}
                y={selectedItem.y - selectedItem.d / 2}
                width={selectedItem.w}
                height={selectedItem.d}
                fill="none"
                stroke="#6f5f4e"
                strokeWidth={px(1.5)}
                strokeDasharray={`${px(7)} ${px(4)}`}
                pointerEvents="none"
              />
              {(
                [
                  [-1, -1],
                  [1, -1],
                  [1, 1],
                  [-1, 1],
                ] as Array<[number, number]>
              ).map(([signX, signY]) => (
                <rect
                  key={`${signX}${signY}`}
                  x={selectedItem.x + (signX * selectedItem.w) / 2 - px(4.5)}
                  y={selectedItem.y + (signY * selectedItem.d) / 2 - px(4.5)}
                  width={px(9)}
                  height={px(9)}
                  rx={px(2)}
                  fill="#fffdf9"
                  stroke="#6f5f4e"
                  strokeWidth={px(1.4)}
                  style={{ cursor: signX === signY ? 'nwse-resize' : 'nesw-resize' }}
                  onPointerDown={(event) => startResize(event, selectedItem, signX, signY)}
                />
              ))}
              <line
                x1={selectedItem.x}
                y1={selectedItem.y - selectedItem.d / 2}
                x2={selectedItem.x}
                y2={selectedItem.y - selectedItem.d / 2 - px(26)}
                stroke="#6f5f4e"
                strokeWidth={px(1.2)}
                pointerEvents="none"
              />
              <circle
                cx={selectedItem.x}
                cy={selectedItem.y - selectedItem.d / 2 - px(30)}
                r={px(7)}
                fill="#fffdf9"
                stroke="#6f5f4e"
                strokeWidth={px(1.4)}
                style={{ cursor: 'grab' }}
                onPointerDown={(event) => startRotate(event, selectedItem)}
              />
            </g>
          )}
        </g>
      </svg>

      {note && noteItem && state.showWarnings && (
        <div
          className="item-note"
          role="status"
          style={{
            left: clamp((noteItem.x - view.panX) * view.zoom, 12, Math.max(12, size.w - 210)),
            top: clamp((noteItem.y - noteItem.d / 2 - view.panY) * view.zoom - 36, 12, Math.max(12, size.h - 46)),
          }}
        >
          <span>{note.text}</span>
          <button
            type="button"
            className="item-note__close"
            aria-label="Dismiss this note"
            onClick={() => setNote(null)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      {state.showWarnings && issues.length > 0 && (
        <div className="stage__overlay stage__overlay--left stage__overlay--bottom">
          {fitOpen ? (
            <div className="fit-pop">
              <div className="fit-pop__head">
                <span className="card__title">Fit check</span>
                <button
                  type="button"
                  className="icon-btn icon-btn--tiny"
                  onClick={() => setFitOpen(false)}
                  aria-label="Close fit check"
                >
                  ×
                </button>
              </div>
              <ul className="issue-list">
                {issues.slice(0, 8).map((issue) => (
                  <li key={issue.id} className="issue">
                    <span className={cx('issue__dot', `issue__dot--${issue.kind}`)} />
                    <span className="issue__text">{issue.message}</span>
                    <button
                      type="button"
                      className="issue__link"
                      onClick={() => {
                        const first = issue.itemIds[0]
                        if (first) store.setSelection({ kind: 'item', id: first })
                      }}
                    >
                      Select
                    </button>
                  </li>
                ))}
                {issues.length > 8 && <li className="muted small">and {issues.length - 8} more…</li>}
              </ul>
              <p className="muted small">Select an item to fix it. Warnings can be switched off in the top-right controls.</p>
            </div>
          ) : (
            <button
              type="button"
              className="fit-badge"
              onClick={() => setFitOpen(true)}
              aria-label="Open the fit check"
            >
              <span className="fit-badge__dot" aria-hidden="true" />
              {issues.length} {issues.length === 1 ? 'fit issue' : 'fit issues'}
              <span className="fit-badge__chevron" aria-hidden="true">
                ▾
              </span>
            </button>
          )}
        </div>
      )}

      <div className="stage__overlay stage__overlay--right">
        <div className="view-chips">
          <div className="view-chips__row">
            <button
              type="button"
              className="chip"
              aria-pressed={state.snapping}
              onClick={() => store.setSnapping(!state.snapping)}
              title="Snap positions and sizes to the measurement grid"
            >
              Snap {state.snapping ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={state.showDimensions}
              onClick={() => store.setDimensionsVisible(!state.showDimensions)}
            >
              Dimensions {state.showDimensions ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={state.showWarnings}
              onClick={() => store.setWarningsVisible(!state.showWarnings)}
              title="Show temporary warnings while arranging furniture"
            >
              Warnings {state.showWarnings ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={tipsOpen}
              onClick={() => setTipsOpen(!tipsOpen)}
              title="Show or hide the canvas tips"
            >
              Tips
            </button>
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
          <button type="button" className="zoom-btn zoom-btn--wide" onClick={fitRoom}>
            Fit
          </button>
        </div>
        {tipsOpen && (
          <div className="card card--caption card--tips">
            <OverlayClose label="Close canvas tips" onClose={() => setTipsOpen(false)} />
            <span className="card__title">Canvas tips</span>
            <p className="muted small">
              Drag empty space to pan · scroll to zoom · grid {formatLengthCompact(gridStep, unit)}
            </p>
            <p className="muted small">
              Drag an item to move it, use its corner handles to resize, or open the properties panel for exact sizes.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
