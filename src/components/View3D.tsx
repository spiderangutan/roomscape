import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildHomeScene, buildScene, faceColor, type Scene, type Solid, type Vec3 } from '../lib/scene3d.ts'
import {
  clampItemInsideRoom,
  itemObb,
  rectCorners,
  roomFromWorld,
  roomToWorld,
  snapValue,
} from '../lib/geometry.ts'
import { getItemRoom, getProject, getRoom, getSelectedItem, store, useStoreState } from '../lib/store.ts'
import { ITEM_COLORS } from '../lib/catalog.ts'
import { formatLengthCompact, snapStep } from '../lib/units.ts'
import { clamp, cx, tidyMm } from '../lib/util.ts'
import OverlayClose from './OverlayClose.tsx'

interface Camera {
  yaw: number
  pitch: number
  /** Screen pixels per millimetre. */
  zoom: number
  panX: number
  panY: number
  target: Vec3
}

interface Pt {
  x: number
  y: number
}

const DEFAULT_YAW = Math.PI / 4
const DEFAULT_PITCH = 0.6155
const MIN_ZOOM = 0.004
const MAX_ZOOM = 0.6

const WALL_PRESETS: Array<{ id: 'low' | 'mid' | 'full'; label: string; fraction: number }> = [
  { id: 'low', label: 'Low walls', fraction: 0.34 },
  { id: 'mid', label: 'Mid walls', fraction: 0.62 },
  { id: 'full', label: 'Full walls', fraction: 1 },
]

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function towards(camera: Camera): Vec3 {
  const cosPitch = Math.cos(camera.pitch)
  return [cosPitch * Math.sin(camera.yaw), Math.sin(camera.pitch), cosPitch * Math.cos(camera.yaw)]
}

type Projector = (point: Vec3) => { x: number; y: number; depth: number }

function cameraBasis(camera: Camera) {
  const toCamera = towards(camera)
  const forward: Vec3 = [-toCamera[0], -toCamera[1], -toCamera[2]]
  const rawRight = cross(forward, [0, 1, 0])
  const length = Math.hypot(rawRight[0], rawRight[1], rawRight[2])
  const right: Vec3 =
    length < 1e-6 ? [1, 0, 0] : [rawRight[0] / length, rawRight[1] / length, rawRight[2] / length]
  const up = cross(right, forward)
  return { toCamera, forward, right, up }
}

function makeProjector(camera: Camera, width: number, height: number): Projector {
  const { forward, right, up } = cameraBasis(camera)
  return (point) => {
    const qx = point[0] - camera.target[0]
    const qy = point[1] - camera.target[1]
    const qz = point[2] - camera.target[2]
    return {
      x: width / 2 + camera.panX + dot([qx, qy, qz], right) * camera.zoom,
      y: height / 2 + camera.panY - dot([qx, qy, qz], up) * camera.zoom,
      depth: dot([qx, qy, qz], forward),
    }
  }
}

/** Where a screen point meets the floor plane (y = 0), in world millimetres. */
function screenToFloor(camera: Camera, width: number, height: number, screenX: number, screenY: number): Pt {
  const { right, up } = cameraBasis(camera)
  const A = right[0]
  const B = right[2]
  const C = up[0]
  const D = up[2]
  const u = (screenX - width / 2 - camera.panX) / camera.zoom
  const v = -(screenY - height / 2 - camera.panY) / camera.zoom
  const target = { x: camera.target[0], y: 0, z: camera.target[2] }
  const qy = target.y - camera.target[1]
  const rhs = v - up[1] * qy
  const det = A * D - B * C
  if (Math.abs(det) < 1e-6) return { x: camera.target[0], y: camera.target[2] }
  const dx = (D * u - B * rhs) / det
  const dz = (-C * u + A * rhs) / det
  return { x: camera.target[0] + dx, y: camera.target[2] + dz }
}

