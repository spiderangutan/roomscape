import { useMemo, useState } from 'react'
import type { CatalogItem } from '../types.ts'
import { CATALOG, CATALOG_CATEGORIES } from '../lib/catalog.ts'
import { getProject, getRoom, store, useStoreState } from '../lib/store.ts'
import { formatLengthCompact } from '../lib/units.ts'
import { cx } from '../lib/util.ts'

interface Props {
  onCustomItem: () => void
  onClose: () => void
}

export default function CatalogPanel({ onCustomItem, onClose }: Props) {
  const state = useStoreState()
  const project = getProject(state)
  const room = getRoom(state)
  const unit = project?.unit ?? 'ft'
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')

  const custom = project?.customItems ?? []
  const categories = useMemo(
    () => ['All', ...CATALOG_CATEGORIES, ...(custom.length ? ['Custom'] : [])],
    [custom.length],
  )

  const visible = useMemo(() => {
    const pool: CatalogItem[] = category === 'Custom' ? custom : category === 'All' ? CATALOG : CATALOG.filter((item) => item.category === category)
    const needle = query.trim().toLowerCase()
    if (!needle) return pool
    return pool.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(needle))
  }, [category, query, custom])

  const add = (item: CatalogItem) => {
    store.addCatalogItem(item)
  }

  return (
    <section className="panel__section panel__section--grow" aria-label="Furniture and objects">
      <div className="panel__head">
        <h2 className="panel__title">Furniture &amp; objects</h2>
        <button type="button" className="icon-btn panel__close" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </div>

      <div className="catalog">
        <input
          className="catalog__search"
          type="search"
          placeholder="Search furniture…"
          value={query}
          aria-label="Search the catalog"
          onChange={(event) => setQuery(event.target.value)}
        />

        <div className="chip-row chip-row--scroll">
          {categories.map((entry) => (
            <button
              key={entry}
              type="button"
              className={cx('chip', category === entry && 'chip--active')}
              aria-pressed={category === entry}
              onClick={() => setCategory(entry)}
            >
              {entry}
            </button>
          ))}
        </div>

        <button type="button" className="btn btn--block btn--dashed" onClick={onCustomItem} disabled={!project}>
          + Create custom item
        </button>

        {!room && <p className="muted small">Open a room to place furniture.</p>}

        <ul className="catalog__list">
          {visible.map((item) => (
            <li key={item.id}>
              <div className="catalog-item">
                <span className="catalog-item__swatch" style={{ background: item.color }}>
                  {item.shape === 'round' ? '●' : item.shape === 'lshape' ? '◳' : ''}
                </span>
                <span className="catalog-item__body">
                  <span className="catalog-item__name">
                    {item.name}
                    {item.fixed && <span className="pill pill--muted">Fixture</span>}
                    {item.overlappable && <span className="pill pill--muted">Layers</span>}
                  </span>
                  <span className="catalog-item__size">
                    {formatLengthCompact(item.w, unit)} × {formatLengthCompact(item.d, unit)} ×{' '}
                    {formatLengthCompact(item.h, unit)}
                  </span>
                </span>
                <span className="catalog-item__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    disabled={!room}
                    onClick={() => add(item)}
                    title={`Add ${item.name} to ${room?.name ?? 'the room'}`}
                  >
                    Add
                  </button>
                  {item.category === 'Custom' && (
                    <button
                      type="button"
                      className="row-btn row-btn--danger"
                      aria-label={`Remove ${item.name} from the catalog`}
                      title="Remove from the catalog"
                      onClick={() => store.deleteCustomCatalogItem(item.id)}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {visible.length === 0 && <p className="muted small">Nothing matches that search.</p>}
      </div>
    </section>
  )
}
