import type { FurnitureItem, Room, Wall } from '../types.ts'
import {
  WALL_THICKNESS,
  doorSwingGeometry,
  itemObb,
  openingCenter,
  rectCorners,
  roomRect,
  roomToWorld,
  wallAlong,
  wallInward,
  wallOutward,
  wallPoint,
  wallRuns,
  wallSegmentObb,
} from './geometry.ts'
import { DEFAULT_ITEM_COLOR, normalizeColor } from './catalog.ts'
import { itemParts } from './parts.ts'

export type Vec3 = [number, number, number]

/**
 * A face stores its unshaded base colour plus a tone multiplier. Lighting is
 * applied once, when the frame is drawn, which keeps every material visible and
 * lets selection highlight a whole object without re-building the scene.
 */
export interface Face {
  pts: Vec3[]
  n: Vec3
  base: string
  tone: number
  alpha: number
}

export interface Solid {
  faces: Face[]
  centre: Vec3
  /** Hidden when this direction points at the camera (near walls in cutaway). */
  hideFacing?: Vec3
  kind: 'floor' | 'wall' | 'frame' | 'furniture' | 'door'
  itemId?: string
  roomId?: string
  wall?: Wall
  hasOpening?: boolean
  /** Edge colour; a thin outline keeps shapes readable. */
  edge?: string
}

export interface Scene {
  floors: Solid[]
  gridLines: Array<[Vec3, Vec3]>
  shadows: Array<{ pts: Vec3[]; alpha: number }>
  walls: Solid[]
  furniture: Solid[]
  arcs: Array<{ pts: Vec3[]; color: string }>
  labels: Array<{ text: string; sub: string; point: Vec3 }>
  bounds: { min: Vec3; max: Vec3 }
}

export interface SceneOptions {
  /** Rendered wall height as a fraction of the real wall height. */
  wallFraction: number
  grid?: boolean
  labels?: boolean
}

const LIGHT: Vec3 = normalize([-0.45, 0.86, -0.32])
const WALL_COLOR = '#f2ebdf'
const WALL_EDGE = 'rgba(108, 92, 74, 0.3)'
const FLOOR_COLORS = ['#ddceb6', '#e2d4bd', '#d9cab1', '#e5d7c1', '#dfd0b8']
const FURNITURE_EDGE = 'rgba(58, 48, 38, 0.22)'

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/** Convert a hex colour to a shaded rgb() string. Never returns black by accident. */
export function shadeHex(hex: string, factor: number): string {
  const fallback = DEFAULT_ITEM_COLOR
  let clean = (typeof hex === 'string' ? hex : '').trim().replace('#', '')
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(clean)) clean = fallback.replace('#', '')
  const value = Number.parseInt(clean, 16)
  if (!Number.isFinite(value)) return fallback
  const safe = Number.isFinite(factor) ? Math.max(0.3, Math.min(1.5, factor)) : 1
  const r = Math.min(255, Math.max(0, Math.round(((value >> 16) & 255) * safe)))
  const g = Math.min(255, Math.max(0, Math.round(((value >> 8) & 255) * safe)))
  const b = Math.min(255, Math.max(0, Math.round((value & 255) * safe)))
  return `rgb(${r}, ${g}, ${b})`
}

/** Soft key light plus a little bounce, so no face goes black. */
export function lightFactor(n: Vec3): number {
  const facing = dot(normalize(n), LIGHT)
  let factor = 0.74 + 0.3 * Math.max(0, facing)
  if (n[1] < -0.2) factor *= 0.72
  if (n[1] > 0.8) factor += 0.04
  return Math.max(0.42, Math.min(1.1, factor))
}

export function faceColor(face: Face, highlight = false): string {
  const factor = lightFactor(face.n) * (Number.isFinite(face.tone) ? face.tone : 1)
  return shadeHex(highlight ? lightenHex(face.base, 0.16) : face.base, factor)
}

function lightenHex(hex: string, amount: number): string {
  const clean = normalizeColor(hex).replace('#', '')
  const value = Number.parseInt(clean, 16)
  const mix = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount))
  const r = mix((value >> 16) & 255)
  const g = mix((value >> 8) & 255)
  const b = mix(value & 255)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function rotateY(v: Vec3, rad: number): Vec3 {
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [v[0] * cos - v[2] * sin, v[1], v[0] * sin + v[2] * cos]
}

interface BoxSpec {
  centre: Vec3
  size: Vec3
  rotation?: number
  origin?: Vec3
  color: string
  tone?: number
  alpha?: number
  kind?: Solid['kind']
  edge?: string
}

