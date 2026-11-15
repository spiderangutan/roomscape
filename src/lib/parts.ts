import type { ItemKind, ItemShape } from '../types.ts'
import { clampLshapeThickness } from './geometry.ts'

/**
 * A simple block that makes up part of an item in the isometric preview.
 * Coordinates are item-local: `x` runs along the item's width, `z` along its
 * depth, `y` is the vertical centre of the block above the floor. Every part is
 * centred on the item's footprint centre so the whole group can be rotated
 * rigidly. All values are millimetres.
 */
export interface Part {
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
  /** Multiplier on the item colour (1 = base). */
  tone?: number
  /** Absolute colour, overrides the item colour. */
  color?: string
  alpha?: number
  /** Render as a rounded prism rather than a box. */
  round?: boolean
}

interface Size {
  w: number
  d: number
  h: number
  /** L-shapes only: constant leg thickness. */
  thickness?: number
}

function block(
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  extra: Omit<Partial<Part>, 'x' | 'y' | 'z' | 'w' | 'd' | 'h'> = {},
): Part {
  return { x, y, z, w, d, h, ...extra }
}

function fourLegs(
  size: Size,
  options: { height: number; thickness: number; inset?: number; tone?: number },
): Part[] {
  const { w, d } = size
  const inset = options.inset ?? 60
  const t = Math.max(24, Math.min(options.thickness, w * 0.14, d * 0.14))
  const x = Math.max(0, w / 2 - t / 2 - inset)
  const z = Math.max(0, d / 2 - t / 2 - inset)
  const y = options.height / 2
  return [
    block(-x, y, -z, t, t, options.height, { tone: options.tone ?? 0.84 }),
    block(x, y, -z, t, t, options.height, { tone: options.tone ?? 0.84 }),
    block(-x, y, z, t, t, options.height, { tone: options.tone ?? 0.84 }),
    block(x, y, z, t, t, options.height, { tone: options.tone ?? 0.84 }),
  ]
}

/**
 * Blocks for the custom shapes. An L uses its overall width and depth plus a
 * constant leg thickness, so resizing never stretches one arm thicker than the
 * other and the 2D footprint matches the 3D shape.
 */
function shapeParts(shape: ItemShape, size: Size): Part[] {
  const { w, d, h } = size
  if (shape === 'round') {
    return [block(0, h / 2, 0, w, d, h, { round: true })]
  }
  if (shape === 'lshape') {
    const t = clampLshapeThickness(size.thickness ?? Math.min(w, d) * 0.4, w, d)
    return [
      // Top arm: full width, one thickness deep.
      block(0, h / 2, -d / 2 + t / 2, w, t, h),
      // Side arm: starts below the top arm so the two blocks do not overlap.
      block(-w / 2 + t / 2, h / 2, t / 2, t, d - t, h, { tone: 0.97 }),
    ]
  }
  return [block(0, h / 2, 0, w, d, h)]
}

