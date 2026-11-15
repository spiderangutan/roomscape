import type { CatalogItem } from '../types.ts'

/**
 * Starter catalog. Every entry is a simple block model scaled to realistic
 * millimetres; the isometric preview builds its shapes from `kind`.
 */
export const CATALOG: CatalogItem[] = [
  // Beds
  {
    id: 'single-bed',
    name: 'Single bed',
    category: 'Beds',
    kind: 'bed',
    shape: 'box',
    w: 900,
    d: 2000,
    h: 500,
    color: '#c2b19c',
  },
  {
    id: 'double-bed',
    name: 'Double bed',
    category: 'Beds',
    kind: 'bed',
    shape: 'box',
    w: 1400,
    d: 2000,
    h: 560,
    color: '#c9b9a6',
  },
  {
    id: 'king-bed',
    name: 'King bed',
    category: 'Beds',
    kind: 'bed',
    shape: 'box',
    w: 1800,
    d: 2000,
    h: 600,
    color: '#bdad9a',
  },
  {
    id: 'nightstand',
    name: 'Nightstand',
    category: 'Beds',
    kind: 'nightstand',
    shape: 'box',
    w: 450,
    d: 400,
    h: 550,
    color: '#b9a58c',
  },

  // Seating
  {
    id: 'sofa',
    name: 'Sofa',
    category: 'Seating',
    kind: 'sofa',
    shape: 'box',
    w: 2100,
    d: 900,
    h: 800,
    color: '#9fadb8',
  },
  {
    id: 'armchair',
    name: 'Armchair',
    category: 'Seating',
    kind: 'armchair',
    shape: 'box',
    w: 850,
    d: 850,
    h: 780,
    color: '#a9b4a1',
  },
  {
    id: 'dining-chair',
    name: 'Dining chair',
    category: 'Seating',
    kind: 'chair',
    shape: 'box',
    w: 450,
    d: 450,
    h: 900,
    color: '#bda98f',
  },

  // Tables
  {
    id: 'coffee-table',
    name: 'Coffee table',
    category: 'Tables',
    kind: 'table',
    shape: 'box',
    w: 1100,
    d: 600,
    h: 420,
    color: '#bda489',
  },
  {
    id: 'dining-table',
    name: 'Dining table',
    category: 'Tables',
    kind: 'table',
    shape: 'box',
    w: 1400,
    d: 800,
    h: 750,
    color: '#c8b298',
  },
  {
    id: 'round-table',
    name: 'Round table',
    category: 'Tables',
    kind: 'table',
    shape: 'round',
    w: 800,
    d: 800,
    h: 740,
    color: '#c3ac92',
  },
  {
    id: 'desk',
    name: 'Desk',
    category: 'Tables',
    kind: 'desk',
    shape: 'box',
    w: 1200,
    d: 600,
    h: 750,
    color: '#c3ae95',
  },

  // Storage
  {
    id: 'wardrobe',
    name: 'Wardrobe',
    category: 'Storage',
    kind: 'wardrobe',
    shape: 'box',
    w: 1200,
    d: 600,
    h: 2100,
    color: '#c4b3a1',
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'Storage',
    kind: 'shelf',
    shape: 'box',
    w: 900,
    d: 350,
    h: 1800,
    color: '#b3a08b',
  },
  {
    id: 'dresser',
    name: 'Dresser',
    category: 'Storage',
    kind: 'dresser',
    shape: 'box',
    w: 1400,
    d: 500,
    h: 800,
    color: '#c8b8a6',
  },
  {
    id: 'tv-stand',
    name: 'TV stand',
    category: 'Storage',
    kind: 'tvStand',
    shape: 'box',
    w: 1200,
    d: 400,
    h: 450,
    color: '#b7a693',
  },

  // Kitchen
  {
    id: 'kitchen-counter',
    name: 'Kitchen counter',
    category: 'Kitchen',
    kind: 'counter',
    shape: 'box',
    w: 1800,
    d: 600,
    h: 900,
    color: '#dcd6cc',
    fixed: true,
  },
  {
    id: 'fridge',
    name: 'Fridge',
    category: 'Kitchen',
    kind: 'fridge',
    shape: 'box',
    w: 700,
    d: 700,
    h: 1800,
    color: '#dde2e6',
  },

  // Bathroom
  {
    id: 'bathtub',
    name: 'Bathtub',
    category: 'Bathroom',
    kind: 'tub',
    shape: 'box',
    w: 1700,
    d: 750,
    h: 550,
    color: '#e6e8e7',
    fixed: true,
  },
  {
    id: 'toilet',
    name: 'Toilet',
    category: 'Bathroom',
    kind: 'toilet',
    shape: 'box',
    w: 400,
    d: 650,
    h: 750,
    color: '#e9ebea',
    fixed: true,
  },
  {
    id: 'basin',
    name: 'Basin',
    category: 'Bathroom',
    kind: 'basin',
    shape: 'box',
    w: 600,
    d: 450,
    h: 850,
    color: '#e6e8e7',
    fixed: true,
  },

  // Fixtures
  {
    id: 'radiator',
    name: 'Radiator',
    category: 'Fixtures',
    kind: 'radiator',
    shape: 'box',
    w: 800,
    d: 150,
    h: 600,
    color: '#dcd8d1',
    fixed: true,
  },

  // Simple shapes, also available as custom items
  {
    id: 'l-desk',
    name: 'L-shaped desk',
    category: 'Tables',
    kind: 'lshape',
    shape: 'lshape',
    w: 1600,
    d: 1600,
    h: 740,
    thickness: 600,
    color: '#c6b096',
  },

  // Decor
  {
    id: 'rug',
    name: 'Rug',
    category: 'Decor',
    kind: 'rug',
    shape: 'box',
    w: 2000,
    d: 1500,
    h: 20,
    color: '#cbb8a5',
    overlappable: true,
  },
  {
    id: 'plant',
    name: 'Plant',
    category: 'Decor',
    kind: 'plant',
    shape: 'round',
    w: 500,
    d: 500,
    h: 1200,
    color: '#8fa480',
  },
  {
    id: 'floor-lamp',
    name: 'Floor lamp',
    category: 'Decor',
    kind: 'lamp',
    shape: 'round',
    w: 400,
    d: 400,
    h: 1600,
    color: '#cbbba6',
  },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((item) => [item.id, item]))