const UNIT_FACES: Array<{ indices: number[]; n: Vec3 }> = [
  { indices: [1, 2, 6, 5], n: [1, 0, 0] },
  { indices: [0, 4, 7, 3], n: [-1, 0, 0] },
  { indices: [4, 5, 6, 7], n: [0, 1, 0] },
  { indices: [0, 3, 2, 1], n: [0, -1, 0] },
  { indices: [3, 7, 6, 2], n: [0, 0, 1] },
  { indices: [0, 1, 5, 4], n: [0, 0, -1] },
]

/** Convex box as six outward-facing quads. */
function makeBox({
  centre,
  size,
  rotation = 0,
  origin = [0, 0, 0],
  color,
  tone = 1,
  alpha = 1,
  kind = 'furniture',
  edge = FURNITURE_EDGE,
}: BoxSpec): Solid {
  const base = normalizeColor(color)
  const hx = size[0] / 2
  const hy = size[1] / 2
  const hz = size[2] / 2
  const corners: Vec3[] = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [-hx, -hy, hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ]
  const move = (local: Vec3): Vec3 => {
    // Rotate the part's centre together with its vertices so every part of an
    // item turns as one group around the item's vertical centre axis.
    const rotated = rotateY(
      [centre[0] + local[0], centre[1] + local[1], centre[2] + local[2]],
      rotation,
    )
    return [origin[0] + rotated[0], origin[1] + rotated[1], origin[2] + rotated[2]]
  }
  return {
    kind,
    edge,
    centre: move([0, 0, 0]),
    faces: UNIT_FACES.map((face) => ({
      pts: face.indices.map((index) => move(corners[index])),
      n: rotateY(face.n, rotation),
      base,
      tone,
      alpha,
    })),
  }
}

interface PrismSpec {
  centre: Vec3
  size: Vec3
  sides: number
  rotation?: number
  origin?: Vec3
  color: string
  tone?: number
  alpha?: number
  kind?: Solid['kind']
  edge?: string
}

/** Vertical elliptical prism used for round items. */
function makePrism({
  centre,
  size,
  sides,
  rotation = 0,
  origin = [0, 0, 0],
  color,
  tone = 1,
  alpha = 1,
  kind = 'furniture',
  edge = FURNITURE_EDGE,
}: PrismSpec): Solid {
  const base = normalizeColor(color)
  const rx = size[0] / 2
  const rz = size[2] / 2
  const hy = size[1] / 2
  const faces: Face[] = []
  const point = (angle: number, y: number): Vec3 => {
    const local: Vec3 = [
      centre[0] + Math.cos(angle) * rx,
      centre[1] + y,
      centre[2] + Math.sin(angle) * rz,
    ]
    const rotated = rotateY(local, rotation)
    return [origin[0] + rotated[0], origin[1] + rotated[1], origin[2] + rotated[2]]
  }
  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const mid = (a0 + a1) / 2
    const n = rotateY(normalize([Math.cos(mid), 0, Math.sin(mid)]), rotation)
    faces.push({
      pts: [point(a0, -hy), point(a0, hy), point(a1, hy), point(a1, -hy)],
      n,
      base,
      tone,
      alpha,
    })
  }
  const top = rotateY([0, 1, 0], rotation)
  const bottom = rotateY([0, -1, 0], rotation)
  const cap = (y: number, n: Vec3): Face => ({
    pts: Array.from({ length: sides }, (_, i) => point((i / sides) * Math.PI * 2, y)),
    n,
    base,
    tone,
    alpha,
  })
  faces.push(cap(hy, top), cap(-hy, bottom))
  return { kind, edge, centre: point(0, 0), faces }
}

function itemBaseColor(item: FurnitureItem): string {
  return normalizeColor(item.color)
}

/**
 * Room geometry in room-local coordinates: x runs along the room length, z
 * along its width, y is up. The whole-home view reuses this and transforms it
 * into place, so both views always agree.
 */
