import { useSyncExternalStore } from 'react'
import type {
  CatalogItem,
  FurnitureItem,
  Opening,
  OpeningType,
  Project,
  Room,
  RoomLayout,
  Scope,
  Selection,
  Unit,
  ViewMode,
  Wall,
} from '../types.ts'
import { CATALOG_BY_ID, normalizeColor } from './catalog.ts'
import {
  WALLS,
  autoLayoutRooms,
  clampLshapeThickness,
  findFreeSpot,
  freeRoomLayout,
  normalizeAngle,
  roomFootprint,
  roomLayout,
  rotateRoom,
  wallLength,
  wallPoint,
} from './geometry.ts'
import { newSampleProject } from './sample.ts'
import { tidyMm, uid, uniqueName } from './util.ts'

export type SaveState = 'saved' | 'saving' | 'error'

export interface State {
  projects: Project[]
  projectId: string
  roomId: string
  selection: Selection
  view: ViewMode
  scope: Scope
  snapping: boolean
  showDimensions: boolean
  showWarnings: boolean
  saveState: SaveState
  savedAt: number | null
  canUndo: boolean
  canRedo: boolean
}

interface Draft {
  projects: Project[]
  projectId: string
  roomId: string
  selection: Selection
}

const STORAGE_KEY = 'roomscape.v1'
const STORAGE_VERSION = 2
const MAX_HISTORY = 80

function draftProject(draft: Draft): Project | undefined {
  return draft.projects.find((project) => project.id === draft.projectId)
}

function draftRoom(draft: Draft): Room | undefined {
  return draftProject(draft)?.rooms.find((room) => room.id === draft.roomId)
}

/** Items can be edited from the whole-home view, so look beyond the open room. */
function findItemInDraft(draft: Draft, itemId: string): { room: Room; item: FurnitureItem } | undefined {
  for (const room of draftProject(draft)?.rooms ?? []) {
    const item = room.items.find((entry) => entry.id === itemId)
    if (item) return { room, item }
  }
  return undefined
}

export function getProject(state: State): Project | undefined {
  return state.projects.find((project) => project.id === state.projectId)
}

export function getRoom(state: State): Room | undefined {
  return getProject(state)?.rooms.find((room) => room.id === state.roomId)
}

export function getItemRoom(state: State, itemId: string): Room | undefined {
  return getProject(state)?.rooms.find((room) => room.items.some((item) => item.id === itemId))
}

export function getSelectedItem(state: State): FurnitureItem | undefined {
  if (state.selection?.kind !== 'item') return undefined
  const itemId = state.selection.id
  return getProject(state)
    ?.rooms.flatMap((room) => room.items)
    .find((item) => item.id === itemId)
}

export function getSelectedOpening(state: State): Opening | undefined {
  if (state.selection?.kind !== 'opening') return undefined
  const openingId = state.selection.id
  return getProject(state)
    ?.rooms.flatMap((room) => room.openings)
    .find((opening) => opening.id === openingId)
}

/** Room-local coordinates of the pointer snapped to the project grid. */
export function emptyState(): State {
  return {
    projects: [],
    projectId: '',
    roomId: '',
    selection: null,
    view: '2d',
    scope: 'room',
    snapping: true,
    showDimensions: true,
    showWarnings: true,
    saveState: 'saved',
    savedAt: null,
    canUndo: false,
    canRedo: false,
  }
}

export function stateFromProject(project: Project, view: ViewMode = '2d'): State {
  const room = project.rooms[0]
  return {
    ...emptyState(),
    projects: [project],
    projectId: project.id,
    roomId: room?.id ?? '',
    selection: room ? { kind: 'room', id: room.id } : null,
    view,
  }
}

function freeOffset(room: Room, wall: Wall, width: number): number | null {
  const length = wallLength(room, wall)
  const limit = length - width - 120
  if (limit < 120) return null
  const existing = room.openings
    .filter((opening) => opening.wall === wall)
    .map((opening) => [opening.offset - 150, opening.offset + opening.width + 150] as [number, number])
  const centre = (length - width) / 2
  const candidates = [centre]
  for (let step = 100; step < length; step += 100) {
    candidates.push(centre + step, centre - step)
  }
  for (const candidate of candidates) {
    const start = Math.min(Math.max(candidate, 120), limit)
    const end = start + width
    const clash = existing.some(([from, to]) => start < to && end > from)
    if (!clash) return Math.round(start)
  }
  return null
}

