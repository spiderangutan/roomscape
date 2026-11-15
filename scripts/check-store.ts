/**
 * Headless checks for the state layer: history, room rotation with furniture,
 * live drag edits, home layout, L-shape resizing, colours, door options,
 * persistence and migration of older saves.
 */
const memory = new Map<string, string>()

Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value)
    },
    removeItem: (key: string) => {
      memory.delete(key)
    },
    clear: () => memory.clear(),
  },
  window: { addEventListener: () => {}, devicePixelRatio: 1 },
  document: { addEventListener: () => {}, visibilityState: 'visible' },
})

const { store, getProject, getRoom } = await import('../src/lib/store.ts')
const { roomTopLeft, roomLayout } = await import('../src/lib/geometry.ts')

let failures = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

function signature(room: {
  length: number
  width: number
  items: Array<{ x: number; y: number; rotation: number; w: number; d: number }>
  openings: Array<{ wall: string; offset: number; width: number }>
}) {
  return JSON.stringify({
    size: [room.length, room.width],
    items: [...room.items]
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((entry) => [entry.x, entry.y, entry.rotation, entry.w, entry.d]),
    openings: [...room.openings]
      .sort((a, b) => a.offset - b.offset)
      .map((entry) => [entry.wall, entry.offset, entry.width]),
  })
}

function closeEnough(a: string, b: string, tolerance = 0.05): boolean {
  const left = JSON.parse(a) as Record<string, unknown>
  const right = JSON.parse(b) as Record<string, unknown>
  const flatten = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.flatMap(flatten)
      : typeof value === 'number'
        ? [value]
        : typeof value === 'string'
          ? [0]
          : []
  const leftNumbers = flatten(left)
  const rightNumbers = flatten(right)
  if (leftNumbers.length !== rightNumbers.length) return false
  return leftNumbers.every((value, index) => Math.abs(value - rightNumbers[index]) <= tolerance)
}

console.log('\nInitial state')
let state = store.getSnapshot()
check('sample project is loaded on first run', state.projects.length === 1 && state.projects[0].rooms.length === 5)
check('a room is open', Boolean(getRoom(state)))
check('history starts empty', !state.canUndo && !state.canRedo)
check('starts in single-room scope', state.scope === 'room')
check('every sample room has a home layout', state.projects[0].rooms.every((room) => Number.isFinite(room.layout.x)))

console.log('\nRooms and history')
store.addRoom({ name: 'Test room', length: 3000, width: 2400, wallHeight: 2600 })
state = store.getSnapshot()
const addedRoom = getProject(state)!.rooms[getProject(state)!.rooms.length - 1]
check('room added', getProject(state)?.rooms.length === 6)
check('new room gets its own home position', addedRoom.layout.x > 0 && Number.isFinite(addedRoom.layout.y))
check('undo is available', state.canUndo)
store.undo()
check('undo restores the previous room count', getProject(store.getSnapshot())?.rooms.length === 5)
store.redo()
check('redo re-applies the room', getProject(store.getSnapshot())?.rooms.length === 6)
store.undo()

store.renameRoom(getProject(store.getSnapshot())!.rooms[0].id, 'Renamed living room')
check('room rename commits', getProject(store.getSnapshot())?.rooms[0].name === 'Renamed living room')
store.undo()
check('rename is undoable', getProject(store.getSnapshot())?.rooms[0].name === 'Living Room')

console.log('\nFurniture')
const activeRoom = getRoom(store.getSnapshot())
store.addCatalogItem('sofa')
state = store.getSnapshot()
const room = getRoom(state)!
check('catalog item placed', room.items.length === (activeRoom?.items.length ?? 0) + 1)
check('new item is selected', state.selection?.kind === 'item')
const placed = state.selection?.kind === 'item' ? room.items.find((entry) => entry.id === state.selection?.id) : undefined
check('placed item keeps catalog dimensions', placed?.w === 2100 && placed?.d === 900 && placed?.h === 800)
check('placed item has a visible colour', /^#[0-9a-f]{6}$/i.test(placed?.color ?? ''))
check(
  'placed item is inside the room',
  Boolean(placed) && placed!.x >= 0 && placed!.y >= 0 && placed!.x <= room.length && placed!.y <= room.width,
)

if (placed) {
  store.updateItem(placed.id, { w: 1500 })
  check('dimensions are editable', getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)?.w === 1500)
  store.updateItem(placed.id, { color: '#96a8b5' })
  check('colour is applied', getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)?.color === '#96a8b5')
  const current = getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)!
  const beforeTurn = { x: current.x, y: current.y, w: current.w, d: current.d, h: current.h }
  store.rotateItem(placed.id, 90)
  const turnedOnce = getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)
  check('item rotation is applied', turnedOnce?.rotation === 90)
  check(
    'rotating an item never changes its size or position',
    turnedOnce?.w === beforeTurn.w &&
      turnedOnce?.d === beforeTurn.d &&
      turnedOnce?.h === beforeTurn.h &&
      turnedOnce?.x === beforeTurn.x &&
      turnedOnce?.y === beforeTurn.y,
  )
  store.rotateItem(placed.id, -90)
  const turnedBack = getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)
  check('rotating back restores the original orientation', turnedBack?.rotation === 0)
  check(
    'rotating back restores the original appearance and placement',
    turnedBack?.w === beforeTurn.w &&
      turnedBack?.d === beforeTurn.d &&
      turnedBack?.h === beforeTurn.h &&
      turnedBack?.x === beforeTurn.x &&
      turnedBack?.y === beforeTurn.y,
  )
  store.rotateItem(placed.id, 90)
  store.deleteItem(placed.id)
  check('item deleted', getRoom(store.getSnapshot())!.items.length === room.items.length - 1)
  store.undo()
  check('delete is undoable', Boolean(getRoom(store.getSnapshot())!.items.find((entry) => entry.id === placed.id)))
  store.undo()
  store.undo()
  store.undo()
  store.undo()
}