export function buildRoomScene(room: Room, options: SceneOptions): Scene {
  const wallHeight = Math.max(320, room.wallHeight * options.wallFraction)
  const bounds = { min: [0, 0, 0] as Vec3, max: [room.length, wallHeight, room.width] as Vec3 }
  const scene: Scene = {
    floors: [
      makeBox({
        centre: [room.length / 2, -30, room.width / 2],
        size: [room.length, 60, room.width],
        color: FLOOR_COLORS[0],
        kind: 'floor',
        edge: 'rgba(120, 104, 84, 0.24)',
      }),
    ],
    gridLines: [],
    shadows: [],
    walls: [],
    furniture: [],
    arcs: [],
    labels: [],
    bounds,
  }
  scene.floors[0].roomId = room.id
  if (options.grid !== false) {
    const step = 500
    for (let x = step; x < room.length - 1; x += step) {
      scene.gridLines.push([
        [x, 2, 0],
        [x, 2, room.width],
      ])
    }
    for (let z = step; z < room.width - 1; z += step) {
      scene.gridLines.push([
        [0, 2, z],
        [room.length, 2, z],
      ])
    }
  }
  if (options.labels) {
    scene.labels.push({
      text: room.name,
      sub: '',
      point: [room.length / 2, 20, room.width / 2],
    })
  }

  for (const run of wallRuns(room)) {
    const outward = wallOutward(run.wall)
    const hideFacing: Vec3 = [outward.x, 0, outward.y]
    const hasOpening = run.openings.length > 0

    for (const [start, end] of run.segments) {
      const obb = wallSegmentObb(room, run.wall, start, end, WALL_THICKNESS)
      const solid = makeBox({
        centre: [obb.x, wallHeight / 2, obb.y],
        size: [obb.w, wallHeight, obb.d],
        color: WALL_COLOR,
        kind: 'wall',
        edge: WALL_EDGE,
      })
      solid.hideFacing = hideFacing
      solid.roomId = room.id
      solid.wall = run.wall
      solid.hasOpening = hasOpening
      scene.walls.push(solid)

      // Skirting board against the inner wall face, broken at openings.
      const mid = wallPoint(room, run.wall, (start + end) / 2)
      const inwards = wallInward(run.wall)
      const lengthways = wallAlong(run.wall)
      const skirtDepth = 24
      const skirtHeight = Math.min(110, wallHeight * 0.08)
      const skirtSpan = Math.max(0, end - start - 6)
      const skirting = makeBox({
        centre: [
          mid.x + inwards.x * (WALL_THICKNESS + skirtDepth / 2),
          skirtHeight / 2,
          mid.y + inwards.y * (WALL_THICKNESS + skirtDepth / 2),
        ],
        size: [
          Math.abs(lengthways.x) * skirtSpan + Math.abs(inwards.x) * skirtDepth,
          skirtHeight,
          Math.abs(lengthways.y) * skirtSpan + Math.abs(inwards.y) * skirtDepth,
        ],
        color: '#f8f2e8',
        kind: 'frame',
        edge: 'rgba(120, 104, 84, 0.18)',
      })
      skirting.roomId = room.id
      skirting.hideFacing = hideFacing
      scene.walls.push(skirting)
    }

    for (const { opening, start, end } of run.openings) {
      const centre = openingCenter(room, opening)
      const inward = wallInward(run.wall)
      const along = wallAlong(run.wall)
      const post = 55
      const halfWidth = opening.width / 2
      const frameColor = '#d3c3ac'
      // A window's opening starts at its sill; a door starts at the floor.
      const openingTop = Math.min(
        opening.type === 'window' ? opening.sill + opening.height : opening.height,
        wallHeight,
      )
      const openingBottom = opening.type === 'window' ? Math.min(opening.sill, wallHeight) : 0

      const makePost = (offset: number, from: number, to: number) => {
        const height = to - from
        if (height < 10) return
        const solid = makeBox({
          centre: [centre.x + along.x * offset, (from + to) / 2, centre.y + along.y * offset],
          size: [
            Math.abs(along.x) * post + Math.abs(inward.x) * WALL_THICKNESS * 0.9,
            height,
            Math.abs(along.y) * post + Math.abs(inward.y) * WALL_THICKNESS * 0.9,
          ],
          color: frameColor,
          kind: 'frame',
          edge: 'rgba(104, 88, 68, 0.24)',
        })
        solid.hideFacing = hideFacing
        solid.roomId = room.id
        scene.walls.push(solid)
      }
      makePost(halfWidth - post / 2, openingBottom, openingTop)
      makePost(-halfWidth + post / 2, openingBottom, openingTop)

      // Wall above every opening, plus the wall under a window, so openings
      // read as holes in a continuous wall rather than slots cut to the top.
      const addWallBand = (from: number, to: number) => {
        if (to - from < 20) return
        const band = wallSegmentObb(room, run.wall, start, end, WALL_THICKNESS)
        const wallBand = makeBox({
          centre: [band.x, (from + to) / 2, band.y],
          size: [band.w, to - from, band.d],
          color: WALL_COLOR,
          kind: 'frame',
          edge: WALL_EDGE,
        })
        wallBand.hideFacing = hideFacing
        wallBand.roomId = room.id
        scene.walls.push(wallBand)
      }
      if (opening.type === 'window') {
        addWallBand(0, Math.min(opening.sill, wallHeight))
      }
      addWallBand(openingTop, wallHeight)

      if (opening.type === 'window') {
        const sill = opening.sill
        const top = Math.min(sill + opening.height, wallHeight)
        if (top > sill + 80) {
          const pane = makeBox({
            centre: [centre.x, (sill + top) / 2, centre.y],
            size: [
              Math.abs(along.x) * (opening.width - post * 2) + Math.abs(inward.x) * 40,
              top - sill,
              Math.abs(along.y) * (opening.width - post * 2) + Math.abs(inward.y) * 40,
            ],
            color: '#c7dde6',
            alpha: 0.4,
            kind: 'frame',
            edge: 'rgba(120, 150, 160, 0.35)',
          })
          pane.hideFacing = hideFacing
          pane.roomId = room.id
          scene.walls.push(pane)
          const board = makeBox({
            centre: [centre.x + inward.x * 30, sill - 15, centre.y + inward.y * 30],
            size: [
              Math.abs(along.x) * (opening.width + 60) + Math.abs(inward.x) * 90,
              30,
              Math.abs(along.y) * (opening.width + 60) + Math.abs(inward.y) * 90,
            ],
            color: '#ece3d5',
            kind: 'frame',
          })
          board.roomId = room.id
          scene.walls.push(board)
        }
      } else {
        const threshold = makeBox({
          centre: [centre.x, 10, centre.y],
          size: [
            Math.abs(along.x) * opening.width + Math.abs(inward.x) * (WALL_THICKNESS + 20),
            20,
            Math.abs(along.y) * opening.width + Math.abs(inward.y) * (WALL_THICKNESS + 20),
          ],
          color: '#c8b79e',
          kind: 'frame',
          edge: 'rgba(100, 84, 64, 0.22)',
        })
        threshold.roomId = room.id
        scene.walls.push(threshold)

        // Door leaf, hinged and swinging towards the chosen side.
        const geom = doorSwingGeometry(room, opening)
        const leafWidth = opening.width
        const leafThickness = 45
        const leafHeight = Math.min(opening.height, wallHeight) - 10
        const leafCentre = {
          x: geom.hinge.x + geom.perp.x * (leafWidth / 2),
          y: geom.hinge.y + geom.perp.y * (leafWidth / 2),
        }
        const leaf = makeBox({
          centre: [leafCentre.x, leafHeight / 2, leafCentre.y],
          size: [
            Math.abs(along.x) * leafThickness + Math.abs(geom.perp.x) * leafWidth,
            leafHeight,
            Math.abs(along.y) * leafThickness + Math.abs(geom.perp.y) * leafWidth,
          ],
          color: '#c2a684',
          kind: 'door',
          edge: 'rgba(92, 74, 54, 0.3)',
        })
        leaf.roomId = room.id
        scene.walls.push(leaf)

        scene.arcs.push({
          pts: geom.arc.map((point) => [point.x, 8, point.y] as Vec3),
          color: 'rgba(140, 118, 94, 0.55)',
        })
        const handle = makeBox({
          centre: [
            geom.hinge.x + geom.perp.x * (leafWidth * 0.86) + along.x * 26,
            leafHeight * 0.52,
            geom.hinge.y + geom.perp.y * (leafWidth * 0.86) + along.y * 26,
          ],
          size: [50, 50, 50],
          color: '#8d7a63',
          kind: 'door',
        })
        handle.roomId = room.id
        scene.walls.push(handle)
      }
    }
  }

  for (const item of room.items) {
    const rotation = (item.rotation * Math.PI) / 180
    const origin: Vec3 = [item.x, 0, item.y]
    const baseColor = itemBaseColor(item)
    const parts = itemParts(item.kind, item.shape, {
      w: item.w,
      d: item.d,
      h: item.h,
      thickness: item.thickness,
    })
    for (const part of parts) {
      const solid = part.round
        ? makePrism({
            centre: [part.x, part.y, part.z],
            size: [part.w, part.h, part.d],
            sides: 24,
            rotation,
            origin,
            color: part.color ?? baseColor,
            tone: part.tone ?? 1,
            alpha: part.alpha ?? 1,
          })
        : makeBox({
            centre: [part.x, part.y, part.z],
            size: [part.w, part.h, part.d],
            rotation,
            origin,
            color: part.color ?? baseColor,
            tone: part.tone ?? 1,
            alpha: part.alpha ?? 1,
          })
      solid.itemId = item.id
      solid.roomId = room.id
      scene.furniture.push(solid)
    }

    // Soft contact shadow, offset away from the light.
    if (!item.overlappable) {
      const drop = Math.min(320, Math.max(90, item.h * 0.22))
      const offset: Vec3 = [-drop * 0.5, 0, -drop * 0.36]
      const obb = itemObb(item)
      const pts = rectCorners({ ...obb, w: obb.w + 90, d: obb.d + 90 })
      scene.shadows.push({
        pts: pts.map((p) => [p.x + offset[0], 2.5, p.y + offset[2]] as Vec3),
        alpha: 0.11,
      })
      const soft = rectCorners({ ...obb, w: obb.w + 230, d: obb.d + 230 })
      scene.shadows.push({
        pts: soft.map((p) => [p.x + offset[0] * 1.3, 2, p.y + offset[2] * 1.3] as Vec3),
        alpha: 0.05,
      })
    }
  }

  // Fit the camera to the whole model, including tall furniture and the outer
  // face of the walls, so nothing is clipped at the default angle.
  const fitMin: Vec3 = [Infinity, Infinity, Infinity]
  const fitMax: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const solid of [...scene.walls, ...scene.furniture]) {
    for (const face of solid.faces) {
      for (const point of face.pts) {
        for (let axis = 0; axis < 3; axis += 1) {
          fitMin[axis] = Math.min(fitMin[axis], point[axis])
          fitMax[axis] = Math.max(fitMax[axis], point[axis])
        }
      }
    }
  }
  if (Number.isFinite(fitMin[0])) scene.bounds = { min: fitMin, max: fitMax }
  return scene
}