class RoomscapeStore {
  private state: State
  private listeners = new Set<() => void>()
  private past: Draft[] = []
  private future: Draft[] = []
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const restored = loadPersisted()
    if (restored) {
      this.state = restored
    } else {
      this.state = stateFromProject(newSampleProject())
      this.scheduleSave()
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): State => this.state

  private setState(patch: Partial<State>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private capture(): Draft {
    return structuredClone({
      projects: this.state.projects,
      projectId: this.state.projectId,
      roomId: this.state.roomId,
      selection: this.state.selection,
    })
  }

  private applyDraft(draft: Draft): void {
    this.setState({
      projects: draft.projects,
      projectId: draft.projectId,
      roomId: draft.roomId,
      selection: draft.selection,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
    })
  }

  /** Apply an edit that can be undone as one step. */
  commit(recipe: (draft: Draft) => void): void {
    const before = this.capture()
    const draft = structuredClone(before)
    recipe(draft)
    const project = draftProject(draft)
    if (project) project.updatedAt = Date.now()
    this.past.push(before)
    if (this.past.length > MAX_HISTORY) this.past.shift()
    this.future = []
    this.applyDraft(draft)
    this.scheduleSave()
  }

  /** Apply an edit without adding an undo step (used during drags). */
  update(recipe: (draft: Draft) => void): void {
    const draft = this.capture()
    recipe(draft)
    this.applyDraft(draft)
    this.scheduleSave()
  }

  /** Remember the current state so following live edits undo as one step. */
  beginInteraction(): void {
    this.past.push(this.capture())
    if (this.past.length > MAX_HISTORY) this.past.shift()
    this.future = []
    this.setState({ canUndo: true, canRedo: false })
  }

  undo(): void {
    const previous = this.past.pop()
    if (!previous) return
    this.future.push(this.capture())
    this.applyDraft(previous)
    this.scheduleSave()
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.past.push(this.capture())
    this.applyDraft(next)
    this.scheduleSave()
  }

  // ---------------------------------------------------------------- ui state

  setView(view: ViewMode): void {
    this.setState({ view })
    this.scheduleSave()
  }

  setScope(scope: Scope): void {
    this.setState({ scope })
    this.scheduleSave()
  }

  setSelection(selection: Selection): void {
    this.setState({ selection })
    this.scheduleSave()
  }

  setSnapping(value: boolean): void {
    this.setState({ snapping: value })
    this.scheduleSave()
  }

  setDimensionsVisible(value: boolean): void {
    this.setState({ showDimensions: value })
    this.scheduleSave()
  }

  setWarningsVisible(value: boolean): void {
    this.setState({ showWarnings: value })
    this.scheduleSave()
  }

  // ------------------------------------------------------------- navigation

  openProject(projectId: string): void {
    const project = this.state.projects.find((entry) => entry.id === projectId)
    if (!project) return
    const room = project.rooms[0]
    this.setState({
      projectId,
      roomId: room?.id ?? '',
      selection: room ? { kind: 'room', id: room.id } : null,
    })
    this.scheduleSave()
  }

  openRoom(roomId: string): void {
    this.setState({ roomId, selection: { kind: 'room', id: roomId } })
    this.scheduleSave()
  }

  // --------------------------------------------------------------- projects

  createProject(name: string, unit: Unit): void {
    const now = Date.now()
    const project: Project = {
      id: uid('project'),
      name: name.trim() || 'Untitled home',
      unit,
      rooms: [],
      customItems: [],
      createdAt: now,
      updatedAt: now,
    }
    this.commit((draft) => {
      draft.projects.push(project)
      draft.projectId = project.id
      draft.roomId = ''
      draft.selection = null
    })
  }

  renameProject(projectId: string, name: string): void {
    this.commit((draft) => {
      const project = draft.projects.find((entry) => entry.id === projectId)
      if (project) project.name = name
    })
  }

  deleteProject(projectId: string): void {
    this.commit((draft) => {
      draft.projects = draft.projects.filter((project) => project.id !== projectId)
      const next = draft.projects.find((project) => project.id === draft.projectId) ?? draft.projects[0]
      draft.projectId = next?.id ?? ''
      const room = next?.rooms.find((entry) => entry.id === draft.roomId) ?? next?.rooms[0]
      draft.roomId = room?.id ?? ''
      draft.selection = room ? { kind: 'room', id: room.id } : null
    })
  }

  addSampleProject(): void {
    const sample = newSampleProject()
    this.commit((draft) => {
      const name = uniqueName(sample.name, draft.projects.map((project) => project.name))
      sample.name = name
      draft.projects.push(sample)
      draft.projectId = sample.id
      const room = sample.rooms[0]
      draft.roomId = room?.id ?? ''
      draft.selection = room ? { kind: 'room', id: room.id } : null
    })
  }

  setUnit(unit: Unit): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      if (project) project.unit = unit
    })
  }

  // ------------------------------------------------------------------ rooms

  addRoom(input: { name: string; length: number; width: number; wallHeight: number }): void {
    const room: Room = {
      id: uid('room'),
      name: input.name.trim() || 'New room',
      length: tidyMm(input.length),
      width: tidyMm(input.width),
      wallHeight: tidyMm(input.wallHeight),
      layout: { x: 0, y: 0, rotation: 0 },
      openings: [],
      items: [],
    }
    this.commit((draft) => {
      const project = draftProject(draft)
      if (!project) return
      room.name = uniqueName(room.name, project.rooms.map((entry) => entry.name))
      room.layout = freeRoomLayout(project.rooms, room)
      project.rooms.push(room)
      draft.roomId = room.id
      draft.selection = { kind: 'room', id: room.id }
    })
  }

  renameRoom(roomId: string, name: string): void {
    this.commit((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (room) room.name = name
    })
  }

  duplicateRoom(roomId: string): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      const room = project?.rooms.find((entry) => entry.id === roomId)
      if (!project || !room) return
      const copy: Room = structuredClone(room)
      copy.id = uid('room')
      copy.name = uniqueName(`${room.name} copy`, project.rooms.map((entry) => entry.name))
      const footprint = roomFootprint(room)
      copy.layout = { ...roomLayout(room), x: roomLayout(room).x + footprint.w }
      copy.openings = copy.openings.map((opening) => ({ ...opening, id: uid('opening') }))
      copy.items = copy.items.map((item) => ({ ...item, id: uid('item') }))
      const index = project.rooms.findIndex((entry) => entry.id === roomId)
      project.rooms.splice(index + 1, 0, copy)
      draft.roomId = copy.id
      draft.selection = { kind: 'room', id: copy.id }
    })
  }

  deleteRoom(roomId: string): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      if (!project) return
      const index = project.rooms.findIndex((entry) => entry.id === roomId)
      if (index < 0) return
      project.rooms.splice(index, 1)
      const next = project.rooms[Math.min(index, project.rooms.length - 1)]
      draft.roomId = next?.id ?? ''
      draft.selection = next ? { kind: 'room', id: next.id } : null
    })
  }

  reorderRoom(roomId: string, delta: number): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      if (!project) return
      const index = project.rooms.findIndex((entry) => entry.id === roomId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= project.rooms.length) return
      const [room] = project.rooms.splice(index, 1)
      project.rooms.splice(target, 0, room)
    })
  }

  updateRoom(roomId: string, patch: Partial<Pick<Room, 'name' | 'length' | 'width' | 'wallHeight'>>): void {
    this.commit((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (!room) return
      if (patch.name !== undefined) room.name = patch.name
      if (patch.length !== undefined) room.length = tidyMm(Math.max(600, patch.length))
      if (patch.width !== undefined) room.width = tidyMm(Math.max(600, patch.width))
      if (patch.wallHeight !== undefined) room.wallHeight = tidyMm(Math.max(1200, Math.min(6000, patch.wallHeight)))
    })
  }

  rotateCurrentRoom(direction: 1 | -1): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      const room = draftRoom(draft)
      if (!project || !room) return
      const index = project.rooms.findIndex((entry) => entry.id === room.id)
      if (index < 0) return
      project.rooms[index] = rotateRoom(room, direction)
    })
  }

  // ---------------------------------------------------------- home layout

  setRoomLayout(roomId: string, patch: Partial<RoomLayout>): void {
    this.commit((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (!room) return
      const current = roomLayout(room)
      room.layout = {
        x: tidyMm(patch.x ?? current.x),
        y: tidyMm(patch.y ?? current.y),
        rotation: normalizeAngle(patch.rotation ?? current.rotation),
      }
    })
  }

  /** Live drag of a room in the whole-home plan. */
  moveRoomLayout(roomId: string, x: number, y: number): void {
    this.update((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (!room) return
      const current = roomLayout(room)
      room.layout = { ...current, x: tidyMm(x), y: tidyMm(y) }
    })
  }

  rotateRoomLayout(roomId: string, delta: number): void {
    this.commit((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (!room) return
      const current = roomLayout(room)
      room.layout = { ...current, rotation: normalizeAngle(current.rotation + delta) }
    })
  }

  setRoomTopLeft(roomId: string, x: number, y: number): void {
    this.commit((draft) => {
      const room = draftProject(draft)?.rooms.find((entry) => entry.id === roomId)
      if (!room) return
      const current = roomLayout(room)
      const rad = (current.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = -room.length / 2
      const dy = -room.width / 2
      room.layout = {
        ...current,
        x: tidyMm(x - (dx * cos - dy * sin)),
        y: tidyMm(y - (dx * sin + dy * cos)),
      }
    })
  }

  // -------------------------------------------------------------- openings

  addOpening(type: OpeningType): void {
    this.commit((draft) => {
      const room = draftRoom(draft)
      if (!room) return
      const requested = type === 'door' ? 900 : 1200
      const walls = [...WALLS].sort((a, b) => wallLength(room, b) - wallLength(room, a))
      for (const wall of walls) {
        const length = wallLength(room, wall)
        const width = Math.min(requested, Math.max(400, length - 480))
        if (length < width + 300) continue
        const offset = freeOffset(room, wall, width)
        if (offset === null) continue
        const opening: Opening = {
          id: uid('opening'),
          type,
          wall,
          offset,
          width,
          height: type === 'door' ? 2050 : 1200,
          sill: type === 'window' ? 950 : 0,
          hinge: 'left',
          swing: 'in',
        }
        room.openings.push(opening)
        draft.selection = { kind: 'opening', id: opening.id }
        return
      }
    })
  }

  updateOpening(openingId: string, patch: Partial<Opening>): void {
    this.commit((draft) => {
      const room = draftRoom(draft)
      const opening = room?.openings.find((entry) => entry.id === openingId)
      if (!room || !opening) return
      Object.assign(opening, patch)
      const length = wallLength(room, opening.wall)
      opening.width = Math.max(400, Math.min(opening.width, Math.max(400, length - 200)))
      opening.offset = Math.max(0, Math.min(opening.offset, Math.max(0, length - opening.width)))
      opening.offset = tidyMm(opening.offset)
      opening.width = tidyMm(opening.width)
      if (opening.type === 'door') opening.sill = 0
    })
  }

  /** Live drag of an opening along its wall. */
  moveOpening(openingId: string, wall: Wall, offset: number): void {
    this.update((draft) => {
      const room = draftRoom(draft)
      const opening = room?.openings.find((entry) => entry.id === openingId)
      if (!room || !opening) return
      const length = wallLength(room, wall)
      opening.wall = wall
      opening.offset = Math.max(0, Math.min(offset, length - opening.width))
    })
  }

  deleteOpening(openingId: string): void {
    this.commit((draft) => {
      const room = draftRoom(draft)
      if (!room) return
      room.openings = room.openings.filter((opening) => opening.id !== openingId)
      if (draft.selection?.kind === 'opening' && draft.selection.id === openingId) {
        draft.selection = { kind: 'room', id: room.id }
      }
    })
  }

  // ------------------------------------------------------------------ items

  addCatalogItem(definition: CatalogItem | string): void {
    const def = typeof definition === 'string' ? CATALOG_BY_ID.get(definition) : definition
    if (!def) return
    this.commit((draft) => {
      const room = draftRoom(draft)
      if (!room) return
      const spot = findFreeSpot(room, def.w, def.d)
      const thickness =
        def.shape === 'lshape'
          ? clampLshapeThickness(def.thickness ?? Math.min(def.w, def.d) * 0.4, def.w, def.d)
          : undefined
      const item: FurnitureItem = {
        id: uid('item'),
        name: def.name,
        kind: def.kind,
        shape: def.shape,
        color: normalizeColor(def.color),
        x: spot.x,
        y: spot.y,
        w: def.w,
        d: def.d,
        h: def.h,
        rotation: 0,
        thickness,
        fixed: def.fixed,
        overlappable: def.overlappable,
        catalogId: def.id,
      }
      room.items.push(item)
      draft.selection = { kind: 'item', id: item.id }
    })
  }

  /** Add a custom item to the project library and drop it into the room. */
  createCustomItem(def: Omit<CatalogItem, 'id' | 'category'> & { category?: string }): void {
    const catalogId = uid('custom')
    const thickness =
      def.shape === 'lshape'
        ? clampLshapeThickness(def.thickness ?? Math.min(def.w, def.d) * 0.4, def.w, def.d)
        : undefined
    const definition: CatalogItem = {
      id: catalogId,
      name: def.name.trim() || 'Custom item',
      category: def.category ?? 'Custom',
      kind: def.kind,
      shape: def.shape,
      w: tidyMm(def.w),
      d: tidyMm(def.d),
      h: tidyMm(def.h),
      color: normalizeColor(def.color),
      thickness,
    }
    this.commit((draft) => {
      const project = draftProject(draft)
      const room = draftRoom(draft)
      if (!project || !room) return
      project.customItems.push(definition)
      const spot = findFreeSpot(room, definition.w, definition.d)
      const item: FurnitureItem = {
        id: uid('item'),
        name: definition.name,
        kind: definition.kind,
        shape: definition.shape,
        color: definition.color,
        x: spot.x,
        y: spot.y,
        w: definition.w,
        d: definition.d,
        h: definition.h,
        rotation: 0,
        thickness: definition.thickness,
        catalogId,
      }
      room.items.push(item)
      draft.selection = { kind: 'item', id: item.id }
    })
  }

  deleteCustomCatalogItem(catalogId: string): void {
    this.commit((draft) => {
      const project = draftProject(draft)
      if (project) project.customItems = project.customItems.filter((item) => item.id !== catalogId)
    })
  }

  updateItem(itemId: string, patch: Partial<FurnitureItem>): void {
    this.commit((draft) => this.patchItem(draft, itemId, patch))
  }

  /** Live edit (drag/resize) that folds into the current undo step. */
  updateItemLive(itemId: string, patch: Partial<FurnitureItem>): void {
    this.update((draft) => this.patchItem(draft, itemId, patch))
  }

  private patchItem(draft: Draft, itemId: string, patch: Partial<FurnitureItem>): void {
    const found = findItemInDraft(draft, itemId)
    if (!found) return
    const { item } = found
    const next: Partial<FurnitureItem> = { ...patch }
    if (next.w !== undefined) next.w = tidyMm(Math.max(80, next.w))
    if (next.d !== undefined) next.d = tidyMm(Math.max(80, next.d))
    if (next.h !== undefined) next.h = tidyMm(Math.max(10, next.h))
    if (next.rotation !== undefined) next.rotation = ((next.rotation % 360) + 360) % 360
    Object.assign(item, next)
    if (item.shape === 'lshape') {
      item.thickness = clampLshapeThickness(
        item.thickness ?? Math.min(item.w, item.d) * 0.4,
        item.w,
        item.d,
      )
    }
  }

  rotateItem(itemId: string, delta: number): void {
    this.commit((draft) => {
      const found = findItemInDraft(draft, itemId)
      if (found) found.item.rotation = ((found.item.rotation + delta) % 360 + 360) % 360
    })
  }

  nudgeItem(itemId: string, dx: number, dy: number): void {
    this.commit((draft) => {
      const found = findItemInDraft(draft, itemId)
      if (!found) return
      found.item.x = tidyMm(found.item.x + dx)
      found.item.y = tidyMm(found.item.y + dy)
    })
  }

  duplicateItem(itemId: string): void {
    this.commit((draft) => {
      const found = findItemInDraft(draft, itemId)
      if (!found) return
      const { room, item } = found
      const spot = findFreeSpot(room, item.w, item.d)
      const copy: FurnitureItem = {
        ...structuredClone(item),
        id: uid('item'),
        x: spot.x,
        y: spot.y,
      }
      room.items.push(copy)
      draft.selection = { kind: 'item', id: copy.id }
    })
  }

  deleteItem(itemId: string): void {
    this.commit((draft) => {
      const found = findItemInDraft(draft, itemId)
      if (!found) return
      const { room } = found
      room.items = room.items.filter((item) => item.id !== itemId)
      if (draft.selection?.kind === 'item' && draft.selection.id === itemId) {
        draft.selection = { kind: 'room', id: room.id }
      }
    })
  }

  // -------------------------------------------------------------- persistence

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.state.saveState !== 'saving') this.setState({ saveState: 'saving' })
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      const payload = {
        version: STORAGE_VERSION,
        projects: this.state.projects,
        projectId: this.state.projectId,
        roomId: this.state.roomId,
        selection: this.state.selection,
        view: this.state.view,
        scope: this.state.scope,
        snapping: this.state.snapping,
        showDimensions: this.state.showDimensions,
        showWarnings: this.state.showWarnings,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      this.setState({ saveState: 'saved', savedAt: Date.now() })
    } catch {
      this.setState({ saveState: 'error' })
    }
  }
}

