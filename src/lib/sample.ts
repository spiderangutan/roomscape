import type { DoorHinge, DoorSwing, FurnitureItem, Opening, Project, Room, RoomLayout, Wall } from '../types.ts'
import { CATALOG_BY_ID } from './catalog.ts'
import { uid } from './util.ts'

const ft = (value: number) => Math.round(value * 304.8)
const inch = (value: number) => Math.round(value * 25.4)

let sequence = 0
function id(prefix: string): string {
  sequence += 1
  return `${prefix}_sample${sequence}`
}

function makeItem(catalogId: string, x: number, y: number, rotation = 0): FurnitureItem {
  const def = CATALOG_BY_ID.get(catalogId)
  if (!def) throw new Error(`Unknown catalog item: ${catalogId}`)
  return {
    id: id('item'),
    name: def.name,
    kind: def.kind,
    shape: def.shape,
    color: def.color,
    x: Math.round(x),
    y: Math.round(y),
    w: def.w,
    d: def.d,
    h: def.h,
    rotation,
    fixed: def.fixed,
    overlappable: def.overlappable,
    catalogId: def.id,
  }
}

function door(wall: Wall, offset: number, width = 900, hinge: DoorHinge = 'left', swing: DoorSwing = 'in'): Opening {
  return {
    id: id('opening'),
    type: 'door',
    wall,
    offset: Math.round(offset),
    width,
    height: 2050,
    sill: 0,
    hinge,
    swing,
  }
}

function window_(wall: Wall, offset: number, width = 1200): Opening {
  return {
    id: id('opening'),
    type: 'window',
    wall,
    offset: Math.round(offset),
    width,
    height: 1200,
    sill: 950,
    hinge: 'left',
    swing: 'in',
  }
}

function makeRoom(
  name: string,
  length: number,
  width: number,
  wallHeight: number,
  items: FurnitureItem[],
  openings: Opening[],
  layout: RoomLayout,
): Room {
  return { id: id('room'), name, length, width, wallHeight, layout, items, openings }
}

/** A ready-made apartment so the multi-room workflow is obvious on first open. */
export function sampleRooms(): Room[] {
  const livingLength = ft(16)
  const livingWidth = ft(12)
  const bedroomLength = ft(13)
  const bedroomWidth = ft(11)
  const kitchenLength = ft(11)
  const kitchenWidth = ft(9) + inch(6)
  const officeLength = ft(10)
  const officeWidth = ft(9)
  const bathroomLength = ft(8)
  const bathroomWidth = ft(6)

  const living = makeRoom(
    'Living Room',
    livingLength,
    livingWidth,
    inch(108),
    [
      makeItem('rug', 2439, 2200),
      makeItem('sofa', 2439, 3150, 180),
      makeItem('coffee-table', 2439, 2000),
      makeItem('armchair', 900, 1200, 90),
      makeItem('tv-stand', 2439, 260),
      makeItem('bookshelf', 235, 900, 90),
      makeItem('floor-lamp', 4477, 3258),
    ],
    [door('n', 3400), window_('n', 800, 1500), window_('w', 800, 1200)],
    { x: livingLength / 2, y: livingWidth / 2, rotation: 0 },
  )

  const bedroom = makeRoom(
    'Primary Bedroom',
    bedroomLength,
    bedroomWidth,
    inch(108),
    [
      makeItem('double-bed', 1981, 1120),
      makeItem('nightstand', 1056, 320),
      makeItem('nightstand', 2906, 320),
      makeItem('wardrobe', 330, 2300, 90),
      makeItem('dresser', 3672, 1500, 90),
      makeItem('rug', 1900, 1900),
    ],
    [door('s', 2000, 900, 'right'), window_('n', 2500, 1200)],
    { x: livingLength + bedroomLength / 2, y: bedroomWidth / 2, rotation: 0 },
  )

  const kitchen = makeRoom(
    'Kitchen',
    kitchenLength,
    kitchenWidth,
    inch(108),
    [
      makeItem('kitchen-counter', 960, 360),
      makeItem('kitchen-counter', 360, 1900, 90),
      makeItem('fridge', 2900, 1500),
      makeItem('round-table', 2000, 1500),
      makeItem('plant', 1000, 2500),
    ],
    [door('s', 300), window_('n', 2000, 900)],
    { x: kitchenLength / 2, y: livingWidth + kitchenWidth / 2, rotation: 0 },
  )

  const office = makeRoom(
    'Home Office',
    officeLength,
    officeWidth,
    inch(108),
    [
      makeItem('desk', 700, 400),
      makeItem('dining-chair', 900, 950, 180),
      makeItem('bookshelf', 2873, 1400, 90),
      makeItem('dresser', 290, 1500, 90),
      makeItem('plant', 2200, 2200),
    ],
    [door('s', 1200, 900, 'right'), window_('n', 1600, 1200)],
    { x: kitchenLength + officeLength / 2, y: livingWidth + officeWidth / 2, rotation: 0 },
  )

  const bathroom = makeRoom(
    'Bathroom',
    bathroomLength,
    bathroomWidth,
    inch(96),
    [makeItem('bathtub', 900, 405), makeItem('toilet', 2150, 355), makeItem('basin', 2100, 1500)],
    [door('s', 800, 800, 'right', 'out'), window_('n', 1800, 600)],
    {
      x: kitchenLength + officeLength + bathroomLength / 2,
      y: livingWidth + bathroomWidth / 2,
      rotation: 0,
    },
  )

  return [living, bedroom, kitchen, office, bathroom]
}

export function newSampleProject(): Project {
  const now = Date.now()
  return {
    id: uid('project'),
    name: 'Maple Street Apartment',
    unit: 'ft',
    rooms: sampleRooms(),
    customItems: [],
    createdAt: now,
    updatedAt: now,
  }
}
