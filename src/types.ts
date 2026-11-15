export type Unit = 'ft' | 'in' | 'm' | 'cm' | 'mm'

export type Wall = 'n' | 'e' | 's' | 'w'

export type OpeningType = 'door' | 'window'

export type ItemShape = 'box' | 'lshape' | 'round'

/** Which jamb a door leaf is hinged on, seen along the wall run. */
export type DoorHinge = 'left' | 'right'

/** Whether a door opens into the room or away from it. */
export type DoorSwing = 'in' | 'out'

/** Drives the simple block model used in the isometric preview. */
export type ItemKind =
  | 'bed'
  | 'sofa'
  | 'armchair'
  | 'chair'
  | 'table'
  | 'desk'
  | 'nightstand'
  | 'wardrobe'
  | 'shelf'
  | 'dresser'
  | 'tvStand'
  | 'counter'
  | 'fridge'
  | 'tub'
  | 'toilet'
  | 'basin'
  | 'shower'
  | 'radiator'
  | 'rug'
  | 'plant'
  | 'lamp'
  | 'box'
  | 'lshape'
  | 'round'

/**
 * A door or window in a wall. `offset` is the distance (mm) from the start of
 * the wall, measured clockwise: north and east walls start at their lower-left
 * end, south and west walls at their lower-right end. Rotating a room by 90
 * degrees keeps offsets valid because it rotates the wall loop with it.
 */
export interface Opening {
  id: string
  type: OpeningType
  wall: Wall
  offset: number
  width: number
  height: number
  /** Window only: height of the sill above the floor. */
  sill: number
  /** Door only: hinge jamb. */
  hinge?: DoorHinge
  /** Door only: swing side. */
  swing?: DoorSwing
}

export interface FurnitureItem {
  id: string
  name: string
  kind: ItemKind
  shape: ItemShape
  color: string
  /** Centre of the footprint, in room-local millimetres. */
  x: number
  y: number
  /** Footprint width (mm) along the item's own x axis. */
  w: number
  /** Footprint depth (mm) along the item's own y axis. */
  d: number
  /** Height above the floor, in mm. */
  h: number
  /** Rotation in degrees, clockwise in the 2D view. */
  rotation: number
  /**
   * L-shaped items only: constant leg thickness in mm. Resizing changes the
   * overall width/depth and keeps this thickness.
   */
  thickness?: number
  /** Fixtures such as counters and radiators: never flagged for blocking. */
  fixed?: boolean
  /** Rugs and similar layered items: never flagged for overlapping. */
  overlappable?: boolean
  catalogId?: string
}

/** Where a room sits in the whole-home layout. */
export interface RoomLayout {
  /** Centre of the room in home coordinates (mm). */
  x: number
  y: number
  /** Whole-home rotation in degrees, multiples of 90. */
  rotation: number
}

export interface Room {
  id: string
  name: string
  /** Room size in mm, measured along the room's x axis. */
  length: number
  /** Room size in mm, measured along the room's y axis. */
  width: number
  /** Wall height in mm. */
  wallHeight: number
  /** Position and rotation in the whole-home view. */
  layout: RoomLayout
  openings: Opening[]
  items: FurnitureItem[]
}

export interface CatalogItem {
  id: string
  name: string
  category: string
  kind: ItemKind
  shape: ItemShape
  w: number
  d: number
  h: number
  color: string
  thickness?: number
  fixed?: boolean
  overlappable?: boolean
}

export interface Project {
  id: string
  name: string
  unit: Unit
  rooms: Room[]
  customItems: CatalogItem[]
  createdAt: number
  updatedAt: number
}

export type Selection =
  | { kind: 'room'; id: string }
  | { kind: 'item'; id: string }
  | { kind: 'opening'; id: string }
  | null

export type ViewMode = '2d' | '3d'

/** Edit a single room or arrange the whole home. */
export type Scope = 'room' | 'home'