export const CATALOG_CATEGORIES = Array.from(new Set(CATALOG.map((item) => item.category)))

/** A muted palette shared by furniture, custom items and the properties panel. */
export const ITEM_COLORS: Array<{ name: string; value: string }> = [
  { name: 'Oat', value: '#cbb8a2' },
  { name: 'Linen', value: '#d8cdbd' },
  { name: 'Clay', value: '#c19a87' },
  { name: 'Sage', value: '#a3b096' },
  { name: 'Moss', value: '#8b9d7f' },
  { name: 'Slate blue', value: '#96a8b5' },
  { name: 'Mist', value: '#b8c4c1' },
  { name: 'Rose', value: '#c3a39d' },
  { name: 'Walnut', value: '#a98b6f' },
  { name: 'Stone', value: '#bcb9b0' },
  { name: 'Charcoal', value: '#8d8f8c' },
  { name: 'Ink', value: '#71767a' },
]

/** Used whenever an item has no usable colour of its own. */
export const DEFAULT_ITEM_COLOR = ITEM_COLORS[0].value

/** Kept for the custom-item dialog. */
export const CUSTOM_COLORS = ITEM_COLORS.map((entry) => entry.value)

/** Accept a hex colour from saved data, falling back to a visible default. */
export function normalizeColor(color?: string): string {
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim())) return color.trim()
  if (typeof color === 'string' && /^#[0-9a-f]{3}$/i.test(color.trim())) {
    const short = color.trim().slice(1)
    return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`
  }
  return DEFAULT_ITEM_COLOR
}
