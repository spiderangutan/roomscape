import type { Unit } from '../types.ts'

export const MM_PER_INCH = 25.4
export const MM_PER_FOOT = 304.8

const FACTOR: Record<Unit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_INCH,
  ft: MM_PER_FOOT,
}

export const UNITS: Unit[] = ['ft', 'in', 'm', 'cm', 'mm']

export const UNIT_LABELS: Record<Unit, string> = {
  ft: 'Feet & inches (12 ft 6 in)',
  in: 'Inches (85 in)',
  m: 'Metres (3.81 m)',
  cm: 'Centimetres (85 cm)',
  mm: 'Millimetres (850 mm)',
}

export const UNIT_ABBR: Record<Unit, string> = {
  ft: 'ft',
  in: 'in',
  m: 'm',
  cm: 'cm',
  mm: 'mm',
}

export function isMetric(unit: Unit): boolean {
  return unit === 'm' || unit === 'cm' || unit === 'mm'
}

/** Grid/snap increment: 50 mm metric, 2 inches imperial. */
export function snapStep(unit: Unit): number {
  return isMetric(unit) ? 50 : 50.8
}

const WORD_FIXES: Array<[RegExp, string]> = [
  [/centimet(?:re|er)s?|cms?/g, ' cm '],
  [/millimet(?:re|er)s?|mms?/g, ' mm '],
  [/met(?:re|er)s?/g, ' m '],
  [/feet|foot|fts?/g, ' ft '],
  [/inch(?:es)?|ins?/g, ' in '],
]

/**
 * Parse a human measurement into millimetres. Understands "12 ft 6 in", "5'6\"",
 * "2.4 m", "85cm", "900" (interpreted in `unit`) and comma decimals.
 * Returns null when nothing numeric can be read.
 */
export function parseLength(raw: string | number | null | undefined, unit: Unit): number | null {
  if (raw === null || raw === undefined) return null
  let text = String(raw).toLowerCase().trim()
  if (!text) return null
  text = text.replace(/(\d),(\d)/g, '$1.$2')
  text = text.replace(/[′’]/g, "'").replace(/[″”]/g, '"')
  for (const [pattern, replacement] of WORD_FIXES) text = text.replace(pattern, replacement)
  text = text.replace(/'/g, ' ft ').replace(/"/g, ' in ')

  const token = /(-?\d+(?:\.\d+)?)\s*(mm|cm|ft|in|m)?/g
  let total = 0
  let found = 0
  let lastUnit: Unit | null = null
  let match: RegExpExecArray | null
  while ((match = token.exec(text)) !== null) {
    const value = Number.parseFloat(match[1])
    if (!Number.isFinite(value)) continue
    let tokenUnit = (match[2] as Unit | undefined) ?? null
    if (!tokenUnit) {
      // "5 ft 6" reads as 5 ft 6 in; anything else falls back to the display unit.
      tokenUnit = lastUnit === 'ft' && value < 12 ? 'in' : unit
    }
    total += value * FACTOR[tokenUnit]
    lastUnit = tokenUnit
    found += 1
  }
  if (!found) return null
  return Math.round(total * 10) / 10
}

function trimNumber(value: number, digits: number): string {
  let text = value.toFixed(digits)
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '')
  return text
}

/** Full readable form, e.g. "12 ft 6 in", "3.81 m", "85 cm". */
export function formatLength(mm: number, unit: Unit): string {
  if (!Number.isFinite(mm)) return '—'
  const negative = mm < 0
  const value = Math.abs(mm)
  let text: string
  switch (unit) {
    case 'ft': {
      let feet = Math.floor(value / MM_PER_FOOT)
      const inchesRaw = ((value - feet * MM_PER_FOOT) / MM_PER_INCH) * 2
      let inches = Math.round(inchesRaw) / 2
      if (inches >= 12) {
        feet += 1
        inches -= 12
      }
      if (inches === 0) text = `${feet} ft`
      else text = `${feet} ft ${trimNumber(inches, 1)} in`
      break
    }
    case 'in':
      text = `${trimNumber(value / MM_PER_INCH, 2)} in`
      break
    case 'cm':
      text = `${trimNumber(value / 10, 1)} cm`
      break
    case 'mm':
      text = `${trimNumber(value, 1)} mm`
      break
    case 'm':
    default:
      text = `${trimNumber(value / 1000, 3)} m`
      break
  }
  return negative ? `-${text}` : text
}

/** Compact form for canvas labels, e.g. 12′6″, 3.81 m, 85 cm. */
export function formatLengthCompact(mm: number, unit: Unit): string {
  if (!Number.isFinite(mm)) return ''
  const value = Math.abs(mm)
  switch (unit) {
    case 'ft': {
      let feet = Math.floor(value / MM_PER_FOOT)
      let inches = Math.round((((value - feet * MM_PER_FOOT) / MM_PER_INCH) * 2) as number) / 2
      if (inches >= 12) {
        feet += 1
        inches -= 12
      }
      return inches === 0 ? `${feet}′` : `${feet}′${trimNumber(inches, 1)}″`
    }
    case 'in':
      return `${trimNumber(value / MM_PER_INCH, 2)} in`
    case 'cm':
      return `${trimNumber(value / 10, 1)} cm`
    case 'mm':
      return `${trimNumber(value, 1)} mm`
    case 'm':
    default:
      return `${trimNumber(value / 1000, 3)} m`
  }
}

/** Convert a millimetre measurement into a plain number in the given unit. */
export function toUnit(mm: number, unit: Unit): number {
  return mm / FACTOR[unit]
}

/** Convert a value expressed in `unit` back to millimetres. */
export function fromUnit(value: number, unit: Unit): number {
  return value * FACTOR[unit]
}
