import { useEffect, useRef, useState } from 'react'
import { formatLength, parseLength } from '../lib/units.ts'
import { cx } from '../lib/util.ts'
import type { Unit } from '../types.ts'

interface UnitFieldProps {
  value: number
  unit: Unit
  onChange: (mm: number) => void
  label?: string
  min?: number
  max?: number
  id?: string
}

/**
 * Text field for a millimetre measurement. Accepts "12 ft 6 in", "2.4 m",
 * "85 cm" or a bare number in the project unit.
 */
export function UnitField({ value, unit, onChange, label, min = 0, max = 100000, id }: UnitFieldProps) {
  const [draft, setDraft] = useState(() => formatLength(value, unit))
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!editing) {
      setDraft(formatLength(value, unit))
      setInvalid(false)
    }
  }, [value, unit, editing])

  const commit = () => {
    const parsed = parseLength(draft, unit)
    if (parsed === null) {
      setDraft(formatLength(value, unit))
      setInvalid(false)
      return
    }
    const clamped = Math.min(max, Math.max(min, parsed))
    onChange(clamped)
    setDraft(formatLength(clamped, unit))
    setInvalid(false)
  }

  return (
    <label className={cx('field', invalid && 'field--invalid')} htmlFor={id}>
      {label && <span className="field__label">{label}</span>}
      <input
        id={id}
        className="field__input"
        value={draft}
        inputMode="text"
        spellCheck={false}
        onFocus={(event) => {
          setEditing(true)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(parseLength(event.target.value, unit) === null)
        }}
        onBlur={() => {
          setEditing(false)
          commit()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(formatLength(value, unit))
            setInvalid(false)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

interface InlineTextProps {
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
}

/** Borderless name field that commits on blur or Enter. */
export function InlineText({ value, onChange, className, ariaLabel, placeholder, disabled }: InlineTextProps) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  return (
    <input
      ref={ref}
      className={cx('inline-text', className)}
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft.trim() !== value) onChange(draft.trim() || value)
        else setDraft(value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          ref.current?.blur()
        }
        if (event.key === 'Escape') {
          setDraft(value)
          ref.current?.blur()
        }
      }}
    />
  )
}
