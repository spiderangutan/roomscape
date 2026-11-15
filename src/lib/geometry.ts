import type { DoorHinge, DoorSwing, FurnitureItem, Opening, Room, RoomLayout, Wall } from '../types.ts'

export interface Pt {
  x: number
  y: number
}

/** Axis-aligned footprint described by a centre, size and rotation. */
export interface Obb {
  x: number
  y: number
  w: number
  d: number
  rot: number
}

/** Millimetres of allowed interpenetration before a warning appears. */
export const OVERLAP_TOLERANCE = 20
export const WALL_THICKNESS = 120
export const DOOR_CLEARANCE = 900
export const WINDOW_CLEARANCE = 300
export const WALLS: Wall[] = ['n', 'e', 's', 'w']

export const WALL_NAMES: Record<Wall, string> = {
  n: 'north',
  e: 'east',
  s: 'south',
  w: 'west',
}

export function rectCorners(rect: Obb): Pt[] {
  const rad = (rect.rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hw = rect.w / 2
  const hd = rect.d / 2
  const local: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ]
  return local.map(([dx, dy]) => ({
    x: rect.x + dx * cos - dy * sin,
    y: rect.y + dx * sin + dy * cos,
  }))
}

export function itemObb(item: FurnitureItem): Obb {
  return { x: item.x, y: item.y, w: item.w, d: item.d, rot: item.rotation }
}

function projectOnto(points: Pt[], axis: Pt): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    const value = point.x * axis.x + point.y * axis.y
    if (value < min) min = value
    if (value > max) max = value
  }
  return [min, max]
}