interface Persisted {
  version?: number
  projects?: Project[]
  projectId?: string
  roomId?: string
  selection?: Selection
  view?: ViewMode
  scope?: Scope
  snapping?: boolean
  showDimensions?: boolean
  showWarnings?: boolean
}

function loadPersisted(): State | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (!Array.isArray(parsed.projects)) return null
    const projects = parsed.projects
      .filter(
        (project): project is Project =>
          Boolean(project) && typeof project.id === 'string' && Array.isArray(project.rooms),
      )
      .map(normalizeProject)
    if (!projects.length) return null
    const projectId = projects.some((project) => project.id === parsed.projectId)
      ? (parsed.projectId as string)
      : projects[0].id
    const project = projects.find((entry) => entry.id === projectId)
    const roomId = project?.rooms.some((room) => room.id === parsed.roomId)
      ? (parsed.roomId as string)
      : (project?.rooms[0]?.id ?? '')
    const room = project?.rooms.find((entry) => entry.id === roomId)
    const selection = parsed.selection && room ? parsed.selection : room ? { kind: 'room' as const, id: room.id } : null
    return {
      ...emptyState(),
      projects,
      projectId,
      roomId,
      selection,
      view: parsed.view === '3d' ? '3d' : '2d',
      scope: parsed.scope === 'home' ? 'home' : 'room',
      snapping: parsed.snapping !== false,
      showDimensions: parsed.showDimensions !== false,
      showWarnings: parsed.showWarnings !== false,
      savedAt: Date.now(),
    }
  } catch {
    return null
  }
}