/** Single-room scene in room-local coordinates (used by the room editor). */
export function buildScene(room: Room, options: SceneOptions): Scene {
  return buildRoomScene(room, options)
}

/** Rotate a local point into home coordinates. */
function worldPoint(room: Room, x: number, z: number): Vec3 {
  const point = roomToWorld(room, { x, y: z })
  return [point.x, 0, point.y]
}

function transformSolid(room: Room, solid: Solid): Solid {
  const remap = (point: Vec3): Vec3 => {
    const world = worldPoint(room, point[0], point[2])
    return [world[0], point[1], world[2]]
  }
  const rotation = (room.layout.rotation * Math.PI) / 180
  const remapDirection = (direction: Vec3): Vec3 => {
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return [direction[0] * cos - direction[2] * sin, direction[1], direction[0] * sin + direction[2] * cos]
  }
  return {
    ...solid,
    centre: remap(solid.centre),
    faces: solid.faces.map((face) => ({
      ...face,
      pts: face.pts.map(remap),
      n: remapDirection(face.n),
    })),
    hideFacing: solid.hideFacing ? remapDirection(solid.hideFacing) : undefined,
  }
}

interface WallBand {
  axis: 'x' | 'z'
  thinMin: number
  thinMax: number
  spanMin: number
  spanMax: number
}