/** Separating-axis test on two rotated rectangles. */
export function obbOverlap(a: Obb, b: Obb, tolerance = OVERLAP_TOLERANCE): boolean {
  const ptsA = rectCorners(a)
  const ptsB = rectCorners(b)
  const axes: Pt[] = []
  for (const rect of [a, b]) {
    const rad = (rect.rot * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    axes.push({ x: cos, y: sin }, { x: -sin, y: cos })
  }
  for (const axis of axes) {
    const [aMin, aMax] = projectOnto(ptsA, axis)
    const [bMin, bMax] = projectOnto(ptsB, axis)
    if (Math.min(aMax, bMax) - Math.max(aMin, bMin) <= tolerance) return false
  }
  return true
}

export function pointInObb(point: Pt, rect: Obb): boolean {
  const rad = (-rect.rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - rect.x
  const dy = point.y - rect.y
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos
  return Math.abs(localX) <= rect.w / 2 && Math.abs(localY) <= rect.d / 2
}

export function obbOutsideRoom(rect: Obb, length: number, width: number, tolerance = 2): boolean {
  for (const corner of rectCorners(rect)) {
    if (
      corner.x < -tolerance ||
      corner.y < -tolerance ||
      corner.x > length + tolerance ||
      corner.y > width + tolerance
    ) {
      return true
    }
  }
  return false
}

export function wallLength(room: Room, wall: Wall): number {
  return wall === 'n' || wall === 's' ? room.length : room.width
}

/** Point on a wall at `along` mm from that wall's start, in room coordinates. */
export function wallPoint(room: Room, wall: Wall, along: number): Pt {
  switch (wall) {
    case 'n':
      return { x: along, y: 0 }
    case 'e':
      return { x: room.length, y: along }
    case 's':
      return { x: room.length - along, y: room.width }
    case 'w':
    default:
      return { x: 0, y: room.width - along }
  }
}

/** Unit vector along a wall, from its start towards its end. */
export function wallAlong(wall: Wall): Pt {
  switch (wall) {
    case 'n':
      return { x: 1, y: 0 }
    case 'e':
      return { x: 0, y: 1 }
    case 's':
      return { x: -1, y: 0 }
    case 'w':
    default:
      return { x: 0, y: -1 }
  }
}

/** Unit vector pointing from the wall into the room. */
export function wallInward(wall: Wall): Pt {
  switch (wall) {
    case 'n':
      return { x: 0, y: 1 }
    case 'e':
      return { x: -1, y: 0 }
    case 's':
      return { x: 0, y: -1 }
    case 'w':
    default:
      return { x: 1, y: 0 }
  }
}

/** Unit vector pointing from the room out through the wall. */
export function wallOutward(wall: Wall): Pt {
  const inward = wallInward(wall)
  return { x: -inward.x, y: -inward.y }
}

export function openingCenter(room: Room, opening: Opening): Pt {
  return wallPoint(room, opening.wall, opening.offset + opening.width / 2)
}

export function doorHinge(opening: Opening): DoorHinge {
  return opening.hinge === 'right' ? 'right' : 'left'
}

export function doorSwing(opening: Opening): DoorSwing {
  return opening.swing === 'out' ? 'out' : 'in'
}

export interface DoorGeometry {
  hinge: Pt
  /** Where the open leaf points. */
  tip: Pt
  /** The other jamb, along the wall. */
  other: Pt
  /** Swing arc from the closed position to the open leaf. */
  arc: Pt[]
  /** Direction the leaf opens towards. */
  perp: Pt
}

/**
 * Door leaf and swing arc in room coordinates. The hinge sits on the chosen
 * jamb and the leaf opens 90° towards the chosen side of the wall.
 */
export function doorSwingGeometry(room: Room, opening: Opening): DoorGeometry {
  const atlas = doorHinge(opening)
  const start = atlas === 'left' ? opening.offset : opening.offset + opening.width
  const hinge = wallPoint(room, opening.wall, start)
  const along = wallAlong(opening.wall)
  const sign = atlas === 'left' ? 1 : -1
  const alongDir = { x: along.x * sign, y: along.y * sign }
  const perp = doorSwing(opening) === 'out' ? wallOutward(opening.wall) : wallInward(opening.wall)
  const arc: Pt[] = []
  for (let i = 0; i <= 12; i += 1) {
    const t = (i / 12) * (Math.PI / 2)
    arc.push({
      x: hinge.x + (alongDir.x * Math.cos(t) + perp.x * Math.sin(t)) * opening.width,
      y: hinge.y + (alongDir.y * Math.cos(t) + perp.y * Math.sin(t)) * opening.width,
    })
  }
  return {
    hinge,
    tip: { x: hinge.x + perp.x * opening.width, y: hinge.y + perp.y * opening.width },
    other: { x: hinge.x + alongDir.x * opening.width, y: hinge.y + alongDir.y * opening.width },
    arc,
    perp,
  }
}

/** Box of wall band removed by an opening, used for 3D wall segmentation. */
export interface WallRun {
  wall: Wall
  length: number
  segments: Array<[number, number]>
  openings: Array<{ opening: Opening; start: number; end: number }>
}

export function wallRuns(room: Room): WallRun[] {
  return WALLS.map((wall) => {
    const length = wallLength(room, wall)
    const openings = (room.openings ?? [])
      .filter((opening) => opening.wall === wall)
      .map((opening) => {
        const start = Math.max(0, Math.min(length, opening.offset))
        const end = Math.max(0, Math.min(length, opening.offset + opening.width))
        return { opening, start, end }
      })
      .filter((entry) => entry.end - entry.start > 10)
      .sort((a, b) => a.start - b.start)

    const segments: Array<[number, number]> = []
    let cursor = 0
    for (const entry of openings) {
      if (entry.start - cursor > 5) segments.push([cursor, entry.start])
      cursor = Math.max(cursor, entry.end)
    }
    if (length - cursor > 5) segments.push([cursor, length])
    return { wall, length, segments, openings }
  })
}

/** Footprint rectangle for a stretch of wall, used by both renderers. */
export function wallSegmentObb(
  room: Room,
  wall: Wall,
  start: number,
  end: number,
  thickness = WALL_THICKNESS,
): Obb {
  const span = end - start
  switch (wall) {
    case 'n':
      return { x: (start + end) / 2, y: thickness / 2, w: span, d: thickness, rot: 0 }
    case 's':
      return { x: room.length - (start + end) / 2, y: room.width - thickness / 2, w: span, d: thickness, rot: 0 }
    case 'e':
      return { x: room.length - thickness / 2, y: (start + end) / 2, w: thickness, d: span, rot: 0 }
    case 'w':
    default:
      return { x: thickness / 2, y: room.width - (start + end) / 2, w: thickness, d: span, rot: 0 }
  }
}

/** Area in front of an opening that furniture should keep clear. */
export function openingClearance(room: Room, opening: Opening): Obb {
  const depth = opening.type === 'door' ? DOOR_CLEARANCE : WINDOW_CLEARANCE
  // A door only needs clearance on the side it opens towards.
  const inside = opening.type === 'door' ? doorSwing(opening) !== 'out' : true
  const direction = inside ? wallInward(opening.wall) : wallOutward(opening.wall)
  const centre = openingCenter(room, opening)
  const offsetX = direction.x * (depth / 2)
  const offsetY = direction.y * (depth / 2)
  const horizontal = opening.wall === 'n' || opening.wall === 's'
  return {
    x: centre.x + offsetX,
    y: centre.y + offsetY,
    w: horizontal ? opening.width : depth,
    d: horizontal ? depth : opening.width,
    rot: 0,
  }
}

export type IssueKind = 'overlap' | 'outside' | 'blocking'

export interface FitIssue {
  id: string
  kind: IssueKind
  itemIds: string[]
  message: string
}

/** Everything that is wrong with the current arrangement. */
export function roomFitIssues(room: Room): FitIssue[] {
  const issues: FitIssue[] = []
  const items = room.items ?? []

  for (const item of items) {
    if (obbOutsideRoom(itemObb(item), room.length, room.width)) {
      issues.push({
        id: `outside-${item.id}`,
        kind: 'outside',
        itemIds: [item.id],
        message: `${item.name} extends past the room walls.`,
      })
    }
  }

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      if (a.overlappable || b.overlappable) continue
      if (a.fixed && b.fixed) continue
      if (!obbOverlap(itemObb(a), itemObb(b))) continue
      issues.push({
        id: `overlap-${a.id}-${b.id}`,
        kind: 'overlap',
        itemIds: [a.id, b.id],
        message: `${a.name} overlaps ${b.name}.`,
      })
    }
  }

  for (const opening of room.openings ?? []) {
    const zone = openingClearance(room, opening)
    for (const item of items) {
      if (item.fixed || item.overlappable) continue
      if (opening.type === 'window' && item.h <= opening.sill + 20) continue
      if (!obbOverlap(itemObb(item), zone, 10)) continue
      issues.push({
        id: `blocking-${opening.id}-${item.id}`,
        kind: 'blocking',
        itemIds: [item.id],
        message: `${item.name} blocks the ${opening.type} on the ${WALL_NAMES[opening.wall]} wall.`,
      })
    }
  }

  return issues
}