// --------------------------------------------------------------- migrations

function validLayout(layout?: RoomLayout): layout is RoomLayout {
  return Boolean(
    layout &&
      Number.isFinite(layout.x) &&
      Number.isFinite(layout.y) &&
      Number.isFinite(layout.rotation),
  )
}

function normalizeUnit(unit?: Unit): Unit {
  return unit === 'ft' || unit === 'in' || unit === 'm' || unit === 'cm' || unit === 'mm' ? unit : 'ft'
}

function normalizeOpening(opening: Opening, index: number): Opening {
  const type: OpeningType = opening.type === 'window' ? 'window' : 'door'
  return {
    ...opening,
    id: opening.id ?? `opening_restored_${index}`,
    type,
    wall: WALLS.includes(opening.wall) ? opening.wall : 'n',
    offset: Number.isFinite(opening.offset) ? Math.max(0, opening.offset) : 0,
    width: tidyMm(Math.max(300, Number(opening.width) || (type === 'door' ? 900 : 1200))),
    height: tidyMm(Math.max(300, Number(opening.height) || (type === 'door' ? 2050 : 1200))),
    sill: type === 'window' ? Math.max(0, Number(opening.sill) || 0) : 0,
    hinge: opening.hinge === 'right' ? 'right' : 'left',
    swing: opening.swing === 'out' ? 'out' : 'in',
  }
}

