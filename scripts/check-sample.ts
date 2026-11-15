import { newSampleProject } from '../src/lib/sample.ts'
import { CATALOG } from '../src/lib/catalog.ts'
import {
  clampLshapeThickness,
  doorSwingGeometry,
  itemObb,
  lshapePoints,
  lshapeThickness,
  roomFitIssues,
  roomRect,
  roomToWorld,
} from '../src/lib/geometry.ts'
import { buildHomeScene, buildScene, faceColor } from '../src/lib/scene3d.ts'
import { itemParts } from '../src/lib/parts.ts'
import { formatLength, parseLength } from '../src/lib/units.ts'
import type { FurnitureItem, Opening, Room } from '../src/types.ts'

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

function checkEqual<T>(label: string, actual: T, expected: T): void {
  check(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

function close(actual: number, expected: number, tolerance = 0.6): boolean {
  return Math.abs(actual - expected) <= tolerance
}

function item(partial: Partial<FurnitureItem> & { name: string; x: number; y: number }): FurnitureItem {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    kind: 'box',
    shape: 'box',
    color: '#cccccc',
    x: partial.x,
    y: partial.y,
    w: partial.w ?? 800,
    d: partial.d ?? 600,
    h: partial.h ?? 700,
    rotation: partial.rotation ?? 0,
    thickness: partial.thickness,
    fixed: partial.fixed,
    overlappable: partial.overlappable,
  }
}

function baseRoom(partial: Partial<Room> & { id: string; name: string; length: number; width: number }): Room {
  return {
    id: partial.id,
    name: partial.name,
    length: partial.length,
    width: partial.width,
    wallHeight: partial.wallHeight ?? 2500,
    layout: partial.layout ?? { x: partial.length / 2, y: partial.width / 2, rotation: 0 },
    openings: partial.openings ?? [],
    items: partial.items ?? [],
  }
}

/** Shoelace area of a simple polygon. */
function polygonArea(points: Array<{ x: number; y: number }>): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** rgb() colours must be visible: never near-black. */
function visibleColor(color: string): boolean {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color)
  if (!match) return false
  const [r, g, b] = match.slice(1).map(Number)
  return r + g + b > 90 && Math.max(r, g, b) > 40
}

console.log('\nUnits')
checkEqual('12 ft 6 in → mm', parseLength('12 ft 6 in', 'ft'), 3810)
checkEqual('5\'6" → mm', parseLength('5\'6"', 'ft'), 1676.4)
checkEqual('2.4 m → mm', parseLength('2.4 m', 'm'), 2400)
checkEqual('85cm → mm', parseLength('85 cm', 'cm'), 850)
checkEqual('bare number uses the display unit', parseLength('900', 'mm'), 900)
checkEqual('7 ft 6 → mm (implicit inches)', parseLength('7 ft 6', 'ft'), 2286)
checkEqual('comma decimals', parseLength('2,4 m', 'm'), 2400)
checkEqual('unreadable input', parseLength('wide please', 'ft'), null)
checkEqual('mm → 12 ft 6 in', formatLength(3810, 'ft'), '12 ft 6 in')
checkEqual('mm → 1 ft', formatLength(304.8, 'ft'), '1 ft')
checkEqual('mm → 2.4 m', formatLength(2400, 'm'), '2.4 m')
checkEqual('mm → 85 cm', formatLength(850, 'cm'), '85 cm')

