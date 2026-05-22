'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKeyFromDate(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatEventTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatEventDateTime(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  try {
    return d.toLocaleString(undefined, timeZone ? { timeZone } : undefined);
  } catch {
    return d.toLocaleString();
  }
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

/**
 * Month grid calendar — same markup/classes as admin panel (`styles.css`).
 * @param {{
 *   events: Array<{ id?: number, title?: string, starts_at?: string, created_at?: string }>,
 *   loading?: boolean,
 *   onRefresh: () => void | Promise<void>,
 *   onDelete: (id: number) => void | Promise<void>,
 *   timeZone?: string,
 *   showUserInModal?: boolean,
 * }} props
 */
export function MonthCalendar({
  events,
  loading = false,
  onRefresh,
  onDelete,
  timeZone,
  showUserInModal = false,
}) {
  const now = new Date();
  const [view, setView] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [modal, setModal] = useState(null);

  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      const d = new Date(e.starts_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKeyFromDate(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    }
    return map;
  }, [events]);

  const todayKey = dayKeyFromDate(now);

  const cells = useMemo(() => {
    const { year, month } = view;
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const out = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + i);
      const dayKey = dayKeyFromDate(day);
      out.push({
        day,
        dayKey,
        inMonth: day.getMonth() === month,
        isToday: dayKey === todayKey,
        events: eventsByDay.get(dayKey) || [],
      });
    }
    return out;
  }, [view, eventsByDay, todayKey]);

  const closeModal = useCallback(() => setModal(null), []);

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, closeModal]);

  const handleDelete = async (id) => {
    if (!Number.isFinite(id) || id < 1) return;
    if (!window.confirm('Delete this calendar event?')) return;
    await onDelete(id);
  };

  return (
    <>
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button
            type="button"
            className="primary ghost"
            aria-label="Previous month"
            disabled={loading}
            onClick={() =>
              setView((v) => {
                const next = new Date(v.year, v.month - 1, 1);
                return { year: next.getFullYear(), month: next.getMonth() };
              })
            }
          >
            ←
          </button>
          <button
            type="button"
            className="primary ghost"
            disabled={loading}
            onClick={() => {
              const n = new Date();
              setView({ year: n.getFullYear(), month: n.getMonth() });
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="primary ghost"
            aria-label="Next month"
            disabled={loading}
            onClick={() =>
              setView((v) => {
                const next = new Date(v.year, v.month + 1, 1);
                return { year: next.getFullYear(), month: next.getMonth() };
              })
            }
          >
            →
          </button>
        </div>
        <div className="calendar-month-label" aria-live="polite">
          {monthLabel(view.year, view.month)}
        </div>
        <button type="button" className="primary ghost" disabled={loading} onClick={() => onRefresh()}>
          Refresh
        </button>
      </div>

      <div className="calendar-month-wrap">
        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="calendar-month-grid">
          {cells.map(({ day, dayKey, inMonth, isToday, events: dayEvents }) => (
            <div
              key={dayKey}
              className={[
                'cal-day',
                !inMonth ? 'is-outside' : '',
                isToday ? 'is-today' : '',
                dayEvents.length ? 'has-events' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role={dayEvents.length ? 'button' : undefined}
              tabIndex={dayEvents.length ? 0 : undefined}
              onClick={() => {
                if (!dayEvents.length) return;
                setModal({ day, events: dayEvents });
              }}
              onKeyDown={(ev) => {
                if (dayEvents.length && (ev.key === 'Enter' || ev.key === ' ')) {
                  ev.preventDefault();
                  setModal({ day, events: dayEvents });
                }
              }}
            >
              <div className="cal-day-number">{day.getDate()}</div>
              <div className="cal-day-events">
                {dayEvents.length ? (
                  dayEvents.map((e) => {
                    const id = Number(e.id);
                    return (
                      <div key={e.id ?? `${e.starts_at}-${e.title}`} className="cal-event-chip" title={e.title || ''}>
                        <span className="cal-event-time">{formatEventTime(e.starts_at)}</span>
                        <span className="cal-event-title">{e.title || ''}</span>
                        {Number.isFinite(id) ? (
                          <button
                            type="button"
                            className="btn-mini danger cal-event-delete"
                            aria-label="Delete event"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              handleDelete(id).catch(() => {});
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="cal-day-empty" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {modal ? (
        <div className="calendar-modal">
          <div
            className="calendar-modal-backdrop"
            data-cal-modal-close="backdrop"
            onClick={closeModal}
            aria-hidden="true"
          />
          <div
            className="calendar-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="userCalendarDayModalTitle"
          >
            <div className="calendar-modal-header">
              <h3 id="userCalendarDayModalTitle">
                Events on{' '}
                {modal.day.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </h3>
              <button type="button" className="btn-mini danger" aria-label="Close" onClick={closeModal}>
                Close
              </button>
            </div>
            <div className="calendar-modal-body">
              {modal.events.map((e) => (
                <article key={e.id ?? e.starts_at} className="calendar-modal-event">
                  <p>
                    <strong>Title:</strong> {e.title || '—'}
                  </p>
                  <p>
                    <strong>Starts:</strong> {formatEventDateTime(e.starts_at, timeZone)}
                  </p>
                  {showUserInModal ? (
                    <p>
                      <strong>User:</strong>{' '}
                      {e.user_name || e.username || e.display_name || (e.user_id != null ? String(e.user_id) : '—')}
                    </p>
                  ) : null}
                  {e.created_at ? (
                    <p>
                      <strong>Created:</strong> {formatEventDateTime(e.created_at, timeZone)}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