function normalizeItem(item: FurnitureItem, index: number): FurnitureItem {
  const w = tidyMm(Math.max(80, Number(item.w) || 800))
  const d = tidyMm(Math.max(80, Number(item.d) || 600))
  const shape = item.shape === 'round' || item.shape === 'lshape' ? item.shape : 'box'
  const next: FurnitureItem = {
    ...item,
    id: item.id ?? `item_restored_${index}`,
    name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Item',
    kind: item.kind ?? shape,
    shape,
    color: normalizeColor(item.color),
    x: Number.isFinite(item.x) ? item.x : 0,
    y: Number.isFinite(item.y) ? item.y : 0,
    w,
    d,
    h: tidyMm(Math.max(10, Number(item.h) || 700)),
    rotation: Number.isFinite(item.rotation) ? ((item.rotation % 360) + 360) % 360 : 0,
  }
  if (shape === 'lshape') {
    next.thickness = clampLshapeThickness(Number(item.thickness) || Math.min(w, d) * 0.4, w, d)
  }
  return next
}

function normalizeRoom(room: Room, index: number): Room {
  const length = tidyMm(Math.max(600, Number(room.length) || 4000))
  const width = tidyMm(Math.max(600, Number(room.width) || 3000))
  return {
    ...room,
    id: room.id ?? `room_restored_${index}`,
    name: typeof room.name === 'string' && room.name.trim() ? room.name : `Room ${index + 1}`,
    length,
    width,
    wallHeight: tidyMm(Math.max(1200, Math.min(6000, Number(room.wallHeight) || 2600))),
    layout: validLayout(room.layout)
      ? { x: room.layout.x, y: room.layout.y, rotation: normalizeAngle(room.layout.rotation) }
      : (undefined as unknown as RoomLayout),
    openings: Array.isArray(room.openings) ? room.openings.map(normalizeOpening) : [],
    items: Array.isArray(room.items) ? room.items.map(normalizeItem) : [],
  }
}