console.log('\nFit feedback')
const opening: Opening = {
  id: 'door',
  type: 'door',
  wall: 'n',
  offset: 1000,
  width: 900,
  height: 2050,
  sill: 0,
  hinge: 'left',
  swing: 'in',
}
const testRoom = baseRoom({
  id: 'test',
  name: 'Test room',
  length: 4000,
  width: 3000,
  openings: [opening],
  items: [
    item({ name: 'Blocking box', x: 1450, y: 450, w: 500, d: 500 }),
    item({ name: 'Sofa', x: 2500, y: 1500 }),
    item({ name: 'Sofa twin', x: 2600, y: 1550 }),
    item({ name: 'Outside box', x: 3900, y: 2900, w: 600, d: 600 }),
  ],
})
let issues = roomFitIssues(testRoom)
checkEqual('one blocking, one overlap, one outside', issues.length, 3)
check(
  'blocking a door is reported',
  issues.some((issue) => issue.kind === 'blocking'),
)
check(
  'leaving the room is reported',
  issues.some((issue) => issue.kind === 'outside'),
)
check(
  'overlapping is reported',
  issues.some((issue) => issue.kind === 'overlap'),
)

testRoom.items[0].fixed = true
check('fixtures never block openings', !roomFitIssues(testRoom).some((issue) => issue.kind === 'blocking'))
testRoom.items[2].overlappable = true
check('layered items never clash', !roomFitIssues(testRoom).some((issue) => issue.kind === 'overlap'))

const outwardRoom = baseRoom({
  id: 'outward',
  name: 'Outward door',
  length: 4000,
  width: 3000,
  openings: [{ ...opening, swing: 'out' }],
  items: [item({ name: 'Sofa', x: 1450, y: 450, w: 500, d: 500 })],
})
check('an outward door does not demand indoor clearance', roomFitIssues(outwardRoom).length === 0)

console.log('\nDoor hinge and swing')
const doorRoom = baseRoom({ id: 'doors', name: 'Doors', length: 4000, width: 3000 })
const leftIn = doorSwingGeometry(doorRoom, opening)
check('left hinge sits at the opening start', close(leftIn.hinge.x, 1000) && close(leftIn.hinge.y, 0))
check('left hinge opens into the room', close(leftIn.tip.x, 1000) && close(leftIn.tip.y, 900))
check('left hinge meets the far jamb', close(leftIn.other.x, 1900) && close(leftIn.other.y, 0))
check('the swing arc ends at the open leaf', close(leftIn.arc[leftIn.arc.length - 1].x, 1000) && close(leftIn.arc[leftIn.arc.length - 1].y, 900))

const rightOut = doorSwingGeometry(doorRoom, { ...opening, hinge: 'right', swing: 'out' })
check('right hinge sits at the opening end', close(rightOut.hinge.x, 1900) && close(rightOut.hinge.y, 0))
check('right hinge opens away from the room', close(rightOut.tip.x, 1900) && close(rightOut.tip.y, -900))
check('right hinge meets the far jamb', close(rightOut.other.x, 1000) && close(rightOut.other.y, 0))

const eastDoor = doorSwingGeometry(
  doorRoom,
  { ...opening, wall: 'e', offset: 500, width: 800, hinge: 'left', swing: 'in' },
)
check('east door hinges and opens inward correctly', close(eastDoor.hinge.x, 4000) && close(eastDoor.hinge.y, 500) && close(eastDoor.tip.x, 3200) && close(eastDoor.tip.y, 500))

console.log('\nL-shaped items')
const lshapeParts = itemParts('lshape', 'lshape', { w: 2000, d: 1400, h: 740, thickness: 500 })
check('an L is built from exactly two blocks', lshapeParts.length === 2)
check('both L legs keep the requested thickness', lshapeParts[0].d === 500 && lshapeParts[1].w === 500)
check('the two L blocks meet without overlapping', close(lshapeParts[0].z + lshapeParts[0].d / 2, lshapeParts[1].z - lshapeParts[1].d / 2, 0.001))
check('resizing keeps a stored leg thickness', lshapeThickness({ w: 2600, d: 1400, thickness: 500 }) === 500)
check('thickness is clamped so both arms survive', clampLshapeThickness(500, 2000, 400) === 310)
const points = lshapePoints(2000, 1400, 500)
check('the L footprint has six corners', points.length === 6)
check('the L footprint keeps its area when resized', close(polygonArea(points), 2000 * 500 + 500 * 900, 1))
check(
  'the L footprint stays inside its width and depth',
  points.every((point) => Math.abs(point.x) <= 1000.0001 && Math.abs(point.y) <= 700.0001),
)