function wallBand(solid: Solid): WallBand {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const face of solid.faces) {
    for (const point of face.pts) {
      minX = Math.min(minX, point[0])
      maxX = Math.max(maxX, point[0])
      minZ = Math.min(minZ, point[2])
      maxZ = Math.max(maxZ, point[2])
    }
  }
  const spanX = maxX - minX
  const spanZ = maxZ - minZ
  return spanX <= spanZ
    ? { axis: 'x', thinMin: minX, thinMax: maxX, spanMin: minZ, spanMax: maxZ }
    : { axis: 'z', thinMin: minZ, thinMax: maxZ, spanMin: minX, spanMax: maxX }
}

/** True when two walls lie on the same boundary and mostly cover each other. */
function sameBoundary(a: WallBand, b: WallBand): boolean {
  if (a.axis !== b.axis) return false
  const gap = Math.max(a.thinMin - b.thinMax, b.thinMin - a.thinMax)
  if (gap > 260) return false
  const overlap = Math.min(a.spanMax, b.spanMax) - Math.max(a.spanMin, b.spanMin)
  const shortest = Math.min(a.spanMax - a.spanMin, b.spanMax - b.spanMin)
  return overlap > Math.max(300, shortest * 0.62)
}

/**
 * Whole-home scene: every room placed and rotated from its saved layout.
 * Doubled walls between touching rooms collapse into a single wall where the
 * two rooms agree, while walls holding a door keep their opening.
 */