export function itemParts(kind: ItemKind, shape: ItemShape, size: Size): Part[] {
  const { w, d, h } = size
  switch (kind) {
    case 'bed': {
      const legH = Math.min(90, h * 0.1)
      const frameH = Math.min(200, h * 0.25)
      const mattressH = Math.min(220, h * 0.24)
      const headboard = Math.min(90, d * 0.07)
      const frameTop = legH + frameH
      const mattressTop = frameTop + mattressH
      const pillowD = Math.min(300, d * 0.14)
      const pillowH = Math.min(120, h * 0.12)
      const twoPillows = w >= 1250
      return [
        ...fourLegs(size, { height: legH, thickness: 80, inset: 60, tone: 0.82 }),
        block(0, legH + frameH / 2, 0, w, d, frameH, { tone: 0.93 }),
        block(0, frameTop + mattressH / 2, 0, w * 0.95, d * 0.93, mattressH, { color: '#f1eadf' }),
        // Duvet folded over the foot end.
        block(
          0,
          mattressTop + Math.max(10, h * 0.02),
          d * 0.2,
          w * 0.92,
          d * 0.46,
          Math.max(24, h * 0.05),
          { color: '#e8dfd1' },
        ),
        block(
          -(twoPillows ? w * 0.2 : 0),
          mattressTop + pillowH / 2,
          -d / 2 + headboard + pillowD / 2 + 20,
          twoPillows ? w * 0.38 : w * 0.55,
          pillowD,
          pillowH,
          { color: '#f8f3ea' },
        ),
        ...(twoPillows
          ? [
              block(
                w * 0.2,
                mattressTop + pillowH / 2,
                -d / 2 + headboard + pillowD / 2 + 20,
                w * 0.38,
                pillowD,
                pillowH,
                { color: '#f8f3ea' },
              ),
            ]
          : []),
        block(0, h / 2, -d / 2 + headboard / 2, w, headboard, h, { tone: 0.85 }),
      ]
    }
    case 'sofa':
    case 'armchair': {
      const legH = Math.min(90, h * 0.12)
      const baseH = Math.min(170, h * 0.2)
      const seatH = Math.min(140, h * 0.17)
      const backDepth = Math.min(190, d * 0.22)
      const armWidth = Math.min(kind === 'armchair' ? 130 : 190, w * 0.16, d * 0.34)
      const seatCount = kind === 'sofa' ? (w >= 1900 ? 3 : 2) : 1
      const innerWidth = w - armWidth * 2 - 30
      const seatGap = 12
      const seatWidth = Math.max(120, innerWidth / seatCount - seatGap)
      const totalSeatWidth = seatCount * seatWidth + (seatCount - 1) * seatGap
      const seatOffset = -totalSeatWidth / 2 + seatWidth / 2
      const seatX = (index: number) => seatOffset + index * (seatWidth + seatGap)
      const seatDepth = Math.max(180, d - backDepth - 40)
      const seatZ = backDepth / 2
      const baseTop = legH + baseH
      const cushions: Part[] = Array.from({ length: seatCount }, (_, index) =>
        block(seatX(index), baseTop + seatH / 2, seatZ, seatWidth, seatDepth, seatH, { tone: 1.04 }),
      )
      const backHeight = h * 0.82
      const backCushionH = h * 0.28
      const backCushions: Part[] = Array.from({ length: seatCount }, (_, index) =>
        block(
          seatX(index),
          baseTop + seatH + backCushionH / 2,
          -d / 2 + backDepth + 55,
          seatWidth,
          Math.min(150, d * 0.16),
          backCushionH,
          { tone: 1.02 },
        ),
      )
      return [
        ...fourLegs(size, { height: legH, thickness: 60, inset: 45, tone: 0.8 }),
        block(0, legH + baseH / 2, 0, w, d, baseH, { tone: 0.95 }),
        ...cushions,
        block(0, h * 0.44, -d / 2 + backDepth / 2, w, backDepth, backHeight, { tone: 0.92 }),
        ...backCushions,
        block(-(w / 2 - armWidth / 2), h * 0.33, 8, armWidth, d * 0.96, h * 0.64, { tone: 0.9 }),
        block(w / 2 - armWidth / 2, h * 0.33, 8, armWidth, d * 0.96, h * 0.64, { tone: 0.9 }),
      ]
    }
    case 'chair': {
      const legH = h * 0.44
      return [
        ...fourLegs(size, { height: legH, thickness: 45, inset: 45, tone: 0.84 }),
        block(0, legH + h * 0.05, 0, w, d, h * 0.1, { tone: 1.02 }),
        block(0, h * 0.72, -d / 2 + 30, w * 0.92, Math.min(56, d * 0.16), h * 0.5, { tone: 0.92 }),
        block(-(w / 2 - 35), h * 0.68, -d / 2 + 34, 30, 30, h * 0.62, { tone: 0.88 }),
        block(w / 2 - 35, h * 0.68, -d / 2 + 34, 30, 30, h * 0.62, { tone: 0.88 }),
      ]
    }
    case 'table':
    case 'desk':
    case 'nightstand': {
      if (shape === 'round') {
        const topH = Math.min(60, h * 0.12)
        const pedestal = Math.max(80, w * 0.14)
        return [
          block(0, h - topH / 2, 0, w, d, topH, { round: true }),
          block(0, (h - topH) / 2, 0, pedestal, pedestal, h - topH, { round: true, tone: 0.9 }),
          block(0, Math.max(18, h * 0.03), 0, w * 0.45, d * 0.45, Math.max(36, h * 0.06), {
            round: true,
            tone: 0.86,
          }),
        ]
      }
      if (kind === 'desk') {
        const topH = Math.min(50, h * 0.1)
        const panel = Math.min(60, w * 0.07)
        const legH = h - topH
        return [
          block(0, h - topH / 2, 0, w, d, topH),
          block(-(w / 2 - panel / 2), legH / 2, 0, panel, d * 0.9, legH, { tone: 0.9 }),
          block(w / 2 - panel / 2, legH / 2, 0, panel, d * 0.9, legH, { tone: 0.9 }),
          block(0, h * 0.45, -d / 2 + 20, w * 0.7, 30, h * 0.34, { tone: 0.92 }),
          block(w * 0.22, h * 0.66, d / 2 - 12, w * 0.36, 16, h * 0.2, { tone: 0.97 }),
          block(w * 0.22, h * 0.66, d / 2 - 8, Math.min(60, w * 0.04), 10, 22, { tone: 0.78 }),
        ]
      }
      if (kind === 'nightstand') {
        const legH = Math.min(80, h * 0.16)
        const bodyH = h - legH
        const topH = Math.min(30, h * 0.06)
        return [
          ...fourLegs(size, { height: legH, thickness: 40, inset: 40, tone: 0.84 }),
          block(0, legH + bodyH / 2, 0, w, d, bodyH, { tone: 0.97 }),
          block(0, h - topH / 2, 0, w, d, topH),
          block(0, legH + bodyH * 0.48, d / 2 - 10, w * 0.82, 14, bodyH * 0.36, { tone: 0.92 }),
          block(0, legH + bodyH * 0.48, d / 2 - 8, Math.min(70, w * 0.16), 10, 20, { tone: 0.76 }),
        ]
      }
      const topH = Math.min(50, h * 0.12)
      const legH = h - topH
      const legT = Math.max(36, Math.min(75, w * 0.07, d * 0.11))
      const inset = Math.min(w, d) * 0.07
      const apronH = Math.min(70, h * 0.1)
      return [
        block(0, h - topH / 2, 0, w, d, topH),
        block(0, h - topH - apronH / 2, -d / 2 + 22, w * 0.9, 24, apronH, { tone: 0.92 }),
        block(0, h - topH - apronH / 2, d / 2 - 22, w * 0.9, 24, apronH, { tone: 0.92 }),
        block(-(w / 2 - 22), h - topH - apronH / 2, 0, 24, d * 0.85, apronH, { tone: 0.92 }),
        block(w / 2 - 22, h - topH - apronH / 2, 0, 24, d * 0.85, apronH, { tone: 0.92 }),
        block(-(w / 2 - legT / 2 - inset), legH / 2, -(d / 2 - legT / 2 - inset), legT, legT, legH, { tone: 0.86 }),
        block(w / 2 - legT / 2 - inset, legH / 2, -(d / 2 - legT / 2 - inset), legT, legT, legH, { tone: 0.86 }),
        block(-(w / 2 - legT / 2 - inset), legH / 2, d / 2 - legT / 2 - inset, legT, legT, legH, { tone: 0.86 }),
        block(w / 2 - legT / 2 - inset, legH / 2, d / 2 - legT / 2 - inset, legT, legT, legH, { tone: 0.86 }),
      ]
    }
    case 'wardrobe': {
      const plinth = Math.min(50, h * 0.03)
      const bodyH = h - plinth
      const doorDepth = Math.min(18, d * 0.04)
      const doorH = bodyH * 0.9
      return [
        block(0, plinth / 2, 0, w * 0.94, d * 0.94, plinth, { tone: 0.82 }),
        block(0, plinth + bodyH / 2, 0, w, d, bodyH, { tone: 0.98 }),
        block(-w * 0.25, plinth + bodyH * 0.5, d / 2 - doorDepth / 2, w / 2 - 16, doorDepth, doorH, {
          tone: 1.05,
        }),
        block(w * 0.25, plinth + bodyH * 0.5, d / 2 - doorDepth / 2, w / 2 - 16, doorDepth, doorH, {
          tone: 1.02,
        }),
        block(-14, plinth + bodyH * 0.52, d / 2 - doorDepth, 14, 12, Math.min(260, bodyH * 0.35), {
          tone: 0.82,
        }),
        block(14, plinth + bodyH * 0.52, d / 2 - doorDepth, 14, 12, Math.min(260, bodyH * 0.35), {
          tone: 0.82,
        }),
        block(0, h - 10, 0, w, d, 20, { tone: 0.9 }),
      ]
    }
    case 'shelf': {
      const side = Math.min(40, w * 0.05)
      const back = Math.min(24, d * 0.08)
      const innerW = w - side * 2
      const shelfT = Math.max(24, Math.min(34, h * 0.02))
      const levels = [0.08, 0.3, 0.52, 0.74, 0.95]
      return [
        block(-(w / 2 - side / 2), h / 2, 0, side, d, h, { tone: 0.95 }),
        block(w / 2 - side / 2, h / 2, 0, side, d, h, { tone: 0.95 }),
        block(0, h / 2, -d / 2 + back / 2, innerW, back, h, { tone: 0.9 }),
        ...levels.map((fraction) =>
          block(0, h * fraction, 0, innerW, d * 0.96, shelfT, { tone: 1.01 }),
        ),
      ]
    }
    case 'dresser': {
      const legH = Math.min(80, h * 0.1)
      const bodyH = h - legH
      const topH = Math.min(32, h * 0.045)
      return [
        ...fourLegs(size, { height: legH, thickness: 45, inset: 45, tone: 0.82 }),
        block(0, legH + bodyH / 2, 0, w, d, bodyH, { tone: 0.98 }),
        block(0, h - topH / 2, 0, w, d, topH),
        ...[0.2, 0.46, 0.72].map((fraction) =>
          block(0, legH + bodyH * fraction, d / 2 - 10, w * 0.9, 16, bodyH * 0.18, { tone: 0.93 }),
        ),
        ...[0.2, 0.46, 0.72].map((fraction) =>
          block(0, legH + bodyH * fraction, d / 2 - 9, Math.min(120, w * 0.2), 10, 18, { tone: 0.76 }),
        ),
      ]
    }
    case 'tvStand': {
      const legH = Math.min(70, h * 0.14)
      const bodyH = h * 0.42
      const bodyTop = legH + bodyH
      const tvH = Math.max(70, h - bodyTop - 50)
      return [
        ...fourLegs(size, { height: legH, thickness: 45, inset: 50, tone: 0.82 }),
        block(0, legH + bodyH / 2, 0, w, d * 0.9, bodyH, { tone: 0.97 }),
        block(-w * 0.24, legH + bodyH * 0.5, d * 0.45 - 8, w * 0.42, 14, bodyH * 0.72, { tone: 1.03 }),
        block(w * 0.24, legH + bodyH * 0.5, d * 0.45 - 8, w * 0.42, 14, bodyH * 0.72, { tone: 1.00 }),
        block(0, bodyTop + 15, -d * 0.28, w * 0.42, Math.min(100, d * 0.26), 30, { tone: 0.86 }),
        block(0, bodyTop + 30 + tvH / 2, -d * 0.28, w * 0.86, Math.min(70, d * 0.16), tvH, {
          color: '#6f7882',
        }),
      ]
    }
    case 'counter': {
      const kick = Math.min(70, h * 0.08)
      const topH = Math.min(45, h * 0.05)
      const bodyTop = h - topH
      const upstand = Math.min(90, h * 0.1)
      const doorCount = Math.max(2, Math.round(w / 600))
      const doorWidth = (w - 60) / doorCount
      const doors: Part[] = []
      const handles: Part[] = []
      for (let index = 0; index < doorCount; index += 1) {
        const x = -w / 2 + 30 + doorWidth / 2 + index * (doorWidth + 6)
        doors.push(
          block(x, kick + (bodyTop - kick) * 0.52, d / 2 - 14, doorWidth - 8, 16, (bodyTop - kick) * 0.72, {
            tone: index % 2 === 0 ? 1.03 : 0.99,
          }),
        )
        handles.push(
          block(x, bodyTop - 90, d / 2 - 10, Math.min(90, doorWidth * 0.4), 10, 16, { tone: 0.74 }),
        )
      }
      return [
        block(0, kick / 2, 0, w * 0.96, d * 0.88, kick, { tone: 0.8 }),
        block(0, kick + (bodyTop - kick) / 2, 0, w, d * 0.95, bodyTop - kick, { tone: 0.97 }),
        block(0, bodyTop + topH / 2, 0, w, d, topH, { color: '#e9e1d4' }),
        block(0, h - upstand / 2, -d / 2 + 18, w, 24, upstand, { color: '#efe7d9' }),
        ...doors,
        ...handles,
      ]
    }
    case 'fridge': {
      const bodyTop = h * 0.97
      const gap = h * 0.02
      return [
        block(0, bodyTop / 2, 0, w, d, bodyTop, { tone: 0.99 }),
        block(0, bodyTop * 0.72 + gap, d / 2 - 8, w * 0.94, 16, bodyTop * 0.5, { tone: 1.02 }),
        block(0, bodyTop * 0.26 - gap, d / 2 - 8, w * 0.94, 16, bodyTop * 0.4, { tone: 1.0 }),
        block(0, bodyTop * 0.72 + gap, d / 2 - 9, 22, 10, Math.min(240, bodyTop * 0.2), { tone: 0.8 }),
        block(0, bodyTop * 0.26 - gap, d / 2 - 9, 22, 10, Math.min(200, bodyTop * 0.18), { tone: 0.8 }),
      ]
    }
    case 'tub': {
      const shellH = h * 0.96
      const inset = Math.min(100, Math.min(w, d) * 0.1)
      return [
        block(0, shellH / 2, 0, w, d, shellH, { tone: 0.99 }),
        block(0, shellH + 6, 0, w - inset * 2, d - inset * 2, 20, { color: '#dfeaf0' }),
        block(w / 2 - 90, h * 0.62, -d / 2 + 90, 60, 60, h * 0.5, { tone: 0.9 }),
        block(w / 2 - 90, h * 0.86, -d / 2 + 150, 50, 220, 40, { tone: 0.9 }),
      ]
    }
    case 'toilet': {
      const bowlZ = d * 0.14
      const bowlH = h * 0.42
      const bowlD = Math.min(d * 0.56, d - 140)
      return [
        block(0, bowlH / 2, bowlZ, w * 0.7, bowlD, bowlH, { tone: 0.98 }),
        block(0, bowlH + 12, bowlZ, w * 0.76, bowlD + 20, 26, { round: true, tone: 1.05 }),
        block(0, h * 0.34, -d / 2 + Math.min(110, d * 0.2), w * 0.94, Math.min(220, d * 0.38), h * 0.66, {
          tone: 0.96,
        }),
        block(-w * 0.15, h * 0.74, -d / 2 + Math.min(110, d * 0.2), 50, 30, 12, { tone: 0.78 }),
      ]
    }
    case 'basin': {
      const pedestalH = h * 0.62
      return [
        block(0, pedestalH / 2, 0, w * 0.3, d * 0.34, pedestalH, { tone: 0.94 }),
        block(0, pedestalH + h * 0.16, 0, w, d, h * 0.3, { tone: 1.02 }),
        block(0, pedestalH + h * 0.32, 0, w * 0.74, d * 0.62, h * 0.06, { color: '#dfeaf0' }),
        block(0, h * 0.88, -d / 2 + 60, 50, 50, h * 0.2, { tone: 0.8 }),
        block(0, h * 0.96, -d / 2 + 150, 36, 180, 30, { tone: 0.8 }),
      ]
    }
    case 'shower': {
      const tray = Math.max(50, h * 0.06)
      const glass = h - tray
      return [
        block(0, tray / 2, 0, w, d, tray, { tone: 0.99 }),
        block(0, tray + glass / 2, -d / 2 + 16, w, 30, glass, { alpha: 0.22, color: '#c7dde5' }),
        block(-w / 2 + 16, tray + glass / 2, 0, 30, d, glass, { alpha: 0.18, color: '#c7dde5' }),
        block(w / 2 - 16, tray + glass / 2, 0, 30, d * 0.55, glass, { alpha: 0.18, color: '#c7dde5' }),
        block(-w / 2 + 70, h * 0.74, -d / 2 + 70, 36, 36, h * 0.5, { tone: 0.82 }),
        block(-w / 2 + 130, h * 0.94, -d / 2 + 110, 170, 170, 40, { round: true, tone: 0.82 }),
      ]
    }
    case 'radiator': {
      const panelH = h * 0.7
      const y = h * 0.56
      const fins = [0.12, 0.32, 0.52, 0.72, 0.92].map((fraction) =>
        block(-w / 2 + w * fraction - w * 0.03, y, 0, w * 0.06, d, panelH, { tone: 1.04 }),
      )
      return [
        block(0, y, 0, w, d * 0.7, panelH, { tone: 0.96 }),
        ...fins,
        block(-w / 2 + 50, Math.min(80, h * 0.15), 0, 30, 30, Math.min(160, h * 0.25), { tone: 0.8 }),
        block(w / 2 - 50, Math.min(80, h * 0.15), 0, 30, 30, Math.min(160, h * 0.25), { tone: 0.8 }),
      ]
    }
    case 'rug': {
      const border = Math.max(18, Math.min(70, Math.min(w, d) * 0.04))
      const layer = Math.max(2, h * 0.5)
      return [
        block(0, layer / 2, 0, w, d, layer),
        block(0, h - layer / 2, 0, w - border * 2, d - border * 2, layer, { tone: 1.1 }),
      ]
    }
    case 'plant': {
      const potH = h * 0.26
      const potW = Math.min(w * 0.56, d * 0.56)
      const foliageH = h * 0.5
      const foliageW = Math.min(w * 0.8, d * 0.8)
      return [
        block(0, potH / 2, 0, potW, potW, potH, { round: true, color: '#c2ae9b' }),
        block(0, potH + 6, 0, potW * 0.86, potW * 0.86, 18, { round: true, color: '#57493b' }),
        block(0, h * 0.44, 0, Math.max(30, w * 0.08), Math.max(30, d * 0.08), h * 0.38, {
          color: '#8a7c69',
        }),
        block(-w * 0.1, h * 0.66, d * 0.04, foliageW * 0.8, foliageW * 0.8, foliageH * 0.8, {
          round: true,
        }),
        block(w * 0.1, h * 0.78, -d * 0.05, foliageW * 0.7, foliageW * 0.7, foliageH * 0.75, {
          round: true,
          tone: 1.08,
        }),
        block(0, h * 0.86, d * 0.02, foliageW * 0.6, foliageW * 0.6, foliageH * 0.24, {
          round: true,
          tone: 1.04,
        }),
      ]
    }
    case 'lamp': {
      const baseH = Math.max(20, h * 0.025)
      const shadeH = h * 0.18
      return [
        block(0, baseH / 2, 0, Math.min(w * 0.62, d * 0.62), Math.min(w * 0.62, d * 0.62), baseH, {
          round: true,
          tone: 0.9,
        }),
        block(0, h * 0.48, 0, Math.max(26, w * 0.08), Math.max(26, d * 0.08), h * 0.88, {
          tone: 0.86,
        }),
        block(0, h - shadeH / 2, 0, Math.min(w * 0.62, d * 0.62), Math.min(w * 0.62, d * 0.62), shadeH, {
          round: true,
          color: '#f0e5cf',
        }),
      ]
    }
    case 'lshape':
    case 'round':
    case 'box':
    default:
      return shapeParts(shape, size)
  }
}