console.log('\nFurniture geometry')
for (const catalog of CATALOG) {
  const parts = itemParts(catalog.kind, catalog.shape, {
    w: catalog.w,
    d: catalog.d,
    h: catalog.h,
    thickness: catalog.thickness,
  })
  const outside = parts.filter(
    (part) =>
      Math.abs(part.x) + part.w / 2 > catalog.w / 2 + 0.51 ||
      Math.abs(part.z) + part.d / 2 > catalog.d / 2 + 0.51 ||
      part.y - part.h / 2 < -0.51 ||
      part.y + part.h / 2 > catalog.h + 0.51,
  )
  check(
    `${catalog.name}: ${parts.length} parts stay inside its footprint and height`,
    outside.length === 0,
    outside.map((part) => `${part.x},${part.y},${part.z} ${part.w}x${part.d}x${part.h}`).join('; '),
  )
}

console.log('\nRigid rotation')
const rotationItem: FurnitureItem = item({
  name: 'Rotating L',
  kind: 'lshape',
  shape: 'lshape',
  x: 2500,
  y: 2000,
  w: 1600,
  d: 1200,
  h: 740,
  rotation: 0,
  thickness: 500,
})
const rotationRoom = baseRoom({ id: 'rotation', name: 'Rotation', length: 5000, width: 4000, items: [rotationItem] })