console.log('\nLive drag edits fold into one undo step')
const dragRoom = getRoom(store.getSnapshot())!
const target = dragRoom.items[0]
const original = { x: target.x, y: target.y }
store.beginInteraction()
store.updateItemLive(target.id, { x: 1200, y: 900 })
store.updateItemLive(target.id, { x: 1400, y: 1100 })
check('live edits apply', getRoom(store.getSnapshot())!.items[0].x === 1400)
store.undo()
check(
  'one undo reverts the whole drag',
  getRoom(store.getSnapshot())!.items[0].x === original.x && getRoom(store.getSnapshot())!.items[0].y === original.y,
)

console.log('\nRoom rotation')
const rotationRoom = getRoom(store.getSnapshot())!
const before = signature(rotationRoom)
for (let step = 0; step < 4; step += 1) store.rotateCurrentRoom(1)
const after = signature(getRoom(store.getSnapshot())!)
check('four 90° rotations return the original layout', closeEnough(before, after))
check(
  'rotation keeps the room area',
  (() => {
    const now = getRoom(store.getSnapshot())!
    return Math.abs(now.length * now.width - rotationRoom.length * rotationRoom.width) < 1
  })(),
)
store.rotateCurrentRoom(1)
const turned = getRoom(store.getSnapshot())!
check('one rotation swaps the room axes', turned.length === rotationRoom.width && turned.width === rotationRoom.length)
check('rotated furniture keeps its footprint', (() => {
  const sizes = turned.items.map((entry) => [entry.w, entry.d]).sort()
  const previous = rotationRoom.items.map((entry) => [entry.w, entry.d]).sort()
  return JSON.stringify(sizes) === JSON.stringify(previous)
})())
for (let step = 0; step < 3; step += 1) store.rotateCurrentRoom(1)

console.log('\nOpenings')
const openingRoom = getRoom(store.getSnapshot())!
store.addOpening('door')
state = store.getSnapshot()
check('door added', getRoom(state)!.openings.length === openingRoom.openings.length + 1)
check('opening selected', state.selection?.kind === 'opening')
const addedOpening = state.selection?.kind === 'opening'
  ? getRoom(state)!.openings.find((entry) => entry.id === state.selection?.id)
  : undefined
check('new doors default to a left hinge opening inward', addedOpening?.hinge === 'left' && addedOpening?.swing === 'in')
if (addedOpening) {
  store.updateOpening(addedOpening.id, { hinge: 'right', swing: 'out' })
  const changed = getRoom(store.getSnapshot())!.openings.find((entry) => entry.id === addedOpening.id)
  check('hinge and swing are editable', changed?.hinge === 'right' && changed?.swing === 'out')
  store.undo()
  const reverted = getRoom(store.getSnapshot())!.openings.find((entry) => entry.id === addedOpening.id)
  check('hinge and swing changes are undoable', reverted?.hinge === 'left' && reverted?.swing === 'in')
}
store.undo()
check('opening undone', getRoom(store.getSnapshot())!.openings.length === openingRoom.openings.length)

console.log('\nL-shaped furniture')
store.createCustomItem({
  name: 'L desk',
  kind: 'lshape',
  shape: 'lshape',
  w: 2000,
  d: 1600,
  h: 740,
  thickness: 500,
  color: '#c6b096',
  category: 'Custom',
})
state = store.getSnapshot()
const shaped = state.selection?.kind === 'item' ? getRoom(state)?.items.find((entry) => entry.id === state.selection?.id) : undefined
check('L-shaped item created', shaped?.shape === 'lshape' && shaped?.thickness === 500)
if (shaped) {
  store.updateItem(shaped.id, { w: 2600 })
  const widened = getRoom(store.getSnapshot())!.items.find((entry) => entry.id === shaped.id)
  check('widening an L keeps its leg thickness', widened?.thickness === 500)
  store.updateItem(shaped.id, { d: 500 })
  const squeezed = getRoom(store.getSnapshot())!.items.find((entry) => entry.id === shaped.id)
  check('squeezing an L clamps the legs instead of collapsing an arm', (squeezed?.thickness ?? 0) === 410)
  check('the L keeps its overall dimensions', squeezed?.w === 2600 && squeezed?.d === 500)
  store.deleteItem(shaped.id)
}