function normalizeCustomItems(items?: CatalogItem[]): CatalogItem[] {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => ({
    ...item,
    id: item.id ?? `custom_restored_${index}`,
    name: typeof item.name === 'string' && item.name.trim() ? item.name : 'Custom item',
    category: item.category ?? 'Custom',
    color: normalizeColor(item.color),
  }))
}

/** Fill in missing colours, door options and home positions from older saves. */
function normalizeProject(project: Project): Project {
  const rooms = (Array.isArray(project.rooms) ? project.rooms : []).map(normalizeRoom)
  const placed = rooms.filter((room) => validLayout(room.layout))
  let laidOut: Room[]
  if (!placed.length) {
    laidOut = autoLayoutRooms(rooms)
  } else {
    for (const room of rooms) {
      if (validLayout(room.layout)) continue
      room.layout = freeRoomLayout(placed, room)
      placed.push(room)
    }
    laidOut = rooms
  }
  return {
    ...project,
    name: typeof project.name === 'string' && project.name.trim() ? project.name : 'Untitled home',
    unit: normalizeUnit(project.unit),
    rooms: laidOut,
    customItems: normalizeCustomItems(project.customItems),
  }
}

export const store = new RoomscapeStore()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => store.flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush()
  })
}

export function useStoreState(): State {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function roomCentre(room: Room): { x: number; y: number } {
  return { x: room.length / 2, y: room.width / 2 }
}

export function wallOffsetForPoint(room: Room, wall: Wall, point: { x: number; y: number }): number {
  const start = wallPoint(room, wall, 0)
  const horizontal = wall === 'n' || wall === 's'
  return horizontal ? Math.abs(point.x - start.x) : Math.abs(point.y - start.y)
}