export function buildHomeScene(rooms: Room[], options: SceneOptions): Scene {
  const scene: Scene = {
    floors: [],
    gridLines: [],
    shadows: [],
    walls: [],
    furniture: [],
    arcs: [],
    labels: [],
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  }

  const wallSolids: Solid[] = []
  let minX = Infinity
  let minY = 0
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = 0
  let maxZ = -Infinity

  rooms.forEach((room, index) => {
    const local = buildRoomScene(room, options)
    const floor = transformSolid(room, local.floors[0])
    floor.roomId = room.id
    floor.faces = floor.faces.map((face) => ({
      ...face,
      base: FLOOR_COLORS[index % FLOOR_COLORS.length],
    }))
    scene.floors.push(floor)

    for (const wall of local.walls) {
      const transformed = transformSolid(room, wall)
      transformed.roomId = room.id
      wallSolids.push(transformed)
    }
    for (const solid of local.furniture) scene.furniture.push(transformSolid(room, solid))
    for (const shadow of local.shadows) {
      scene.shadows.push({
        pts: shadow.pts.map((point) => {
          const world = worldPoint(room, point[0], point[2])
          return [world[0], point[1], world[2]] as Vec3
        }),
        alpha: shadow.alpha,
      })
    }
    for (const arc of local.arcs) {
      scene.arcs.push({
        pts: arc.pts.map((point) => {
          const world = worldPoint(room, point[0], point[2])
          return [world[0], point[1], world[2]] as Vec3
        }),
        color: arc.color,
      })
    }

    const rect = roomRect(room)
    const wallHeight = Math.max(320, room.wallHeight * options.wallFraction)
    minX = Math.min(minX, rect.minX - WALL_THICKNESS)
    maxX = Math.max(maxX, rect.maxX + WALL_THICKNESS)
    minZ = Math.min(minZ, rect.minY - WALL_THICKNESS)
    maxZ = Math.max(maxZ, rect.maxY + WALL_THICKNESS)
    maxY = Math.max(maxY, wallHeight)
    scene.labels.push({
      text: room.name,
      sub: '',
      point: [roomRect(room).minX + (rect.maxX - rect.minX) / 2, 60, rect.minY + (rect.maxY - rect.minY) / 2],
    })
  })

  // Collapse doubled walls between adjacent rooms.
  const structural = wallSolids.filter((solid) => solid.kind === 'wall')
  const bands = structural.map(wallBand)
  const drop = new Set<number>()
  for (let i = 0; i < structural.length; i += 1) {
    for (let j = i + 1; j < structural.length; j += 1) {
      if (drop.has(i) || drop.has(j)) continue
      const a = structural[i]
      const b = structural[j]
      if (!a.roomId || !b.roomId || a.roomId === b.roomId) continue
      if (!sameBoundary(bands[i], bands[j])) continue
      if (a.hasOpening && b.hasOpening) continue
      if (a.hasOpening) drop.add(j)
      else if (b.hasOpening) drop.add(i)
      else drop.add(j)
    }
  }
  structural.forEach((solid, index) => {
    if (!drop.has(index)) scene.walls.push(solid)
  })
  for (const solid of wallSolids) {
    if (solid.kind !== 'wall') scene.walls.push(solid)
  }

  const fallback = { min: [0, 0, 0] as Vec3, max: [4000, maxY, 3000] as Vec3 }
  scene.bounds = Number.isFinite(minX)
    ? { min: [minX, minY, minZ] as Vec3, max: [maxX, maxY, maxZ] as Vec3 }
    : fallback

  // Include walls, door leaves and tall furniture in the fitted bounds.
  const modelMin: Vec3 = [Infinity, Infinity, Infinity]
  const modelMax: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const solid of [...scene.floors, ...scene.walls, ...scene.furniture]) {
    for (const face of solid.faces) {
      for (const point of face.pts) {
        for (let axis = 0; axis < 3; axis += 1) {
          modelMin[axis] = Math.min(modelMin[axis], point[axis])
          modelMax[axis] = Math.max(modelMax[axis], point[axis])
        }
      }
    }
  }
  if (Number.isFinite(modelMin[0])) scene.bounds = { min: modelMin, max: modelMax }
  return scene
}