function normalizedGeometry(rotation: number): string {
  const scene = buildScene(
    { ...rotationRoom, items: [{ ...rotationItem, rotation }] },
    { wallFraction: 0.62 },
  )
  const rad = (-rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const points = scene.furniture.flatMap((solid) =>
    solid.faces.flatMap((face) =>
      face.pts.map((point) => {
        const x = point[0] - rotationItem.x
        const z = point[2] - rotationItem.y
        return [
          Math.round((x * cos - z * sin) * 10) / 10,
          Math.round(point[1] * 10) / 10,
          Math.round((x * sin + z * cos) * 10) / 10,
        ]
      }),
    ),
  )
  return JSON.stringify(points.sort())
}

const originalGeometry = normalizedGeometry(0)
for (const rotation of [90, -90, 180, 270, 360]) {
  check(
    `${rotation}° keeps every part in its rigid position`,
    normalizedGeometry(rotation) === originalGeometry,
  )
}
const rotationObb = itemObb(rotationItem)
check(
  'the 2D footprint keeps its dimensions at any orientation',
  rotationObb.w === rotationItem.w && rotationObb.d === rotationItem.d,
)
check(
  'rotation never rewrites stored dimensions',
  rotationItem.w === 1600 && rotationItem.d === 1200 && rotationItem.h === 740 && rotationItem.thickness === 500,
)

console.log('\nSample project')
const project = newSampleProject()
let itemCount = 0
let openingCount = 0

for (const room of project.rooms) {
  const roomIssues = roomFitIssues(room)
  itemCount += room.items.length
  openingCount += room.openings.length
  check(
    `${room.name}: layout is clean (${room.items.length} items, ${room.openings.length} openings)`,
    roomIssues.length === 0,
    roomIssues.map((issue) => issue.message).join('; '),
  )
  check(
    `${room.name}: has a saved whole-home position`,
    Number.isFinite(room.layout.x) && Number.isFinite(room.layout.y),
  )

  const scene = buildScene(room, { wallFraction: 0.62 })
  const solids = [...scene.floors, ...scene.walls, ...scene.furniture]
  const finite = solids.every((solid) =>
    solid.faces.every((face) => face.pts.every((point) => point.every((value) => Number.isFinite(value)))),
  )
  check(`${room.name}: scene geometry is finite`, finite)
  check(
    `${room.name}: scene has walls, furniture and grid`,
    scene.walls.length >= 4 && scene.furniture.length > 0 && scene.gridLines.length > 0,
    `walls=${scene.walls.length} furniture=${scene.furniture.length}`,
  )
  check(
    `${room.name}: every face has a valid base colour`,
    solids.every((solid) => solid.faces.every((face) => /^#[0-9a-f]{6}$/i.test(face.base))),
  )

  const allFaces = solids.flatMap((solid) => solid.faces)
  const black = allFaces
    .map((face) => ({ face, color: faceColor(face) }))
    .filter((entry) => !visibleColor(entry.color))
  check(
    `${room.name}: no material renders black (${allFaces.length} faces)`,
    black.length === 0,
    black.slice(0, 3).map((entry) => `${entry.face.base} → ${entry.color}`).join(', '),
  )

  const slack = 1200
  const inside = scene.furniture.every((solid) =>
    solid.faces.every((face) =>
      face.pts.every(
        (point) =>
          point[0] > -slack &&
          point[0] < room.length + slack &&
          point[2] > -slack &&
          point[2] < room.width + slack &&
          point[1] >= -1 &&
          point[1] <= room.wallHeight + 1,
      ),
    ),
  )
  check(`${room.name}: furniture sits inside the room volume`, inside)
}

console.log('\nWhole-home scene')
const home = buildHomeScene(project.rooms, { wallFraction: 0.62, grid: false, labels: true })
check('one floor per room', home.floors.length === project.rooms.length)
check('one name label per room', home.labels.length === project.rooms.length)
check('furniture keeps its owning room', home.furniture.every((solid) => Boolean(solid.itemId && solid.roomId)))
check('exactly one door leaf per sample door', home.walls.filter((solid) => solid.kind === 'door').length >= 5)

const structuralPerRoom = project.rooms.reduce(
  (sum, room) => sum + buildScene(room, { wallFraction: 0.62 }).walls.filter((solid) => solid.kind === 'wall').length,
  0,
)
const structuralHome = home.walls.filter((solid) => solid.kind === 'wall').length
check(
  'shared walls are collapsed in the home view',
  structuralHome < structuralPerRoom,
  `${structuralHome} vs ${structuralPerRoom}`,
)

const living = project.rooms[0]
const sofa = living.items.find((entry) => entry.kind === 'sofa')
const localSofa = buildScene(living, { wallFraction: 0.62 }).furniture.filter((solid) => solid.itemId === sofa?.id)
const homeSofa = home.furniture.filter((solid) => solid.itemId === sofa?.id)
const placedCorrectly =
  localSofa.length > 0 &&
  localSofa.length === homeSofa.length &&
  localSofa.every((solid, index) => {
    const expectedPart = roomToWorld(living, { x: solid.centre[0], y: solid.centre[2] })
    const actual = homeSofa[index].centre
    return close(actual[0], expectedPart.x, 2) && close(actual[2], expectedPart.y, 2)
  })
check('home furniture follows the room position, part for part', placedCorrectly)

const boundsCoverRooms = project.rooms.every((room) => {
  const rect = roomRect(room)
  return (
    home.bounds.min[0] <= rect.minX &&
    home.bounds.max[0] >= rect.maxX &&
    home.bounds.min[2] <= rect.minY &&
    home.bounds.max[2] >= rect.maxY
  )
})
check('home bounds cover every room', boundsCoverRooms)

const rotatedLayout = { ...living, layout: { x: 1000, y: 2000, rotation: 90 } }
const corner = roomToWorld(rotatedLayout, { x: 0, y: 0 })
check(
  'room rotation transforms local corners correctly',
  close(corner.x, 1000 + living.width / 2, 0.01) && close(corner.y, 2000 - living.length / 2, 0.01),
  `${corner.x}, ${corner.y}`,
)

console.log(`\n${project.rooms.length} rooms · ${itemCount} items · ${openingCount} openings`)

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll model checks passed.')