export function issuesByItem(issues: FitIssue[]): Map<string, FitIssue[]> {
  const map = new Map<string, FitIssue[]>()
  for (const issue of issues) {
    for (const id of issue.itemIds) {
      const list = map.get(id)
      if (list) list.push(issue)
      else map.set(id, [issue])
    }
  }
  return map
}

/**
 * Rotate a room's contents by 90 degrees: walls, doors, windows and furniture
 * turn together while every item keeps its own width/depth/height.
 */
export function rotateRoom(room: Room, direction: 1 | -1): Room {
  const oldLength = room.length
  const oldWidth = room.width
  const newLength = oldWidth
  const newWidth = oldLength

  const items = room.items.map((item) => {
    const x = direction === 1 ? oldWidth - item.y : item.y
    const y = direction === 1 ? item.x : oldLength - item.x
    return {
      ...item,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      rotation: (item.rotation + (direction === 1 ? 90 : 270)) % 360,
    }
  })

  const clockwise: Record<Wall, Wall> = { n: 'e', e: 's', s: 'w', w: 'n' }
  const counter: Record<Wall, Wall> = { n: 'w', w: 's', s: 'e', e: 'n' }
  const map = direction === 1 ? clockwise : counter
  const openings = room.openings.map((opening) => ({
    ...opening,
    wall: map[opening.wall],
    offset: Math.min(opening.offset, Math.max(0, newLength - opening.width)),
  }))

  return { ...room, length: newLength, width: newWidth, items, openings }
}

