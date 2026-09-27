import { useEffect, useMemo, useRef, useState } from 'react'
import { DAY_SHORT } from '../lib/ics'

export interface GridEvent {
  key: string
  day: number // 0 = Monday
  start: number // minutes from midnight
  end: number
  title: string
  sub?: string
  badge?: string
  color: string
  dashed?: boolean
  /** cancelled for this date only (shown struck through) */
  cancelled?: boolean
  /** has a note / change just for this date */
  marked?: boolean
  onClick?: () => void
}

interface Props {
  events: GridEvent[]
  /** days to show (0 = Monday); defaults to Mon–Fri plus any day that has events */
  days?: number[]
  /** date of each column (for headers and the "now" line) */
  weekStart?: Date
  onSlot?: (day: number, minute: number) => void
  hourHeight?: number
  allDay?: Record<number, { key: string; label: string; color: string; onClick?: () => void }[]>
}

const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Weekly time grid with overlapping events laid out side by side. */
export function WeekGrid({ events, days, weekStart, onSlot, hourHeight = 46, allDay }: Props) {
  const shown = useMemo(() => {
    if (days) return days
    const set = new Set([0, 1, 2, 3, 4])
    for (const e of events) set.add(e.day)
    for (const d of Object.keys(allDay ?? {})) set.add(+d)
    return [...set].sort()
  }, [days, events, allDay])

  const [from, to] = useMemo(() => {
    let a = 8 * 60,
      b = 19 * 60
    for (const e of events) {
      a = Math.min(a, Math.floor(e.start / 60) * 60)
      b = Math.max(b, Math.ceil(e.end / 60) * 60)
    }
    return [a, b]
  }, [events])
  const hours = Array.from({ length: (to - from) / 60 }, (_, i) => from / 60 + i)
  const px = (m: number) => ((m - from) / 60) * hourHeight

  // side-by-side lanes for overlapping events
  const laid = useMemo(() => {
    const out: (GridEvent & { lane: number; lanes: number })[] = []
    for (const d of shown) {
      const list = events.filter((e) => e.day === d).sort((a, b) => a.start - b.start || b.end - a.end)
      let group: (GridEvent & { lane: number; lanes: number })[] = []
      let groupEnd = -1
      const flush = () => {
        const lanes = Math.max(1, ...group.map((g) => g.lane + 1))
        group.forEach((g) => (g.lanes = lanes))
        out.push(...group)
        group = []
      }
      for (const e of list) {
        if (e.start >= groupEnd && group.length) flush()
        const used = new Set(group.filter((g) => g.end > e.start).map((g) => g.lane))
        let lane = 0
        while (used.has(lane)) lane++
        group.push({ ...e, lane, lanes: 1 })
        groupEnd = Math.max(groupEnd, e.end)
      }
      if (group.length) flush()
    }
    return out
  }, [events, shown])

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const dateOf = (d: number) => {
    if (!weekStart) return null
    const x = new Date(weekStart)
    x.setDate(x.getDate() + d)
    return x
  }
  const isToday = (d: number) => {
    const x = dateOf(d)
    return x ? x.toDateString() === now.toDateString() : (now.getDay() + 6) % 7 === d
  }
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const scroller = useRef<HTMLDivElement>(null)
  const hasAllDay = allDay && Object.values(allDay).some((l) => l.length)

  return (
    <div className="week-grid" ref={scroller}>
      <div className="wg-inner" style={{ gridTemplateColumns: `44px repeat(${shown.length}, minmax(96px, 1fr))` }}>
        <div className="wg-corner" />
        {shown.map((d) => {
          const x = dateOf(d)
          return (
            <div key={d} className={`wg-head ${isToday(d) ? 'today' : ''}`}>
              <span>{DAY_SHORT[d]}</span>
              {x && <b>{x.getDate()}</b>}
            </div>
          )
        })}
        {hasAllDay && (
          <>
            <div className="wg-allday-label">all-day</div>
            {shown.map((d) => (
              <div key={d} className="wg-allday">
                {(allDay![d] ?? []).map((a) => (
                  <button key={a.key} className="wg-chip" style={{ ['--c' as string]: a.color }} onClick={a.onClick}>
                    {a.label}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
        <div className="wg-times" style={{ height: hours.length * hourHeight }}>
          {hours.map((h) => (
            <div key={h} style={{ top: (h * 60 - from) / 60 * hourHeight }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {shown.map((d) => (
          <div
            key={d}
            className={`wg-col ${isToday(d) ? 'today' : ''} ${onSlot ? 'clickable' : ''}`}
            style={{ height: hours.length * hourHeight, backgroundSize: `100% ${hourHeight}px` }}
            onClick={(e) => {
              if (!onSlot || e.target !== e.currentTarget) return
              const r = e.currentTarget.getBoundingClientRect()
              const m = from + Math.round((((e.clientY - r.top) / hourHeight) * 60) / 30) * 30
              onSlot(d, Math.max(from, Math.min(to - 60, m)))
            }}
          >
            {isToday(d) && nowMin > from && nowMin < to && <div className="wg-now" style={{ top: px(nowMin) }} />}
            {laid
              .filter((e) => e.day === d)
              .map((e) => (
                <button
                  key={e.key}
                  className={`wg-event ${e.dashed ? 'dashed' : ''} ${e.cancelled ? 'cancelled' : ''}`}
                  style={{
                    ['--c' as string]: e.color,
                    top: px(e.start) + 1,
                    height: Math.max(22, px(e.end) - px(e.start) - 2),
                    left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`,
                    width: `calc(${100 / e.lanes}% - 4px)`,
                  }}
                  onClick={e.onClick}
                  title={`${e.title} · ${fmt(e.start)}–${fmt(e.end)}${e.sub ? ' · ' + e.sub : ''}`}
                >
                  <span className="wg-title">
                    {e.badge && <i>{e.badge}</i>}
                    {e.title}
                    {e.marked && <b className="wg-mark" title="Changed or has a note for this day">✎</b>}
                  </span>
                  <span className="wg-time">
                    {fmt(e.start)}–{fmt(e.end)}
                  </span>
                  {e.sub && <span className="wg-sub">{e.sub}</span>}
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