function fitCamera(bounds: Scene['bounds'], width: number, height: number, camera: Camera): Camera {
  const centre: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const probe: Camera = { ...camera, zoom: 1, panX: 0, panY: 0, target: centre }
  const project = makeProjector(probe, width, height)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const p = project([x, y, z])
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
    }
  }
  const zoom = clamp(
    Math.min((width * 0.82) / Math.max(1, maxX - minX), (height * 0.82) / Math.max(1, maxY - minY)),
    MIN_ZOOM,
    MAX_ZOOM,
  )
  return { ...probe, zoom }
}

function pointInPolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]
    const b = points[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

interface Hit {
  solid: Solid
  depth: number
}

function pickAt(
  scene: Scene,
  camera: Camera,
  width: number,
  height: number,
  screenX: number,
  screenY: number,
): Hit | null {
  const project = makeProjector(camera, width, height)
  let best: Hit | null = null
  const test = (solid: Solid) => {
    for (const face of solid.faces) {
      const points = face.pts.map(project)
      if (!pointInPolygon(screenX, screenY, points)) continue
      const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length
      if (!best || depth < best.depth) best = { solid, depth }
    }
  }
  for (const solid of scene.furniture) test(solid)
  for (const solid of scene.floors) test(solid)
  return best
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  width: number,
  height: number,
  highlightId: string | null,
  outline: Array<[number, number]> | null,
): void {
  const { toCamera } = cameraBasis(camera)
  const project = makeProjector(camera, width, height)

  const drawSolid = (solid: Solid, highlight = false) => {
    for (const face of solid.faces) {
      if (dot(face.n, toCamera) <= 0.001) continue
      const points = face.pts.map(project)
      ctx.beginPath()
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y)
        else ctx.lineTo(point.x, point.y)
      })
      ctx.closePath()
      ctx.globalAlpha = face.alpha
      const fill = faceColor(face, highlight)
      ctx.fillStyle = fill
      ctx.fill()
      // Crisp, soft edges give the blocks readable silhouettes. A selected
      // item gets a warmer, slightly heavier outline across all of its parts.
      ctx.strokeStyle = highlight ? 'rgba(126, 68, 44, 0.72)' : solid.edge ?? 'rgba(60, 50, 40, 0.18)'
      ctx.lineWidth = highlight ? 1.7 : 1
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  const drawShadows = () => {
    for (const shadow of scene.shadows) {
      if (!shadow.pts.length) continue
      ctx.beginPath()
      shadow.pts.forEach((point, index) => {
        const p = project(point)
        if (index === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.closePath()
      ctx.fillStyle = `rgba(74, 60, 44, ${shadow.alpha})`
      ctx.fill()
    }
  }

  for (const floor of scene.floors) drawSolid(floor)

  if (scene.gridLines.length) {
    ctx.save()
    ctx.strokeStyle = 'rgba(126, 110, 92, 0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const [from, to] of scene.gridLines) {
      const a = project(from)
      const b = project(to)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
    ctx.restore()
  }

  drawShadows()

  for (const arc of scene.arcs) {
    ctx.beginPath()
    arc.pts.forEach((point, index) => {
      const p = project(point)
      if (index === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.strokeStyle = arc.color
    ctx.lineWidth = 1.4
    ctx.stroke()
  }

  const solids = [...scene.walls, ...scene.furniture]
    .map((solid) => ({ solid, depth: project(solid.centre).depth }))
    .sort((a, b) => b.depth - a.depth)

  for (const { solid } of solids) {
    if (solid.hideFacing && dot(solid.hideFacing, toCamera) > 0) continue
    drawSolid(solid, Boolean(highlightId && solid.itemId === highlightId))
  }

  // Selection ring on the floor makes the active item obvious in 3D.
  if (outline && outline.length > 2) {
    ctx.save()
    ctx.beginPath()
    outline.forEach(([x, z], index) => {
      const p = project([x, 40, z])
      if (index === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(168, 106, 78, 0.13)'
    ctx.fill()
    ctx.setLineDash([8, 5])
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(140, 82, 52, 0.88)'
    ctx.stroke()
    ctx.setLineDash([])
    for (const [x, z] of outline) {
      const p = project([x, 40, z])
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2)
      ctx.fillStyle = '#fbf5ec'
      ctx.fill()
      ctx.lineWidth = 1.6
      ctx.strokeStyle = 'rgba(140, 82, 52, 0.88)'
      ctx.stroke()
    }
    ctx.restore()
  }

  // Room name plates sit above the model so rooms stay identifiable.
  for (const label of scene.labels) {
    const p = project(label.point)
    ctx.save()
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const textWidth = ctx.measureText(label.text).width
    const boxW = textWidth + 14
    const boxH = 20
    ctx.fillStyle = 'rgba(253, 251, 247, 0.92)'
    ctx.strokeStyle = 'rgba(120, 104, 84, 0.22)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(p.x - boxW / 2, p.y - boxH / 2, boxW, boxH, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#4b4339'
    ctx.fillText(label.text, p.x, p.y + 0.5)
    ctx.restore()
  }
}

interface Props {
  onAddRoom: () => void
}

export default function View3D({ onAddRoom }: Props) {
  const state = useStoreState()
  const project = getProject(state)
  const room = getRoom(state)
  const unit = project?.unit ?? 'ft'
  const scope = state.scope
  const step = snapStep(unit)
  const selectedItem = getSelectedItem(state)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 900, h: 620 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const [wallPreset, setWallPreset] = useState<'low' | 'mid' | 'full'>('mid')
  const [helpOpen, setHelpOpen] = useState(true)
  const fraction = WALL_PRESETS.find((preset) => preset.id === wallPreset)?.fraction ?? 0.62

  const scene = useMemo(() => {
    if (!project) return null
    if (scope === 'home') {
      if (!project.rooms.length) return null
      return buildHomeScene(project.rooms, { wallFraction: fraction, grid: false, labels: true })
    }
    return room ? buildScene(room, { wallFraction: fraction, grid: true }) : null
  }, [project, room, scope, fraction])
  const sceneRef = useRef<Scene | null>(scene)
  sceneRef.current = scene

  const home = useMemo<Camera>(() => {
    return { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, zoom: 0.08, panX: 0, panY: 0, target: [0, 0, 0] }
  }, [])
  const cameraRef = useRef<Camera>({ ...home, target: [...home.target] as Vec3 })
  const targetRef = useRef<Camera>({ ...home, target: [...home.target] as Vec3 })
  const highlightRef = useRef<string | null>(null)
  const outlineRef = useRef<Array<[number, number]> | null>(null)
  const dragRef = useRef<
    | { mode: 'orbit' | 'pan'; x: number; y: number; yaw: number; pitch: number; panX: number; panY: number }
    | {
        mode: 'item'
        itemId: string
        roomId: string
        grabX: number
        grabY: number
        started: boolean
        itemRotation: number
        itemW: number
        itemD: number
      }
    | null
  >(null)

  const selectionOutline = useMemo<Array<[number, number]> | null>(() => {
    if (!selectedItem) return null
    const owner = getItemRoom(state, selectedItem.id)
    if (!owner) return null
    if (scope === 'room' && owner.id !== room?.id) return null
    const obb = itemObb(selectedItem)
    const corners = rectCorners({ ...obb, w: obb.w + 120, d: obb.d + 120 })
    return corners.map((point) => {
      const world = scope === 'home' ? roomToWorld(owner, point) : point
      return [world.x, world.y] as [number, number]
    })
  }, [selectedItem, scope, state, room?.id])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const current = sceneRef.current
    if (!canvas || !current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = sizeRef.current
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixelWidth = Math.max(1, Math.round(w * dpr))
    const pixelHeight = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    drawScene(ctx, current, cameraRef.current, w, h, highlightRef.current, outlineRef.current)
  }, [])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setSize({ w: Math.max(320, rect.width), h: Math.max(280, rect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!scene) return
    const fitted = fitCamera(scene.bounds, size.w, size.h, cameraRef.current)
    cameraRef.current = { ...fitted, target: [...fitted.target] as Vec3 }
    targetRef.current = { ...fitted, target: [...fitted.target] as Vec3 }
    draw()
  }, [scene, size.w, size.h, draw])

  const zoomBy = (factor: number) => {
    targetRef.current.zoom = clamp(targetRef.current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  }

  const fitKeyRef = useRef('')
  useEffect(() => {
    if (!scene) return
    const key =
      scope === 'home'
        ? `home:${project?.id ?? ''}:${project?.rooms.length ?? 0}:${Math.round(size.w)}x${Math.round(size.h)}`
        : `room:${room?.id ?? ''}:${Math.round(size.w)}x${Math.round(size.h)}`
    if (fitKeyRef.current !== key) {
      fitKeyRef.current = key
      fit()
    } else {
      draw()
    }
  }, [scene, room?.id, project?.id, project?.rooms.length, scope, size.w, size.h, fit, draw])

  // Smooth camera easing: input moves the target, the frame loop catches up.
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const current = cameraRef.current
      const target = targetRef.current
      let changed = false
      const ease = (key: 'yaw' | 'pitch' | 'zoom' | 'panX' | 'panY') => {
        const delta = target[key] - current[key]
        if (Math.abs(delta) > 0.0002) {
          current[key] += delta * 0.24
          changed = true
        } else if (current[key] !== target[key]) {
          current[key] = target[key]
          changed = true
        }
      }
      ease('yaw')
      ease('pitch')
      ease('zoom')
      ease('panX')
      ease('panY')
      for (let i = 0; i < 3; i += 1) {
        const delta = target.target[i] - current.target[i]
        if (Math.abs(delta) > 0.5) {
          current.target[i] += delta * 0.24
          changed = true
        } else if (current.target[i] !== target.target[i]) {
          current.target[i] = target.target[i]
          changed = true
        }
      }
      if (changed) draw()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [draw])

  useEffect(() => {
    highlightRef.current = selectedItem?.id ?? null
    outlineRef.current = selectionOutline
    draw()
  }, [selectedItem?.id, selectionOutline, scene, draw])

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const screenX = event.clientX - rect.left
      const screenY = event.clientY - rect.top
      const camera = cameraRef.current
      const target = targetRef.current
      const factor = Math.exp(-event.deltaY * 0.0015)
      const zoom = clamp(target.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const ratio = zoom / camera.zoom
      const centreX = screenX - sizeRef.current.w / 2
      const centreY = screenY - sizeRef.current.h / 2
      target.zoom = zoom
      target.panX = centreX - (centreX - camera.panX) * ratio
      target.panY = centreY - (centreY - camera.panY) * ratio
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (element && element.closest('input, textarea, select, [contenteditable="true"]')) return
      const snapshot = store.getSnapshot()
      const item = getSelectedItem(snapshot)
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
      if (!item) return
      if (meta && key === 'd') {
        event.preventDefault()
        store.duplicateItem(item.id)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        store.deleteItem(item.id)
        return
      }
      if (key === 'r') {
        event.preventDefault()
        store.rotateItem(item.id, event.shiftKey ? -90 : 90)
        return
      }
      const nudge = event.shiftKey ? snapStep(snapshot.projects.find((entry) => entry.id === snapshot.projectId)?.unit ?? 'ft') * 5 : step
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    if (!canvas || !rect) return
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top

    if (event.button === 0 && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const hit = scene ? pickAt(scene, cameraRef.current, size.w, size.h, screenX, screenY) : null
      if (hit?.solid.itemId) {
        const itemId = hit.solid.itemId
        const roomId = hit.solid.roomId
        const owner = project?.rooms.find((entry) => entry.id === roomId)
        const item = owner?.items.find((entry) => entry.id === itemId)
        if (owner && item) {
          store.setSelection({ kind: 'item', id: itemId })
          const floor = screenToFloor(cameraRef.current, size.w, size.h, screenX, screenY)
          const local = roomFromWorld(owner, { x: floor.x, y: floor.y })
          dragRef.current = {
            mode: 'item',
            itemId,
            roomId: owner.id,
            grabX: local.x - item.x,
            grabY: local.y - item.y,
            started: false,
            itemRotation: item.rotation,
            itemW: item.w,
            itemD: item.d,
          }
          canvas.setPointerCapture(event.pointerId)
          return
        }
      }
      if (hit?.solid.roomId && scope === 'home') {
        store.openRoom(hit.solid.roomId)
      } else if (hit?.solid.roomId) {
        store.setSelection({ kind: 'room', id: hit.solid.roomId })
      }
    }

    const pan = event.button !== 0 || event.shiftKey || event.altKey
    const target = targetRef.current
    dragRef.current = {
      mode: pan ? 'pan' : 'orbit',
      x: event.clientX,
      y: event.clientY,
      yaw: target.yaw,
      pitch: target.pitch,
      panX: target.panX,
      panY: target.panY,
    }
    canvas.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'item') {
      const canvas = canvasRef.current
      const rect = canvas?.getBoundingClientRect()
      if (!rect) return
      const owner = project?.rooms.find((entry) => entry.id === drag.roomId)
      if (!owner) return
      const floor = screenToFloor(
        cameraRef.current,
        size.w,
        size.h,
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
      const local = roomFromWorld(owner, { x: floor.x, y: floor.y })
      if (!drag.started) {
        drag.started = true
        store.beginInteraction()
      }
      const clamped = clampItemInsideRoom(owner, {
        x: local.x - drag.grabX,
        y: local.y - drag.grabY,
        w: drag.itemW,
        d: drag.itemD,
        rotation: drag.itemRotation,
      })
      store.updateItemLive(drag.itemId, {
        x: tidyMm(snapValue(clamped.x, step, state.snapping)),
        y: tidyMm(snapValue(clamped.y, step, state.snapping)),
      })
      return
    }
    const target = targetRef.current
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (drag.mode === 'orbit') {
      target.yaw = drag.yaw + dx * 0.008
      target.pitch = clamp(drag.pitch - dy * 0.006, 0.12, 1.45)
    } else {
      target.panX = drag.panX + dx
      target.panY = drag.panY + dy
    }
  }

  const onPointerUp = () => {
    dragRef.current = null
  }

  const applyPreset = (preset: 'reset' | 'top' | 'iso') => {
    const target = targetRef.current
    target.panX = 0
    target.panY = 0
    if (preset === 'top') {
      target.yaw = DEFAULT_YAW
      target.pitch = 1.45
    } else if (preset === 'iso') {
      target.yaw = DEFAULT_YAW
      target.pitch = DEFAULT_PITCH
    } else {
      fit()
    }
  }

  if (!project) {
    return (
      <div className="stage stage--empty">
        <div className="empty-card">
          <h2>Nothing to preview yet</h2>
          <p>Create a project and add a room — it will appear here in isometric 3D.</p>
          <div className="empty-card__actions">
            <button type="button" className="btn btn--primary" onClick={onAddRoom}>
              Add a room
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!scene || (!room && scope === 'room')) {
    return (
      <div className="stage stage--empty">
        <div className="empty-card">
          <h2>No rooms yet</h2>
          <p>Add a room in the 2D editor and it will appear here in isometric 3D.</p>
          <div className="empty-card__actions">
            <button type="button" className="btn btn--primary" onClick={onAddRoom}>
              Add a room
            </button>
            <button type="button" className="btn" onClick={() => store.setView('2d')}>
              Back to the 2D editor
            </button>
          </div>
        </div>
      </div>
    )
  }

  const selectedRoom = scope === 'home' ? project.rooms.find((entry) => entry.id === state.roomId) : room

  return (
    <div className="stage stage--viewer" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={cx('view3d__canvas', dragRef.current?.mode === 'orbit' && 'is-orbiting')}
        style={{ width: size.w, height: size.h, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />

      <div className="stage__overlay stage__overlay--left">
        {helpOpen && (
          <div className="card card--caption">
            <OverlayClose label="Close 3D tips" onClose={() => setHelpOpen(false)} />
            <span className="pill pill--muted">{scope === 'home' ? 'Whole home' : 'Room in 3D'}</span>
            <h3 className="card__title card__title--lead">
              {scope === 'home' ? project.name : selectedRoom?.name ?? 'Room'}
            </h3>
            {scope === 'home' ? (
              <p className="muted small">
                {project.rooms.length} {project.rooms.length === 1 ? 'room' : 'rooms'} in 3D · drag furniture to move
                it · click a room to select it.
              </p>
            ) : selectedRoom ? (
              <p className="muted small">
                {formatLengthCompact(selectedRoom.length, unit)} × {formatLengthCompact(selectedRoom.width, unit)} ·{' '}
                {selectedRoom.items.length} {selectedRoom.items.length === 1 ? 'item' : 'items'} ·{' '}
                {selectedRoom.openings.length} {selectedRoom.openings.length === 1 ? 'opening' : 'openings'}
              </p>
            ) : null}
            <p className="muted small">
              Drag furniture to move it, drag empty space to orbit, shift-drag or right-drag to pan, scroll to zoom.
            </p>
            <button type="button" className="btn btn--primary btn--block" onClick={() => store.setView('2d')}>
              Back to the 2D editor
            </button>
          </div>
        )}
      </div>

      <div className="stage__overlay stage__overlay--right">
        <div className="view-chips">
          <div className="seg seg--small">
            {WALL_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={wallPreset === preset.id}
                onClick={() => setWallPreset(preset.id)}
                title={preset.label}
              >
                {preset.label.replace(' walls', '')}
              </button>
            ))}
          </div>
          <div className="view-chips__row">
            <button type="button" className="chip" onClick={() => applyPreset('iso')}>
              Isometric
            </button>
            <button type="button" className="chip" onClick={() => applyPreset('top')}>
              Top
            </button>
            <button type="button" className="chip" onClick={() => applyPreset('reset')}>
              Reset view
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={helpOpen}
              onClick={() => setHelpOpen(!helpOpen)}
              title="Show or hide the 3D tips"
            >
              Help
            </button>
          </div>
        </div>
        <div className="zoom-group">
          <button type="button" className="zoom-btn" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="zoom-btn zoom-btn--wide" onClick={fit}>
            Fit room
          </button>
          <button type="button" className="zoom-btn" onClick={() => zoomBy(1.3)} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      {selectedItem && (
        <div className="view3d__bar" role="toolbar" aria-label={`Selected ${selectedItem.name}`}>
          <span className="view3d__bar-name">{selectedItem.name}</span>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => store.rotateItem(selectedItem.id, -90)}
            title="Rotate 90° counter-clockwise"
          >
            ⟲
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => store.rotateItem(selectedItem.id, 90)}
            title="Rotate 90° clockwise"
          >
            ⟳
          </button>
          <button type="button" className="btn btn--small" onClick={() => store.duplicateItem(selectedItem.id)}>
            Duplicate
          </button>
          <button type="button" className="btn btn--small btn--danger" onClick={() => store.deleteItem(selectedItem.id)}>
            Delete
          </button>
          <div className="swatches swatches--sm">
            {ITEM_COLORS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={cx('swatch', selectedItem.color.toLowerCase() === entry.value && 'swatch--active')}
                style={{ background: entry.value }}
                aria-label={`Set colour ${entry.name}`}
                title={entry.name}
                onClick={() => store.updateItem(selectedItem.id, { color: entry.value })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