export function itemLayer(item: FurnitureItem): number {
  if (item.overlappable || item.kind === 'rug') return 0
  if (item.fixed) return 1
  return 2
}

export function sortForDisplay(items: FurnitureItem[]): FurnitureItem[] {
  return [...items].sort((a, b) => itemLayer(a) - itemLayer(b))
}

/** Find a spot in the room where a new item fits without overlapping. */
export function findFreeSpot(room: Room, w: number, d: number): Pt {
  const centre = { x: room.length / 2, y: room.width / 2 }
  const others = room.items.filter((item) => !item.overlappable)
  const fits = (x: number, y: number) => {
    const candidate: Obb = { x, y, w, d, rot: 0 }
    if (obbOutsideRoom(candidate, room.length, room.width, -1)) return false
    return !others.some((item) => obbOverlap(candidate, itemObb(item), 10))
  }
  if (fits(centre.x, centre.y)) return centre

  const step = 150
  const candidates: Array<{ x: number; y: number; dist: number }> = []
  for (let x = w / 2 + 40; x <= room.length - w / 2 - 40; x += step) {
    for (let y = d / 2 + 40; y <= room.width - d / 2 - 40; y += step) {
      candidates.push({ x, y, dist: (x - centre.x) ** 2 + (y - centre.y) ** 2 })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)
  for (const candidate of candidates) {
    if (fits(candidate.x, candidate.y)) return { x: candidate.x, y: candidate.y }
  }
  return centre
}

export function snapValue(value: number, step: number, enabled: boolean): number {
  if (!enabled || step <= 0) return value
  return Math.round(value / step) * step
}

// ------------------------------------------------------------- room layouts

export const MIN_ITEM = 120
const LSHAPE_MIN_ARM = 90
const LSHAPE_MIN_THICKNESS = 50

export function normalizeAngle(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360
}

export function roomLayout(room: Room): RoomLayout {
  return room.layout ?? { x: room.length / 2, y: room.width / 2, rotation: 0 }
}

/** Width and height a room occupies in the home plan, including its rotation. */
export function roomFootprint(room: Room): { w: number; h: number } {
  const rotation = normalizeAngle(roomLayout(room).rotation)
  return rotation === 90 || rotation === 270
    ? { w: room.width, h: room.length }
    : { w: room.length, h: room.width }
}

export function roomRect(room: Room): { minX: number; minY: number; maxX: number; maxY: number } {
  const layout = roomLayout(room)
  const { w, h } = roomFootprint(room)
  return {
    minX: layout.x - w / 2,
    minY: layout.y - h / 2,
    maxX: layout.x + w / 2,
    maxY: layout.y + h / 2,
  }
}

/** Room-local point → home coordinates. */
export function roomToWorld(room: Room, point: Pt): Pt {
  const layout = roomLayout(room)
  const rad = (layout.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - room.length / 2
  const dy = point.y - room.width / 2
  return { x: layout.x + dx * cos - dy * sin, y: layout.y + dx * sin + dy * cos }
}

/** Home coordinates → room-local point. */
export function roomFromWorld(room: Room, point: Pt): Pt {
  const layout = roomLayout(room)
  const rad = (-layout.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - layout.x
  const dy = point.y - layout.y
  return {
    x: room.length / 2 + dx * cos - dy * sin,
    y: room.width / 2 + dx * sin + dy * cos,
  }
}

/** Top-left corner of a room's rotated footprint in home coordinates. */
export function roomTopLeft(room: Room): Pt {
  const rect = roomRect(room)
  return { x: rect.minX, y: rect.minY }
}

export function homeBounds(
  rooms: Room[],
  margin = 600,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!rooms.length) return { minX: 0, minY: 0, maxX: 4000, maxY: 3000 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const room of rooms) {
    const rect = roomRect(room)
    minX = Math.min(minX, rect.minX)
    minY = Math.min(minY, rect.minY)
    maxX = Math.max(maxX, rect.maxX)
    maxY = Math.max(maxY, rect.maxY)
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }
}

/** Lay rooms out in a row, sharing walls, for projects saved before layouts. */
export function autoLayoutRooms(rooms: Room[]): Room[] {
  let cursor = 0
  return rooms.map((room) => {
    const layout: RoomLayout = { x: cursor + room.length / 2, y: room.width / 2, rotation: 0 }
    cursor += room.length
    return { ...room, layout }
  })
}

/** Where a new room can sit without landing on top of an existing one. */
export function freeRoomLayout(rooms: Room[], room: Pick<Room, 'length' | 'width'>): RoomLayout {
  if (!rooms.length) return { x: room.length / 2, y: room.width / 2, rotation: 0 }
  const bounds = homeBounds(rooms, 0)
  return { x: bounds.maxX + room.length / 2, y: bounds.minY + room.width / 2, rotation: 0 }
}

// -------------------------------------------------------------- L-shaped items

export function lshapeThickness(item: Pick<FurnitureItem, 'w' | 'd' | 'thickness'>): number {
  const max = Math.min(item.w, item.d) - LSHAPE_MIN_ARM
  const fallback = Math.min(item.w, item.d) * 0.4
  const requested = item.thickness ?? fallback
  return clampNumber(requested, LSHAPE_MIN_THICKNESS, Math.max(LSHAPE_MIN_THICKNESS, max))
}

/** Keep an L-shape's legs thick enough that both arms still read as arms. */
export function clampLshapeThickness(thickness: number, w: number, d: number): number {
  const max = Math.min(w, d) - LSHAPE_MIN_ARM
  return clampNumber(thickness, LSHAPE_MIN_THICKNESS, Math.max(LSHAPE_MIN_THICKNESS, max))
}

/** L-shaped footprint, centred on the item origin. */
export function lshapePoints(w: number, d: number, thickness: number): Pt[] {
  const t = clampLshapeThickness(thickness, w, d)
  const hw = w / 2
  const hd = d / 2
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: -hd + t },
    { x: -hw + t, y: -hd + t },
    { x: -hw + t, y: hd },
    { x: -hw, y: hd },
  ]
}

/** L-shaped footprint in room coordinates. */
export function itemPolygon(item: FurnitureItem): Pt[] {
  return lshapePoints(item.w, item.d, lshapeThickness(item)).map((point) => ({
    x: item.x + point.x,
    y: item.y + point.y,
  }))
}

/** Clamp an item so its rotated footprint stays inside the room. */
export function clampItemInsideRoom(
  room: Pick<Room, 'length' | 'width'>,
  item: Pick<FurnitureItem, 'x' | 'y' | 'w' | 'd' | 'rotation'>,
): Pt {
  const rad = (item.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const extX = (cos * item.w + sin * item.d) / 2
  const extY = (sin * item.w + cos * item.d) / 2
  const x =
    extX * 2 <= room.length
      ? clampNumber(item.x, extX, room.length - extX)
      : room.length / 2
  const y =
    extY * 2 <= room.width
      ? clampNumber(item.y, extY, room.width - extY)
      : room.width / 2
  return { x, y }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