console.log('\nWhole-home layout')
const layoutRoom = getRoom(store.getSnapshot())!
const startLayout = roomLayout(layoutRoom)
store.setScope('home')
check('scope switches to the whole home', store.getSnapshot().scope === 'home')
store.moveRoomLayout(layoutRoom.id, 1250, 900)
const movedRoom = getRoom(store.getSnapshot())!
check('room centre can be moved', movedRoom.layout.x === 1250 && movedRoom.layout.y === 900)
store.setRoomTopLeft(layoutRoom.id, 500, 700)
const topLeft = roomTopLeft(getRoom(store.getSnapshot())!)
check('room position can be set from its top-left', Math.abs(topLeft.x - 500) < 0.6 && Math.abs(topLeft.y - 700) < 0.6)
for (let step = 0; step < 4; step += 1) store.rotateRoomLayout(layoutRoom.id, 90)
check('four plan rotations return to the start', roomLayout(getRoom(store.getSnapshot())!).rotation === startLayout.rotation)
store.undo()
store.undo()
store.undo()

console.log('\nEditing an item from another room')
const homeProject = getProject(store.getSnapshot())!
const otherRoom = homeProject.rooms[1]
const otherItem = otherRoom.items[0]
store.openRoom(homeProject.rooms[2].id)
store.updateItem(otherItem.id, { color: '#a3b096' })
check(
  'items can be edited from any room in home view',
  getProject(store.getSnapshot())!.rooms[1].items.find((entry) => entry.id === otherItem.id)?.color === '#a3b096',
)

console.log('\nPersistence round-trip')
store.setScope('home')
store.flush()
const raw = memory.get('roomscape.v1')
check('payload written to localStorage', Boolean(raw))
const payload = raw
  ? (JSON.parse(raw) as { version: number; projects: unknown[]; roomId: string; scope: string })
  : { version: 0, projects: [], roomId: '', scope: '' }
check('payload holds every project', payload.projects.length === store.getSnapshot().projects.length)
check('payload is version 2', payload.version === 2)
check('scope is saved', payload.scope === 'home')

const savedRaw = raw as string
const fresh = (await import(`${['..', 'src', 'lib', 'store.ts'].join('/')}?reload=1`)) as {
  store: typeof store
  getRoom: typeof getRoom
}
const reloaded = fresh.store.getSnapshot()
check('a fresh session loads the same projects', reloaded.projects.length === store.getSnapshot().projects.length)
check('a fresh session restores the open room', reloaded.roomId === store.getSnapshot().roomId)
check('a fresh session restores the scope', reloaded.scope === 'home')
check(
  'restored rooms keep their furniture',
  JSON.stringify(fresh.getRoom(reloaded)?.items.length) === JSON.stringify(getRoom(store.getSnapshot())?.items.length),
)
check('restored rooms keep home positions', reloaded.projects[0].rooms.every((room) => Number.isFinite(room.layout.x)))
check('history is not part of the restored state', !reloaded.canUndo)

console.log('\nMigration of an older save')
const legacy = JSON.parse(savedRaw) as {
  version: number
  projects: Array<{
    unit?: string
    rooms: Array<{
      layout?: unknown
      items: Array<{ color?: string; shape?: string; thickness?: number }>
      openings: Array<{ hinge?: string; swing?: string }>
    }>
  }>
}
legacy.version = 1
for (const project of legacy.projects) {
  for (const legacyRoom of project.rooms) {
    delete legacyRoom.layout
    for (const legacyItem of legacyRoom.items) {
      delete legacyItem.color
      delete legacyItem.thickness
    }
    for (const legacyOpening of legacyRoom.openings) {
      delete legacyOpening.hinge
      delete legacyOpening.swing
    }
  }
}
memory.set('roomscape.v1', JSON.stringify(legacy))
const migratedModule = (await import(`${['..', 'src', 'lib', 'store.ts'].join('/')}?migrate=1`)) as {
  store: typeof store
}
const migrated = migratedModule.store.getSnapshot()
check('older projects still load', migrated.projects.length === legacy.projects.length)
check(
  'missing home layouts are filled in',
  migrated.projects.every((project) => project.rooms.every((entry) => Number.isFinite(entry.layout.x) && Number.isFinite(entry.layout.y))),
)
check(
  'missing item colours get a visible default',
  migrated.projects.every((project) =>
    project.rooms.every((entry) =>
      entry.items.every((furniture) => /^#[0-9a-f]{6}$/i.test(furniture.color) && furniture.color !== '#000000'),
    ),
  ),
)
check(
  'doors without hinge options get safe defaults',
  migrated.projects.every((project) =>
    project.rooms.every((entry) =>
      entry.openings.every((opening) => opening.hinge === 'left' && opening.swing === 'in'),
    ),
  ),
)
check('migrated rooms keep their furniture count', migrated.projects[0].rooms[0].items.length > 0)

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll state checks passed.')

export {}
