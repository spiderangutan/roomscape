export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Round a millimetre measurement to a friendly precision. */
export function tidyMm(mm: number): number {
  return Math.round(mm * 2) / 2
}

export function titleCase(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Turn "Floor lamp" | "floor lamp" into a stable id fragment. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

export function relativeTime(then: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(then).toLocaleDateString()
}

export function formatClock(then: number): string {
  return new Date(then).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Deterministic name generator for duplicated rooms. */
export function uniqueName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let index = 2
  while (existing.includes(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}
