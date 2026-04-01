/**
 * NYC Bird Alliance – NeonCRM Event Calendar Widget
 * Embed: <script src="https://neon-calendar-widget.vercel.app/widget.js"></script>
 * Place <div id="nba-calendar"></div> where you want the calendar to appear.
 */
(function () {
  'use strict';

  // ── Base URL: derived from this script's own src so API calls always go
  //    back to the same Vercel deployment, no matter where it's embedded. ──
  const BASE_URL = (function () {
    const s = document.currentScript;
    if (s && s.src) return s.src.replace(/\/widget\.js.*$/, '');
    // fallback for async/deferred loads
    const tags = document.querySelectorAll('script[src*="widget.js"]');
    if (tags.length) return tags[tags.length - 1].src.replace(/\/widget\.js.*$/, '');
    return '';
  })();

  // ── Month names ────────────────────────────────────────────────────────────
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAYS_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  // ── State ──────────────────────────────────────────────────────────────────
  const today = new Date();
  const state = {
    view:        'month',   // 'month' | 'list'
    year:        today.getFullYear(),
    month:       today.getMonth(),   // 0-based
    events:      [],
    allEvents:   [],        // raw cache per loaded month-key
    loading:     false,
    error:       null,
    categories:  [],        // distinct category names from data
    filters: {
      categories: [],       // active category names (empty = all)
      price:      [],       // [] | ['free'] | ['paid'] | ['free','paid']
      search:     '',
    },
    _cache:      {},        // { 'YYYY-MM': events[] }
    _searchTimer: null,
  };

  // ── CSS ────────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nba-widget-css')) return;

    // Google font
    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.id = 'nba-widget-css';
    style.textContent = `
/* ── Reset inside widget ── */
#nba-calendar *, #nba-calendar *::before, #nba-calendar *::after {
  box-sizing: border-box; margin: 0; padding: 0;
}
#nba-calendar { font-family: 'Montserrat', sans-serif; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.10); }

/* ── Header ── */
.nba-header {
  background: #15522B; color: #fff;
  padding: 18px 24px;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.nba-title    { font-size: 17px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; line-height: 1.1; }
.nba-subtitle { font-size: 10px; font-weight: 400; opacity: .75; text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }
.nba-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* buttons */
.nba-btn { border: none; padding: 7px 14px; font-family: inherit; font-size: 12px; font-weight: 600; cursor: pointer; letter-spacing: .04em; transition: background .15s; }
.nba-btn-today { background: #1BA249; color: #fff; }
.nba-btn-today:hover { background: #57B94C; }
.nba-btn-nav { background: rgba(255,255,255,.15); color: #fff; padding: 7px 11px; font-size: 15px; line-height: 1; }
.nba-btn-nav:hover { background: rgba(255,255,255,.30); }
.nba-month-label { font-size: 15px; font-weight: 700; color: #fff; min-width: 160px; text-align: center; }
.nba-view-toggle { display: flex; border: 1.5px solid rgba(255,255,255,.4); overflow: hidden; margin-left: 6px; }
.nba-view-btn { background: transparent; color: rgba(255,255,255,.65); border: none; padding: 6px 14px; font-family: inherit; font-size: 11px; font-weight: 600; cursor: pointer; letter-spacing: .05em; transition: all .15s; }
.nba-view-btn.active { background: #1BA249; color: #fff; }
.nba-view-btn + .nba-view-btn { border-left: 1.5px solid rgba(255,255,255,.4); }

/* ── Filters + Search ── */
.nba-filters {
  background: #f0f7f2; border-bottom: 1px solid #d4e8da;
  padding: 12px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.nba-search-wrap { position: relative; display: flex; align-items: center; flex-shrink: 0; }
.nba-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #888; font-size: 13px; pointer-events: none; }
.nba-search { background: #fff; border: 1.5px solid #c0d8c9; color: #222; font-family: inherit; font-size: 12px; padding: 7px 12px 7px 32px; width: 210px; outline: none; transition: border-color .15s; }
.nba-search::placeholder { color: #aaa; }
.nba-search:focus { border-color: #1BA249; }
.nba-filter-label { font-size: 10px; font-weight: 700; color: #15522B; text-transform: uppercase; letter-spacing: .07em; white-space: nowrap; }
.nba-filter-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.nba-filter-chip { display: inline-flex; align-items: center; background: #fff; border: 1.5px solid #c0d8c9; padding: 5px 13px; font-size: 11px; font-weight: 600; color: #15522B; cursor: pointer; transition: all .15s; white-space: nowrap; user-select: none; }
.nba-filter-chip.active { background: #15522B; border-color: #15522B; color: #fff; }
.nba-filter-chip:hover:not(.active) { border-color: #1BA249; color: #1BA249; }
.nba-filter-divider { width: 1px; height: 22px; background: #c0d8c9; }

/* ── Loading / Error ── */
.nba-status { padding: 40px 24px; text-align: center; font-size: 13px; color: #666; }
.nba-status.error { color: #c0392b; }
.nba-spinner { display: inline-block; width: 22px; height: 22px; border: 3px solid #d4e8da; border-top-color: #1BA249; border-radius: 50%; animation: nba-spin .7s linear infinite; margin-bottom: 8px; }
@keyframes nba-spin { to { transform: rotate(360deg); } }

/* ── Calendar grid ── */
.nba-calendar { overflow-x: auto; }
.nba-cal-head { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); background: #15522B; color: rgba(255,255,255,.85); min-width: 560px; }
.nba-cal-dow { padding: 10px 0; text-align: center; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
.nba-cal-body { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); border-left: 1px solid #e0e0e0; border-top: 1px solid #e0e0e0; min-width: 560px; }

/* ── Spanning event row (multi-day) ── */
.nba-span-row { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); padding: 2px 0; background: #f5fbf7; min-width: 560px; border-left: 1px solid #e8e8e8; border-right: 1px solid #e8e8e8; }
.nba-span-event { background: #8BCFCF; color: #15522B; font-size: 10.5px; font-weight: 700; padding: 2px 7px; margin: 1px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.nba-span-event:hover { background: #018F99; color: #fff; }

/* ── Calendar cells ── */
.nba-cal-cell { border-right: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0; min-height: 168px; padding: 7px; background: #fff; overflow: hidden; }
.nba-cal-cell.other-month { background: #fafafa; }
.nba-day-num { font-size: 12px; font-weight: 700; color: #15522B; margin-bottom: 4px; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; }
.nba-cal-cell.other-month .nba-day-num { color: #bbb; }
.nba-cal-cell.is-today .nba-day-num { background: #1BA249; color: #fff; }

/* ── Event chips ── */
.nba-event-wrap { position: relative; margin-bottom: 3px; }
.nba-event-chip { display: block; background: #1BA249; color: #fff; cursor: pointer; padding: 5px 7px 6px; transition: background .15s; text-decoration: none; }
.nba-event-chip:hover { background: #15522B; }
.nba-event-chip-time  { display: block; font-size: 9px; font-weight: 700; opacity: .88; letter-spacing: .02em; line-height: 1.2; margin-bottom: 2px; }
.nba-event-chip-title { font-size: 10px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ── Photo event card ── */
.nba-event-photo-wrap { position: relative; margin-bottom: 3px; border: 1.5px solid #d4e8da; cursor: pointer; transition: box-shadow .15s, border-color .15s; }
.nba-event-photo-wrap:hover { box-shadow: 0 2px 8px rgba(21,82,43,.20); border-color: #1BA249; }
.nba-event-photo-img  { width: 100%; height: 52px; object-fit: cover; display: block; }
.nba-event-photo-info { padding: 5px 7px 6px; background: #fff; }
.nba-event-photo-time { display: block; font-size: 9px; font-weight: 700; color: #15522B; line-height: 1.2; margin-bottom: 2px; }
.nba-event-photo-name { display: block; font-size: 10px; font-weight: 600; color: #222; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ── "+ N More" link ── */
.nba-more-link { display: block; font-size: 10px; font-weight: 600; color: #018F99; cursor: pointer; margin-top: 3px; background: none; border: none; padding: 0; font-family: inherit; text-align: left; }
.nba-more-link:hover { color: #15522B; text-decoration: underline; }

/* ── Tooltip ── */
.nba-tooltip {
  position: absolute; z-index: 9999; background: #fff;
  border: 1.5px solid #d4e8da; box-shadow: 0 4px 20px rgba(0,0,0,.15);
  padding: 12px; width: 230px; pointer-events: none;
  top: 0; left: calc(100% + 8px); display: none;
}
/* flip to left if near right edge */
.nba-tooltip.flip { left: auto; right: calc(100% + 8px); }
.nba-event-wrap:hover .nba-tooltip,
.nba-event-photo-wrap:hover .nba-tooltip { display: block; }
.nba-tt-title    { font-size: 12px; font-weight: 700; color: #15522B; margin-bottom: 4px; line-height: 1.3; }
.nba-tt-time     { font-size: 11px; font-weight: 600; color: #018F99; margin-bottom: 3px; }
.nba-tt-location { font-size: 11px; color: #555; margin-bottom: 5px; }
.nba-tt-desc     { font-size: 10.5px; color: #444; line-height: 1.4; border-top: 1px solid #e8f3ec; padding-top: 6px; margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.nba-tt-tag      { display: inline-block; background: #f0f7f2; color: #15522B; padding: 2px 7px; font-size: 9.5px; font-weight: 700; margin-top: 5px; margin-right: 3px; }
.nba-tt-tag.paid { background: #fff3e0; color: #c0540a; }

/* ── List view ── */
.nba-list { padding: 22px 24px; }
.nba-list-group { margin-bottom: 22px; }
.nba-list-date-header { font-size: 11px; font-weight: 700; color: #15522B; text-transform: uppercase; letter-spacing: .08em; padding: 7px 0; border-bottom: 2px solid #1BA249; margin-bottom: 10px; }
.nba-list-event { display: flex; gap: 14px; padding: 14px; border: 1.5px solid #e8f3ec; margin-bottom: 8px; cursor: pointer; transition: box-shadow .15s, border-color .15s; background: #fff; text-decoration: none; }
.nba-list-event:hover { box-shadow: 0 2px 10px rgba(21,82,43,.10); border-color: #1BA249; }
.nba-list-event.is-today-group { border-left: 3px solid #1BA249; }
.nba-list-event-img { width: 88px; height: 70px; object-fit: cover; flex-shrink: 0; }
.nba-list-event-body { flex: 1; min-width: 0; }
.nba-list-event-name { font-size: 13px; font-weight: 700; color: #15522B; margin-bottom: 3px; line-height: 1.3; }
.nba-list-event-time { font-size: 11px; font-weight: 600; color: #018F99; margin-bottom: 2px; }
.nba-list-event-loc  { font-size: 11px; color: #666; margin-bottom: 5px; }
.nba-list-event-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.nba-tag          { display: inline-block; padding: 2px 8px; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; }
.nba-tag-cat      { background: #f0f7f2; color: #15522B; }
.nba-tag-free     { background: #e8f7ee; color: #1BA249; }
.nba-tag-paid     { background: #fff3e0; color: #c0540a; }
.nba-list-empty   { padding: 32px 0; text-align: center; font-size: 13px; color: #888; }

/* ── Footer ── */
.nba-footer { background: #f0f7f2; border-top: 1px solid #d4e8da; padding: 8px 24px; display: flex; justify-content: flex-end; }
.nba-footer a { font-size: 10px; color: #15522B; text-decoration: none; font-weight: 600; opacity: .65; }
.nba-footer a:hover { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmt12(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    const hr   = h % 12 || 12;
    return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2,'0')}${ampm}`;
  }

  function fmtRange(startTime, endTime) {
    const s = fmt12(startTime);
    const e = fmt12(endTime);
    if (!s) return 'All Day';
    return e ? `${s}–${e}` : s;
  }

  function isoDate(year, month, day) {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function isToday(dateStr) {
    const t = new Date();
    return dateStr === isoDate(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function formatLongDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${DAYS_LONG[dt.getDay()]}, ${MONTHS[m-1]} ${d}`;
  }

  function getFilteredEvents() {
    const { search, categories, price } = state.filters;
    return state.events.filter(e => {
      if (search) {
        const q = search.toLowerCase();
        const hit = e.name.toLowerCase().includes(q)
          || (e.locationName || '').toLowerCase().includes(q)
          || (e.summary     || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (categories.length && e.category && !categories.includes(e.category)) return false;
      if (price.length === 1) {
        if (price[0] === 'free' && !e.isFree) return false;
        if (price[0] === 'paid' &&  e.isFree) return false;
      }
      return true;
    });
  }

  // ── Tooltip HTML ───────────────────────────────────────────────────────────
  function tooltipHTML(e, flip) {
    const priceTag = e.isFree
      ? '<span class="nba-tt-tag">Free</span>'
      : '<span class="nba-tt-tag paid">Paid</span>';
    const catTag = e.category
      ? `<span class="nba-tt-tag">${h(e.category)}</span>` : '';
    const loc = e.locationName
      ? `<div class="nba-tt-location">📍 ${h(e.locationName)}</div>` : '';
    const desc = e.summary
      ? `<div class="nba-tt-desc">${h(e.summary)}</div>` : '';
    return `
      <div class="nba-tooltip${flip ? ' flip' : ''}">
        <div class="nba-tt-title">${h(e.name)}</div>
        <div class="nba-tt-time">${fmtRange(e.startTime, e.endTime)}</div>
        ${loc}${desc}
        <div>${catTag}${priceTag}</div>
      </div>`;
  }

  // simple HTML escape
  function h(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Month calendar ─────────────────────────────────────────────────────────
  function buildMonthView() {
    const { year, month } = state;
    const filtered = getFilteredEvents();

    // Map events to their startDate for quick lookup
    const byDate = {};
    filtered.forEach(e => {
      if (!byDate[e.startDate]) byDate[e.startDate] = [];
      byDate[e.startDate].push(e);
    });

    // Multi-day (spanning) events
    const multiDay = filtered.filter(e => e.endDate && e.endDate !== e.startDate);

    // Calendar grid: find first Sunday on or before the 1st
    const firstOfMonth = new Date(year, month, 1);
    const startDOW     = firstOfMonth.getDay(); // 0=Sun
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    // Build grid cells (6 rows × 7 cols = 42)
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayOffset = i - startDOW;
      if (dayOffset < 0) {
        cells.push({ day: prevMonthDays + dayOffset + 1, current: false, dateStr: '' });
      } else if (dayOffset >= daysInMonth) {
        cells.push({ day: dayOffset - daysInMonth + 1, current: false, dateStr: '' });
      } else {
        const d = dayOffset + 1;
        cells.push({ day: d, current: true, dateStr: isoDate(year, month, d) });
      }
    }

    // ── Spanning event bar ─────────────────────────────────────────────────
    let spanRowHTML = '';
    if (multiDay.length) {
      const cols = Array(7).fill('');
      multiDay.forEach(e => {
        const sd = new Date(e.startDate + 'T00:00:00');
        const ed = new Date(e.endDate   + 'T00:00:00');
        const fm = new Date(year, month, 1);
        const lm = new Date(year, month + 1, 0);
        const visStart = sd < fm ? fm : sd;
        const visEnd   = ed > lm ? lm : ed;
        const startCol = (visStart.getDay() + (visStart.getDate() - 1)) % 7;
        const span = Math.round((visEnd - visStart) / 86400000) + 1;
        // Simplified: just show in first column of that day
        cols[startCol] += `<a href="${h(e.url)}" target="_blank" class="nba-span-event" title="${h(e.name)}" style="grid-column:span ${Math.min(span,7-startCol)}">${h(e.name)}</a>`;
      });
      spanRowHTML = `<div class="nba-span-row">${cols.map(c => `<div>${c}</div>`).join('')}</div>`;
    }

    // ── Cell HTML ──────────────────────────────────────────────────────────
    const MAX_VISIBLE = 3;
    const cellsHTML = cells.map((cell, idx) => {
      const todayClass = cell.current && isToday(cell.dateStr) ? ' is-today' : '';
      const otherClass = !cell.current ? ' other-month' : '';
      const col = idx % 7; // 0=Sun … 6=Sat

      if (!cell.current || !cell.dateStr) {
        return `<div class="nba-cal-cell${otherClass}"><div class="nba-day-num">${cell.day}</div></div>`;
      }

      const dayEvents = byDate[cell.dateStr] || [];
      const visible   = dayEvents.slice(0, MAX_VISIBLE);
      const overflow  = dayEvents.length - MAX_VISIBLE;

      const eventsHTML = visible.map(e => {
        const flip = col >= 5; // flip tooltip left for Fri/Sat
        const time = e.startTime ? fmtRange(e.startTime, e.endTime) : 'All Day';

        if (e.imageUrl) {
          return `
            <div class="nba-event-photo-wrap">
              <a href="${h(e.url)}" target="_blank" style="display:block;text-decoration:none;">
                <img class="nba-event-photo-img" src="${h(e.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.parentElement.querySelector('.nba-event-photo-info').style.borderTop='none';this.style.display='none'">
                <div class="nba-event-photo-info">
                  <span class="nba-event-photo-time">${h(time)}</span>
                  <span class="nba-event-photo-name">${h(e.name)}</span>
                </div>
              </a>
              ${tooltipHTML(e, flip)}
            </div>`;
        }

        return `
          <div class="nba-event-wrap">
            <a href="${h(e.url)}" target="_blank" class="nba-event-chip">
              <span class="nba-event-chip-time">${h(time)}</span>
              <span class="nba-event-chip-title">${h(e.name)}</span>
            </a>
            ${tooltipHTML(e, flip)}
          </div>`;
      }).join('');

      const moreHTML = overflow > 0
        ? `<button class="nba-more-link" data-date="${cell.dateStr}">+ ${overflow} More</button>`
        : '';

      return `
        <div class="nba-cal-cell${otherClass}${todayClass}">
          <div class="nba-day-num">${cell.day}</div>
          ${eventsHTML}
          ${moreHTML}
        </div>`;
    }).join('');

    return `
      <div class="nba-calendar">
        <div class="nba-cal-head">
          ${DAYS_SHORT.map(d => `<div class="nba-cal-dow">${d}</div>`).join('')}
        </div>
        ${spanRowHTML}
        <div class="nba-cal-body">${cellsHTML}</div>
      </div>`;
  }

  // ── List view ──────────────────────────────────────────────────────────────
  function buildListView() {
    const filtered = getFilteredEvents();

    if (!filtered.length) {
      return `<div class="nba-list"><div class="nba-list-empty">No events found for this month.</div></div>`;
    }

    // Group by startDate
    const groups = {};
    filtered.forEach(e => {
      if (!groups[e.startDate]) groups[e.startDate] = [];
      groups[e.startDate].push(e);
    });

    const todayStr = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

    const groupsHTML = Object.keys(groups).sort().map(date => {
      const label     = formatLongDate(date);
      const isTodayGrp = date === todayStr;
      const todayLabel = isTodayGrp ? ' — <span style="color:#1BA249">Today</span>' : '';

      const eventsHTML = groups[date].map(e => {
        const imgHTML = e.imageUrl
          ? `<img class="nba-list-event-img" src="${h(e.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : '';
        const catTag  = e.category  ? `<span class="nba-tag nba-tag-cat">${h(e.category)}</span>` : '';
        const priceTag = e.isFree
          ? `<span class="nba-tag nba-tag-free">Free</span>`
          : `<span class="nba-tag nba-tag-paid">Paid</span>`;
        const loc = e.locationName
          ? `<div class="nba-list-event-loc">📍 ${h(e.locationName)}</div>` : '';
        const time = e.startTime ? fmtRange(e.startTime, e.endTime) : 'All Day';

        return `
          <a href="${h(e.url)}" target="_blank" class="nba-list-event${isTodayGrp ? ' is-today-group' : ''}">
            ${imgHTML}
            <div class="nba-list-event-body">
              <div class="nba-list-event-name">${h(e.name)}</div>
              <div class="nba-list-event-time">${h(time)}</div>
              ${loc}
              <div class="nba-list-event-tags">${catTag}${priceTag}</div>
            </div>
          </a>`;
      }).join('');

      return `
        <div class="nba-list-group">
          <div class="nba-list-date-header">${label}${todayLabel}</div>
          ${eventsHTML}
        </div>`;
    }).join('');

    return `<div class="nba-list">${groupsHTML}</div>`;
  }

  // ── Filter bar ─────────────────────────────────────────────────────────────
  function buildFilters() {
    const { categories, filters } = state;

    const catChips = categories.map(cat => {
      const active = filters.categories.length === 0 || filters.categories.includes(cat);
      return `<button class="nba-filter-chip${active ? ' active' : ''}" data-filter="cat" data-value="${h(cat)}">${h(cat)}</button>`;
    }).join('');

    const freeActive = filters.price.length === 0 || filters.price.includes('free');
    const paidActive = filters.price.length === 0 || filters.price.includes('paid');

    return `
      <div class="nba-filters">
        <div class="nba-search-wrap">
          <span class="nba-search-icon">🔍</span>
          <input class="nba-search" type="text" placeholder="Search events…" value="${h(filters.search)}" id="nba-search-input">
        </div>
        ${categories.length ? `
          <div class="nba-filter-divider"></div>
          <span class="nba-filter-label">Category</span>
          <div class="nba-filter-group">${catChips}</div>` : ''}
        <div class="nba-filter-divider"></div>
        <span class="nba-filter-label">Price</span>
        <div class="nba-filter-group">
          <button class="nba-filter-chip${freeActive ? ' active' : ''}" data-filter="price" data-value="free">Free</button>
          <button class="nba-filter-chip${paidActive ? ' active' : ''}" data-filter="price" data-value="paid">Paid</button>
        </div>
      </div>`;
  }

  // ── Main render ────────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('nba-calendar');
    if (!container) return;

    const { year, month, view, loading, error } = state;

    let bodyHTML;
    if (loading) {
      bodyHTML = `<div class="nba-status"><div class="nba-spinner"></div><br>Loading events…</div>`;
    } else if (error) {
      bodyHTML = `<div class="nba-status error">⚠️ Could not load events: ${h(error)}</div>`;
    } else {
      bodyHTML = view === 'month' ? buildMonthView() : buildListView();
    }

    container.innerHTML = `
      <div class="nba-header">
        <div>
          <div class="nba-title">NYC Bird Alliance</div>
          <div class="nba-subtitle">Events &amp; Programs</div>
        </div>
        <div class="nba-header-right">
          <button class="nba-btn nba-btn-today" id="nba-today-btn">Today</button>
          <button class="nba-btn nba-btn-nav" id="nba-prev-btn">&#8249;</button>
          <span class="nba-month-label">${MONTHS[month]} ${year}</span>
          <button class="nba-btn nba-btn-nav" id="nba-next-btn">&#8250;</button>
          <div class="nba-view-toggle">
            <button class="nba-view-btn${view === 'month' ? ' active' : ''}" data-view="month">Month</button>
            <button class="nba-view-btn${view === 'list'  ? ' active' : ''}" data-view="list">List</button>
          </div>
        </div>
      </div>
      ${buildFilters()}
      ${bodyHTML}
      <div class="nba-footer"><a href="https://nycbirdalliance.org" target="_blank">nycbirdalliance.org</a></div>
    `;

    attachListeners();
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  function attachListeners() {
    const container = document.getElementById('nba-calendar');
    if (!container) return;

    // Today
    container.querySelector('#nba-today-btn')?.addEventListener('click', () => {
      const t = new Date();
      if (state.year !== t.getFullYear() || state.month !== t.getMonth()) {
        state.year  = t.getFullYear();
        state.month = t.getMonth();
        loadMonth();
      }
    });

    // Prev / Next
    container.querySelector('#nba-prev-btn')?.addEventListener('click', () => {
      if (state.month === 0) { state.month = 11; state.year--; }
      else state.month--;
      loadMonth();
    });

    container.querySelector('#nba-next-btn')?.addEventListener('click', () => {
      if (state.month === 11) { state.month = 0; state.year++; }
      else state.month++;
      loadMonth();
    });

    // View toggle
    container.querySelectorAll('.nba-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = btn.dataset.view;
        render();
      });
    });

    // Filter chips
    container.querySelectorAll('.nba-filter-chip[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const { filter, value } = btn.dataset;
        if (filter === 'cat') {
          const idx = state.filters.categories.indexOf(value);
          if (idx === -1) state.filters.categories.push(value);
          else            state.filters.categories.splice(idx, 1);
        } else if (filter === 'price') {
          const idx = state.filters.price.indexOf(value);
          if (idx === -1) state.filters.price.push(value);
          else            state.filters.price.splice(idx, 1);
        }
        render();
      });
    });

    // Search (debounced)
    const searchInput = container.querySelector('#nba-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        clearTimeout(state._searchTimer);
        state._searchTimer = setTimeout(() => {
          state.filters.search = e.target.value;
          render();
          // Restore focus & cursor position
          const el = document.getElementById('nba-search-input');
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }, 280);
      });
    }

    // "+ X More" buttons → switch to list view filtered to that date
    container.querySelectorAll('.nba-more-link[data-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.view = 'list';
        state.filters.search = btn.dataset.date; // quick filter by date
        render();
        // Clear after render
        setTimeout(() => {
          state.filters.search = '';
          const el = document.getElementById('nba-search-input');
          if (el) el.value = '';
        }, 0);
      });
    });
  }

  // ── Data loading ───────────────────────────────────────────────────────────
  async function loadMonth() {
    const { year, month } = state;
    const cacheKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Use cached data if available
    if (state._cache[cacheKey]) {
      state.events     = state._cache[cacheKey];
      state.categories = extractCategories(state.events);
      render();
      return;
    }

    state.loading = true;
    state.error   = null;
    render();

    const lastDay   = new Date(year, month + 1, 0).getDate();
    const startDate = `${cacheKey}-01`;
    const endDate   = `${cacheKey}-${lastDay}`;

    try {
      const res = await fetch(`${BASE_URL}/api/events?startDate=${startDate}&endDate=${endDate}&pageSize=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Handle possible Neon API pagination (fetch all pages)
      let events = data.events || [];
      const total = data.pagination?.totalResults ?? events.length;
      const size  = data.pagination?.pageSize      ?? 200;
      const pages = Math.ceil(total / size);

      if (pages > 1) {
        const extras = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            fetch(`${BASE_URL}/api/events?startDate=${startDate}&endDate=${endDate}&pageSize=${size}&page=${i + 2}`)
              .then(r => r.json()).then(d => d.events || [])
          )
        );
        events = events.concat(...extras);
      }

      state._cache[cacheKey] = events;
      state.events     = events;
      state.categories = extractCategories(events);
      state.error      = null;

    } catch (err) {
      state.error  = err.message;
      state.events = [];
    } finally {
      state.loading = false;
      render();
    }
  }

  function extractCategories(events) {
    return [...new Set(events.map(e => e.category).filter(Boolean))].sort();
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();

    // Find or create the mount point
    let container = document.getElementById('nba-calendar');
    if (!container) {
      container = document.createElement('div');
      container.id = 'nba-calendar';
      document.body.appendChild(container);
    }

    loadMonth();
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
