/**
 * NYC Bird Alliance – NeonCRM Event Calendar Widget
 * Embed: <script src="https://neon-calendar-widget.vercel.app/widget.js"></script>
 * Place  <div id="nba-calendar"></div> where you want the calendar.
 */
(function () {
  'use strict';

  // ── Derive base URL from the script tag so API calls always hit the same
  //    Vercel deployment, no matter which site embeds the widget. ─────────────
  const BASE_URL = (function () {
    const s = document.currentScript;
    if (s && s.src) return s.src.replace(/\/widget\.js.*$/, '');
    const tags = document.querySelectorAll('script[src*="widget.js"]');
    if (tags.length) return tags[tags.length - 1].src.replace(/\/widget\.js.*$/, '');
    return '';
  })();

  // ── Constants ───────────────────────────────────────────────────────────────
  const MONTHS     = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const DAYS_LONG  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MAX_PER_CELL = 3;

  // ── Borough filter order ─────────────────────────────────────────────────
  const BOROUGH_ORDER = ['Manhattan', 'Brooklyn', 'Bronx', 'Queens', 'Staten Island'];

  // ── Category configuration ───────────────────────────────────────────────
  // Maps the filter chip labels shown in the UI to the exact category names
  // stored in NeonCRM. Events whose category doesn't appear in any of these
  // arrays are hidden from the widget entirely.
  const CATEGORY_CONFIG = [
    { label: 'Festivals',                neonCats: ['Festivals'] },
    { label: 'Outings & Classes',        neonCats: ['Free and Partner Walks', 'Local Trips'] },
    { label: 'Member Events',            neonCats: ['In-person Members-only Events'] },
    { label: 'Lectures',                 neonCats: ['Lectures'] },
    { label: 'Volunteer Opportunities',  neonCats: ['Virtual Community Science Orientations'] },
  ];

  // Flat set of every Neon category name that is allowed to appear
  const ALLOWED_CATS = new Set(CATEGORY_CONFIG.flatMap(c => c.neonCats));

  // ── State ───────────────────────────────────────────────────────────────────
  const now = new Date();
  const state = {
    view:    'month',
    year:    now.getFullYear(),
    month:   now.getMonth(),
    events:  [],
    loading: false,
    error:   null,
    // filters.categories holds active chip *labels* from CATEGORY_CONFIG
    // filters.boroughs holds active borough names (multi-select; empty = all)
    filters: { categories: [], boroughs: [], search: '' },
    _autoList: false,
    _cache:  {},
    _searchTimer: null,
  };

  // ── CSS injection ────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('nba-widget-css')) return;

    const link  = document.createElement('link');
    link.rel    = 'stylesheet';
    link.href   = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);

    const style = document.createElement('style');
    style.id    = 'nba-widget-css';
    style.textContent = `
/* ── Scoped reset ─────────────────────────────────────────────────────────── */
#nba-calendar, #nba-calendar * { box-sizing: border-box !important; line-height: 1 !important; }
#nba-calendar a, #nba-calendar button { font-family: 'Montserrat', sans-serif !important; }

#nba-calendar {
  font-family: 'Montserrat', sans-serif;
  background: #fff;
  box-shadow: 0 2px 16px rgba(0,0,0,.12);
  width: 100%;
  overflow: hidden;
  display: flex !important; flex-direction: column !important; gap: 0 !important;
}
#nba-calendar > * { margin-top: 0 !important; margin-bottom: 0 !important; }

/* ── Header ─────────────────────────────────────────────────────────────── */
#nba-calendar .nba-header {
  background: #15522B; color: #fff;
  padding: 10px 24px !important;
  display: flex !important; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  margin: 0 !important;
}
#nba-calendar .nba-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── Header buttons ─────────────────────────────────────────────────────── */
#nba-calendar .nba-btn {
  border: none; padding: 7px 14px !important; font-family: 'Montserrat', sans-serif !important;
  font-size: 12px; font-weight: 600; cursor: pointer; letter-spacing: .04em;
  transition: background .15s; line-height: 1 !important; margin: 0 !important;
}
#nba-calendar .nba-btn-today  { background: #1BA249; color: #fff; }
#nba-calendar .nba-btn-today:hover { background: #57B94C; }
#nba-calendar .nba-btn-nav    { background: rgba(255,255,255,.18); color: #fff; padding: 7px 12px !important; font-size: 16px; }
#nba-calendar .nba-btn-nav:hover { background: rgba(255,255,255,.32); }
#nba-calendar .nba-month-label { font-size: 15px; font-weight: 700; color: #fff; min-width: 170px; text-align: center; margin: 0 !important; padding: 0 !important; }
#nba-calendar .nba-view-toggle { display: flex; border: 1.5px solid rgba(255,255,255,.4); overflow: hidden; margin-left: 6px !important; }
#nba-calendar .nba-view-btn {
  background: transparent; color: rgba(255,255,255,.65); border: none;
  padding: 6px 14px !important; font-family: 'Montserrat', sans-serif !important; font-size: 11px; font-weight: 600;
  cursor: pointer; letter-spacing: .05em; transition: all .15s; margin: 0 !important;
}
#nba-calendar .nba-view-btn.active { background: #1BA249; color: #fff; }
#nba-calendar .nba-view-btn + .nba-view-btn { border-left: 1.5px solid rgba(255,255,255,.4); }

/* ── Filters bar ─────────────────────────────────────────────────────────── */
#nba-calendar .nba-filters {
  background: #f0f7f2; border-bottom: 1px solid #d4e8da;
  padding: 7px 16px !important; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 !important;
}
#nba-calendar .nba-search-wrap  { position: relative; display: flex; align-items: center; flex-shrink: 0; }
#nba-calendar .nba-search-icon  {
  position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  color: #888; font-size: 12px; pointer-events: none; line-height: 1;
  font-style: normal;
}
#nba-calendar .nba-search {
  background: #fff; border: 1.5px solid #c0d8c9; color: #222;
  font-family: 'Montserrat', sans-serif !important; font-size: 12px;
  padding: 7px 28px 7px 32px !important; width: 210px; outline: none; transition: border-color .15s;
  -webkit-appearance: none; margin: 0 !important; line-height: 1 !important;
}
#nba-calendar .nba-search::placeholder { color: #aaa; }
#nba-calendar .nba-search:focus { border-color: #1BA249; }
#nba-calendar .nba-search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; color: #999; font-size: 15px;
  padding: 0 !important; line-height: 1; display: none; font-family: sans-serif;
}
#nba-calendar .nba-search-clear.visible { display: block; }
#nba-calendar .nba-search-clear:hover { color: #333; }
#nba-calendar .nba-filter-label {
  font-size: 10px; font-weight: 700; color: #15522B;
  text-transform: uppercase; letter-spacing: .07em; white-space: nowrap;
}
#nba-calendar .nba-filter-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
#nba-calendar .nba-filter-chip {
  display: inline-flex; align-items: center; background: #fff; border: 1.5px solid #c0d8c9;
  padding: 5px 13px !important; font-size: 11px; font-weight: 600; color: #15522B; cursor: pointer;
  transition: all .15s; white-space: nowrap; user-select: none; margin: 0 !important;
  font-family: 'Montserrat', sans-serif !important; line-height: 1 !important;
}
#nba-calendar .nba-filter-chip.active  { background: #15522B; border-color: #15522B; color: #fff; }
#nba-calendar .nba-filter-chip:hover:not(.active) { border-color: #1BA249; color: #1BA249; }
#nba-calendar .nba-filter-divider { width: 1px; height: 22px; background: #c0d8c9; flex-shrink: 0; }

/* ── Loading / Error ─────────────────────────────────────────────────────── */
#nba-calendar .nba-status { padding: 48px 24px; text-align: center; font-size: 13px; color: #777; }
#nba-calendar .nba-status.error { color: #b00; }
#nba-calendar .nba-spinner {
  display: inline-block; width: 24px; height: 24px;
  border: 3px solid #d4e8da; border-top-color: #1BA249;
  border-radius: 50%; animation: nba-spin .75s linear infinite; margin-bottom: 10px;
}
@keyframes nba-spin { to { transform: rotate(360deg); } }

/* ── Calendar grid ───────────────────────────────────────────────────────── */
#nba-calendar .nba-calendar { overflow-x: auto; }
#nba-calendar .nba-cal-head {
  display: grid; grid-template-columns: repeat(7, minmax(0,1fr));
  background: #15522B; min-width: 560px;
}
#nba-calendar .nba-cal-dow {
  padding: 10px 0 !important; text-align: center; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .07em; color: rgba(255,255,255,.85); margin: 0 !important; line-height: 1 !important;
}
#nba-calendar .nba-cal-body {
  display: grid; grid-template-columns: repeat(7, minmax(0,1fr));
  border-left: 1px solid #e0e0e0; border-top: 1px solid #e0e0e0; min-width: 560px;
}

/* ── Individual cell ─────────────────────────────────────────────────────── */
#nba-calendar .nba-cal-cell {
  border-right: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0;
  min-height: 100px; padding: 7px !important; background: #fff; overflow: visible;
  display: grid !important; grid-template-columns: 1fr !important;
  align-content: start !important; row-gap: 3px !important;
  vertical-align: top; margin: 0 !important;
}
#nba-calendar .nba-cal-cell.other-month { background: #fafafa; }
#nba-calendar .nba-day-num {
  font-size: 12px; font-weight: 700; color: #15522B; margin-bottom: 4px !important; margin-top: 0 !important;
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0 !important; line-height: 1 !important;
}
#nba-calendar .nba-cal-cell.other-month .nba-day-num { color: #ccc; }
#nba-calendar .nba-cal-cell.is-today                 { background: rgba(27,162,73,.10) !important; }
#nba-calendar .nba-cal-cell.is-today .nba-day-num    { background: rgba(27,162,73,.22); color: #15522B; }

/* ── Event chip (no photo) ───────────────────────────────────────────────── */
#nba-calendar .nba-chips-stack { display: grid !important; grid-template-columns: 1fr !important; row-gap: 3px !important; align-content: start !important; align-items: start !important; margin: 0 !important; padding: 0 !important; }
#nba-calendar .nba-event-chip {
  display: flex !important; flex-direction: column !important; gap: 2px !important;
  position: relative !important; height: auto !important;
  background: #1BA249; color: #fff !important;
  cursor: pointer; padding: 5px 7px 6px !important; transition: background .15s; text-decoration: none !important; margin: 0 !important;
}
#nba-calendar .nba-event-chip:hover { background: #15522B; }
#nba-calendar .nba-chip-time  {
  display: block !important; font-size: 10px !important; font-weight: 700 !important; opacity: .88;
  letter-spacing: .02em; line-height: 1.2 !important; margin: 0 !important; color: #fff !important; padding: 0 !important;
  white-space: nowrap !important; overflow: hidden !important;
}
#nba-calendar .nba-chip-title {
  display: block !important; font-size: 11px !important; font-weight: 600 !important; line-height: 1.3 !important; color: #fff !important;
  overflow: hidden !important; max-height: calc(1.3em * 4) !important; padding: 0 !important; margin: 0 !important;
}
/* ── Photo event card ────────────────────────────────────────────────────── */
#nba-calendar .nba-photo-wrap {
  position: relative; margin-bottom: 3px !important; margin-top: 0 !important;
  border: 1.5px solid #d4e8da; cursor: pointer;
  transition: box-shadow .15s, border-color .15s; overflow: hidden;
}
#nba-calendar .nba-photo-wrap:hover { box-shadow: 0 2px 8px rgba(21,82,43,.20); border-color: #1BA249; }
#nba-calendar .nba-photo-wrap a { display: block; text-decoration: none !important; margin: 0 !important; padding: 0 !important; }
#nba-calendar .nba-photo-img  { width: 100%; height: 52px; object-fit: cover; display: block; margin: 0 !important; padding: 0 !important; }
#nba-calendar .nba-photo-info { padding: 5px 7px 6px !important; background: #fff; margin: 0 !important; }
#nba-calendar .nba-photo-time { display: block !important; font-size: 9px !important; font-weight: 700 !important; color: #15522B !important; line-height: 1.2 !important; margin-bottom: 2px !important; margin-top: 0 !important; padding: 0 !important; }
#nba-calendar .nba-photo-name {
  display: block !important; font-size: 10px !important; font-weight: 600 !important; color: #222 !important; line-height: 1.3 !important;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: 0 !important; margin: 0 !important;
}
/* ── "+ N more" button ───────────────────────────────────────────────────── */
#nba-calendar .nba-more-btn {
  display: block; font-size: 10px; font-weight: 600; color: #018F99; cursor: pointer;
  margin-top: 3px !important; margin-bottom: 0 !important; background: none; border: none; padding: 0 !important;
  font-family: 'Montserrat', sans-serif !important; text-align: left; line-height: 1.3 !important;
}
#nba-calendar .nba-more-btn:hover { color: #15522B; text-decoration: underline; }

/* ── Tooltip ─────────────────────────────────────────────────────────────── */
#nba-calendar .nba-tooltip {
  position: absolute; z-index: 99999; background: #fff;
  border: 1.5px solid #d4e8da; box-shadow: 0 4px 20px rgba(0,0,0,.18);
  padding: 8px !important; width: 230px; pointer-events: none;
  top: 0; left: calc(100% + 8px); display: none; margin: 0 !important;
}
#nba-calendar .nba-tooltip.flip { left: auto; right: calc(100% + 8px); }
#nba-calendar .nba-event-chip:hover  .nba-tooltip,
#nba-calendar .nba-photo-wrap:hover  .nba-tooltip,
#nba-calendar .nba-list-event:hover  .nba-tooltip { display: block; }
/* List-view tooltip drops below the row instead of floating to the side */
#nba-calendar .nba-list-event .nba-tooltip { top: 100% !important; left: 0 !important; right: auto !important; width: 280px; }
#nba-calendar .nba-tt-title    { font-size: 12px; font-weight: 700; color: #15522B; margin-bottom: 2px !important; margin-top: 0 !important; line-height: 1.3 !important; padding: 0 !important; }
#nba-calendar .nba-tt-time     { font-size: 11px; font-weight: 600; color: #018F99; margin-bottom: 0 !important; margin-top: 0 !important; padding: 0 !important; line-height: 1.2 !important; }
#nba-calendar .nba-tt-location { font-size: 11px; color: #555; margin-bottom: 4px !important; margin-top: 0 !important; padding: 0 !important; line-height: 1.2 !important; }
#nba-calendar .nba-tt-desc     {
  font-size: 10.5px; color: #444; line-height: 1.4 !important;
  border-top: 1px solid #e8f3ec; padding-top: 4px !important; padding-bottom: 0 !important; padding-left: 0 !important; padding-right: 0 !important; margin-top: 4px !important; margin-bottom: 0 !important;
  overflow: hidden;
}
#nba-calendar .nba-tt-tag      { display: inline-block; background: #f0f7f2; color: #15522B; padding: 2px 7px !important; font-size: 9.5px; font-weight: 700; margin-top: 4px !important; margin-right: 3px !important; margin-bottom: 0 !important; margin-left: 0 !important; line-height: 1 !important; }
#nba-calendar .nba-tt-tag.paid { background: #fff3e0; color: #c0540a; }

/* ── List view ───────────────────────────────────────────────────────────── */
#nba-calendar .nba-list       { padding: 22px 24px !important; margin: 0 !important; }
#nba-calendar .nba-list-group { margin-bottom: 22px !important; margin-top: 0 !important; padding: 0 !important; }
#nba-calendar .nba-list-date-hdr {
  font-size: 11px; font-weight: 700; color: #15522B;
  text-transform: uppercase; letter-spacing: .08em; line-height: 1.2 !important;
  padding: 7px 0 !important; border-bottom: 2px solid #1BA249; margin-bottom: 10px !important; margin-top: 0 !important;
}
#nba-calendar .nba-list-event {
  display: flex; gap: 14px; padding: 14px !important; border: 1.5px solid #e8f3ec;
  margin-bottom: 8px !important; margin-top: 0 !important; cursor: pointer; transition: box-shadow .15s, border-color .15s;
  background: #fff; text-decoration: none !important; position: relative !important;
}
#nba-calendar .nba-list-event:hover { box-shadow: 0 2px 10px rgba(21,82,43,.10); border-color: #1BA249; }
#nba-calendar .nba-list-event.today-grp { border-left: 3px solid #1BA249; }
#nba-calendar .nba-list-img  { width: 88px; height: 70px; object-fit: cover; flex-shrink: 0; }
#nba-calendar .nba-list-body { flex: 1; min-width: 0; margin: 0 !important; padding: 0 !important; display: grid !important; row-gap: 3px !important; align-content: start !important; }
#nba-calendar .nba-list-name { font-size: 14px !important; font-weight: 700 !important; color: #15522B !important; margin: 0 !important; line-height: 1.3 !important; padding: 0 !important; }
#nba-calendar .nba-list-time { font-size: 12px !important; font-weight: 600 !important; color: #018F99 !important; margin: 0 !important; line-height: 1.2 !important; padding: 0 !important; }
#nba-calendar .nba-list-tags { display: flex; gap: 4px; flex-wrap: wrap; }
#nba-calendar .nba-tag       { display: inline-block; padding: 2px 8px !important; font-size: 9.5px; font-weight: 700; margin: 0 !important; line-height: 1 !important; }
#nba-calendar .nba-tag-cat   { background: #f0f7f2; color: #15522B; }
#nba-calendar .nba-list-empty { padding: 40px 0 !important; text-align: center; font-size: 13px; color: #999; margin: 0 !important; }

/* ── List-view bottom nav ─────────────────────────────────────────────── */
#nba-calendar .nba-list-nav {
  display: flex !important; align-items: center; justify-content: space-between;
  border-top: 1px solid #d4e8da; padding: 10px 0 0 !important; margin-top: 8px !important;
}
#nba-calendar .nba-list-nav-label {
  font-size: 13px; font-weight: 700; color: #15522B; margin: 0 !important; padding: 0 !important; line-height: 1 !important;
}
#nba-calendar .nba-list-nav-btn {
  background: #15522B; color: #fff; border: none;
  padding: 7px 16px !important; font-family: 'Montserrat', sans-serif !important;
  font-size: 12px; font-weight: 600; cursor: pointer; letter-spacing: .04em;
  transition: background .15s; line-height: 1 !important; margin: 0 !important;
  display: flex; align-items: center; gap: 6px;
}
#nba-calendar .nba-list-nav-btn:hover { background: #1BA249; }


/* ── High-specificity overrides (beat host CSS via :not(#nba-x) trick) ───── */
/* Selectors here have specificity (2,0,0)+(class) = (2,1,0), higher than   */
/* virtually any host selector, even with !important from same specificity.  */
#nba-calendar:not(#nba-x) { display: flex !important; flex-direction: column !important; gap: 0 !important; }
#nba-calendar:not(#nba-x) > * { margin-top: 0 !important; margin-bottom: 0 !important; }
#nba-calendar:not(#nba-x) * { line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-header { padding: 8px 16px !important; margin: 0 !important; }
#nba-calendar:not(#nba-x) .nba-header-right { margin: 0 !important; padding: 0 !important; }
#nba-calendar:not(#nba-x) .nba-btn { padding: 7px 14px !important; margin: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-btn-nav { padding: 7px 12px !important; }
#nba-calendar:not(#nba-x) .nba-month-label { margin: 0 !important; padding: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-view-toggle { margin-left: 6px !important; }
#nba-calendar:not(#nba-x) .nba-view-btn { padding: 6px 14px !important; margin: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-filters { padding: 7px 16px !important; margin: 0 !important; }
#nba-calendar:not(#nba-x) .nba-filter-chip { padding: 5px 13px !important; margin: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-cal-cell { display: grid !important; grid-template-columns: 1fr !important; align-content: start !important; row-gap: 3px !important; padding: 7px !important; margin: 0 !important; min-height: 100px !important; }
#nba-calendar:not(#nba-x) .nba-cal-body { display: grid !important; }
#nba-calendar:not(#nba-x) .nba-cal-head { display: grid !important; }
#nba-calendar:not(#nba-x) .nba-cal-dow { display: block !important; padding: 10px 0 !important; margin: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-day-num { margin-bottom: 4px !important; margin-top: 0 !important; padding: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-event-chip { display: flex !important; flex-direction: column !important; gap: 2px !important; padding: 5px 7px 6px !important; margin: 0 !important; position: relative !important; height: auto !important; }
#nba-calendar:not(#nba-x) .nba-chip-time { font-size: 10px !important; line-height: 1.2 !important; margin: 0 !important; padding: 0 !important; display: block !important; white-space: nowrap !important; overflow: hidden !important; }
#nba-calendar:not(#nba-x) .nba-chip-title { font-size: 11px !important; line-height: 1.3 !important; margin: 0 !important; padding: 0 !important; display: block !important; overflow: hidden !important; max-height: calc(1.3em * 4) !important; }
#nba-calendar:not(#nba-x) .nba-photo-wrap { margin-bottom: 3px !important; margin-top: 0 !important; }
#nba-calendar:not(#nba-x) .nba-photo-info { padding: 5px 7px 6px !important; margin: 0 !important; }
#nba-calendar:not(#nba-x) .nba-photo-time { line-height: 1.2 !important; margin: 0 0 2px 0 !important; padding: 0 !important; }
#nba-calendar:not(#nba-x) .nba-photo-name { line-height: 1.3 !important; margin: 0 !important; padding: 0 !important; }
#nba-calendar:not(#nba-x) .nba-list-event { position: relative !important; }
#nba-calendar:not(#nba-x) .nba-list { display: block !important; padding: 16px 24px !important; margin: 0 !important; }
#nba-calendar:not(#nba-x) .nba-list-group { display: block !important; margin-bottom: 12px !important; margin-top: 0 !important; padding: 0 !important; }
#nba-calendar:not(#nba-x) .nba-list-date-hdr { display: block !important; padding: 5px 0 !important; margin-bottom: 6px !important; margin-top: 0 !important; line-height: 1.2 !important; }
#nba-calendar:not(#nba-x) .nba-list-event { display: flex !important; padding: 12px !important; margin: 0 0 6px 0 !important; }
#nba-calendar:not(#nba-x) .nba-list-body { margin: 0 !important; padding: 0 !important; display: grid !important; row-gap: 3px !important; align-content: start !important; }
#nba-calendar:not(#nba-x) .nba-list-name { font-size: 14px !important; line-height: 1.3 !important; margin: 0 !important; padding: 0 !important; display: block !important; }
#nba-calendar:not(#nba-x) .nba-list-time { font-size: 12px !important; line-height: 1.2 !important; margin: 0 !important; padding: 0 !important; display: block !important; }
#nba-calendar:not(#nba-x) .nba-tag { padding: 2px 8px !important; margin: 0 !important; line-height: 1 !important; }
#nba-calendar:not(#nba-x) .nba-list-tags { margin: 0 !important; padding: 0 !important; }
    `;
    document.head.appendChild(style);
  }

  // ── Utility helpers ──────────────────────────────────────────────────────────
  function h(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt12(t) {
    if (!t) return '';
    const [hh, mm] = t.split(':').map(Number);
    const ampm = hh >= 12 ? 'pm' : 'am';
    const hr   = hh % 12 || 12;
    return mm === 0 ? `${hr}${ampm}` : `${hr}:${String(mm).padStart(2,'0')}${ampm}`;
  }

  function fmtRange(s, e) {
    const sf = fmt12(s);
    if (!sf) return 'All Day';
    const ef = fmt12(e);
    return ef ? `${sf}–${ef}` : sf;
  }

  function isoDate(y, m, d) {
    return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  function todayISO() {
    const t = new Date();
    return isoDate(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function fmtLongDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m-1, d);
    return `${DAYS_LONG[dt.getDay()]}, ${MONTHS[m-1]} ${d}`;
  }

  // "April 23" — used in tooltip time row
  function fmtShortDate(dateStr) {
    if (!dateStr) return '';
    const [, m, d] = dateStr.split('-').map(Number);
    return `${MONTHS[m-1]} ${d}`;
  }

  // ── Filtering ────────────────────────────────────────────────────────────────
  function getFiltered() {
    const { search, categories, boroughs } = state.filters;

    // Build the set of allowed Neon category names based on active chip labels.
    // If no chips are selected, all ALLOWED_CATS are shown.
    let activeCats;
    if (categories.length === 0) {
      activeCats = ALLOWED_CATS;
    } else {
      activeCats = new Set(
        CATEGORY_CONFIG
          .filter(c => categories.includes(c.label))
          .flatMap(c => c.neonCats)
      );
    }

    return state.events.filter(e => {
      // 1. Only show events from approved categories (uncategorized always pass through)
      if (e.category && !ALLOWED_CATS.has(e.category)) return false;

      // 2. Apply active category-chip filter.
      // When chips are selected, uncategorized events are also hidden.
      // When no chips are selected, uncategorized events pass through.
      if (categories.length > 0) {
        if (!e.category || !activeCats.has(e.category)) return false;
      }

      // 3. Borough filter — when any boroughs are selected:
      //    - Events with no borough (e.borough === '') are hidden
      //    - Events whose borough is not in the selection are hidden
      if (boroughs.length > 0) {
        if (!e.borough || !boroughs.includes(e.borough)) return false;
      }

      // 4. Search
      if (search) {
        const q = search.toLowerCase();
        if (!(e.name || '').toLowerCase().includes(q) &&
            !(e.locationName || '').toLowerCase().includes(q) &&
            !(e.summary || '').toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }

  // ── Tooltip HTML ─────────────────────────────────────────────────────────────
  function ttHTML(e, flip) {
    const photo = e.imageUrl
      ? `<img src="${h(e.imageUrl)}" alt="" style="width:100%;height:90px;object-fit:cover;display:block!important;margin:0 0 6px 0!important;padding:0!important">`
      : '';
    const timeRange  = fmtRange(e.startTime, e.endTime);
    const dateLabel  = fmtShortDate(e.startDate);
    const timeStr    = dateLabel && timeRange !== 'All Day'
      ? `${dateLabel}, ${timeRange}`
      : dateLabel || timeRange;
    const shortDesc = e.summary
      ? (e.summary.length > 450 ? e.summary.substring(0, 450) + '…' : e.summary)
      : '';
    const desc  = shortDesc ? `<div class="nba-tt-desc">${h(shortDesc)}</div>` : '';
    const cat   = e.category  ? `<span class="nba-tt-tag">${h(e.category)}</span>` : '';
    return `<div class="nba-tooltip${flip?' flip':''}">
      ${photo}
      <div class="nba-tt-title">${h(e.name)}</div>
      <div class="nba-tt-time">${h(timeStr)}</div>
      ${desc}${cat ? `<div>${cat}</div>` : ''}
    </div>`;
  }

  // ── Month view builder ───────────────────────────────────────────────────────
  function buildMonth() {
    const { year, month } = state;
    const filtered   = getFiltered();

    // Index by startDate
    const byDate = {};
    filtered.forEach(e => {
      (byDate[e.startDate] = byDate[e.startDate] || []).push(e);
    });

    // Sort each day's events by start time
    Object.values(byDate).forEach(arr =>
      arr.sort((a,b) => (a.startTime||'').localeCompare(b.startTime||''))
    );

    const firstDOW   = new Date(year, month, 1).getDay();
    const daysInMo   = new Date(year, month+1, 0).getDate();
    const prevDays   = new Date(year, month, 0).getDate();
    const today      = todayISO();

    // 6 rows × 7 cols = 42 cells
    const cells = Array.from({ length: 42 }, (_, i) => {
      const offset = i - firstDOW;
      if (offset < 0)          return { day: prevDays + offset + 1, current: false, dateStr: null };
      if (offset >= daysInMo)  return { day: offset - daysInMo + 1, current: false, dateStr: null };
      const d = offset + 1;
      return { day: d, current: true, dateStr: isoDate(year, month, d) };
    });

    const cellsHTML = cells.map((cell, idx) => {
      const col = idx % 7;
      if (!cell.current) {
        return `<div class="nba-cal-cell other-month"><div class="nba-day-num">${cell.day}</div></div>`;
      }

      const todayCls = cell.dateStr === today ? ' is-today' : '';
      const dayEvts  = byDate[cell.dateStr] || [];
      const visible  = dayEvts.slice(0, MAX_PER_CELL);
      const overflow = dayEvts.length - MAX_PER_CELL;
      const flip     = col >= 5;

      const eventsHTML = visible.map(e => {
        const timeStr = e.startTime ? fmtRange(e.startTime, e.endTime) : 'All Day';

        if (e.imageUrl) {
          return `
            <div class="nba-photo-wrap">
              <a href="${h(e.url)}" target="_blank" rel="noopener">
                <img class="nba-photo-img" src="${h(e.imageUrl)}" alt="" loading="lazy"
                     onerror="this.style.display='none'">
                <div class="nba-photo-info">
                  <span class="nba-photo-time">${h(timeStr)}</span>
                  <span class="nba-photo-name">${h(e.name)}</span>
                </div>
              </a>
              ${ttHTML(e, flip)}
            </div>`;
        }

        return `
          <a href="${h(e.url)}" target="_blank" rel="noopener" class="nba-event-chip" style="display:flex!important;flex-direction:column!important;gap:2px!important;padding:5px 7px 6px!important;margin:0!important;position:relative!important;height:auto!important">
            <span class="nba-chip-time" style="display:block!important;margin:0!important;padding:0!important;line-height:1.2!important;font-size:10px!important;white-space:nowrap!important;overflow:hidden!important">${h(timeStr)}</span>
            <span class="nba-chip-title" style="display:block!important;margin:0!important;padding:0!important;line-height:1.3!important;font-size:11px!important;max-height:calc(1.3em * 4)!important;overflow:hidden!important">${h(e.name)}</span>
            ${ttHTML(e, flip)}
          </a>`;
      }).join('');

      const moreHTML = overflow > 0
        ? `<button class="nba-more-btn" data-date="${cell.dateStr}">+ ${overflow} more</button>`
        : '';

      return `
        <div class="nba-cal-cell${todayCls}" style="padding:7px!important">
          <div class="nba-day-num" style="margin:0 0 4px 0!important;padding:0!important;line-height:1!important">${cell.day}</div>
          <div class="nba-chips-stack" style="display:grid!important;grid-template-columns:1fr!important;row-gap:3px!important;align-content:start!important;margin:0!important;padding:0!important">${eventsHTML}${moreHTML}</div>
        </div>`;
    }).join('');

    return `
      <div class="nba-calendar">
        <div class="nba-cal-head">
          ${DAYS_SHORT.map(d => `<div class="nba-cal-dow">${d}</div>`).join('')}
        </div>
        <div class="nba-cal-body">${cellsHTML}</div>
      </div>`;
  }

  // ── List view builder ────────────────────────────────────────────────────────
  function buildList() {
    const { year, month } = state;
    const filtered = getFiltered();

    // Prev / next month labels for the bottom nav
    const prevDate  = new Date(year, month - 1, 1);
    const nextDate  = new Date(year, month + 1, 1);
    const prevLabel = `‹ ${MONTHS[prevDate.getMonth()]} ${prevDate.getFullYear()}`;
    const nextLabel = `${MONTHS[nextDate.getMonth()]} ${nextDate.getFullYear()} ›`;

    const bottomNav = `
      <div class="nba-list-nav">
        <button class="nba-list-nav-btn" id="nba-list-prev-btn">${prevLabel}</button>
        <span class="nba-list-nav-label">${MONTHS[month]} ${year}</span>
        <button class="nba-list-nav-btn" id="nba-list-next-btn">${nextLabel}</button>
      </div>`;

    if (!filtered.length) {
      return `<div class="nba-list"><div class="nba-list-empty">No events found for this period.</div>${bottomNav}</div>`;
    }

    const groups  = {};
    const today   = todayISO();
    filtered
      .sort((a,b) => (a.startDate+a.startTime).localeCompare(b.startDate+b.startTime))
      .forEach(e => { (groups[e.startDate] = groups[e.startDate] || []).push(e); });

    const html = Object.keys(groups).sort().map(date => {
      const isT    = date === today;
      const label  = fmtLongDate(date) + (isT ? ' — <span style="color:#1BA249;font-weight:700">Today</span>' : '');

      const rows = groups[date].map(e => {
        const img  = e.imageUrl
          ? `<img class="nba-list-img" src="${h(e.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : '';
        const time = e.startTime ? fmtRange(e.startTime, e.endTime) : 'All Day';
        const cat  = e.category ? `<span class="nba-tag nba-tag-cat">${h(e.category)}</span>` : '';

        return `
          <a href="${h(e.url)}" target="_blank" rel="noopener"
             class="nba-list-event${isT?' today-grp':''}" style="display:flex!important;padding:12px!important;margin:0 0 6px 0!important;position:relative!important">
            ${img}
            <div class="nba-list-body" style="display:grid!important;row-gap:3px!important;align-content:start!important;margin:0!important;padding:0!important;flex:1;min-width:0">
              <div class="nba-list-name" style="margin:0!important;padding:0!important;line-height:1.3!important">${h(e.name)}</div>
              <div class="nba-list-time" style="margin:0!important;padding:0!important;line-height:1.2!important">${h(time)}</div>
              ${cat ? `<div class="nba-list-tags" style="margin:0!important;padding:0!important">${cat}</div>` : ''}
            </div>
            ${ttHTML(e, false)}
          </a>`;
      }).join('');

      return `<div class="nba-list-group">
        <div class="nba-list-date-hdr">${label}</div>
        ${rows}
      </div>`;
    }).join('');

    return `<div class="nba-list">${html}${bottomNav}</div>`;
  }

  // ── Filter bar builder ───────────────────────────────────────────────────────
  function buildFilters() {
    const { filters } = state;

    // Category chips — always shown from CATEGORY_CONFIG (never dynamic)
    const catChips = CATEGORY_CONFIG.map(({ label }) => {
      const on = filters.categories.length === 0 || filters.categories.includes(label);
      return `<button class="nba-filter-chip${on ? ' active' : ''}" data-filter="cat" data-value="${h(label)}">${h(label)}</button>`;
    }).join('');

    // Borough chips — derived from events that have a recognised borough
    const boroughsInData = new Set(state.events.map(e => e.borough).filter(Boolean));
    const boroughChips = BOROUGH_ORDER
      .filter(b => boroughsInData.has(b))
      .map(b => {
        const on = filters.boroughs.length === 0 || filters.boroughs.includes(b);
        return `<button class="nba-filter-chip${on ? ' active' : ''}" data-filter="borough" data-value="${h(b)}">${h(b)}</button>`;
      }).join('');

    const boroughRow = boroughChips
      ? `<div class="nba-filters nba-filters-borough">
           <span class="nba-filter-label">Borough</span>
           <div class="nba-filter-group">${boroughChips}</div>
         </div>`
      : '';

    return `
      <div class="nba-filters">
        <span class="nba-filter-label">Category</span>
        <div class="nba-filter-group">${catChips}</div>
      </div>
      ${boroughRow}`;
  }

  // ── Full render ──────────────────────────────────────────────────────────────
  function render() {
    const el = document.getElementById('nba-calendar');
    if (!el) return;

    const { year, month, view, loading, error } = state;

    let body;
    if (loading) {
      body = `<div class="nba-status"><div class="nba-spinner"></div><br>Loading events&hellip;</div>`;
    } else if (error) {
      body = `<div class="nba-status error">&#9888; Could not load events: ${h(error)}</div>`;
    } else {
      body = view === 'month' ? buildMonth() : buildList();
    }

    el.innerHTML = `
      <div class="nba-header" style="padding:8px 16px!important;gap:8px!important;height:auto!important;min-height:0!important">
        <div class="nba-search-wrap" style="flex-shrink:0">
          <i class="nba-search-icon">&#128269;</i>
          <input class="nba-search" id="nba-search-input" type="text"
                 placeholder="Search events&hellip;" value="${h(state.filters.search)}" autocomplete="off">
          <button class="nba-search-clear${state.filters.search ? ' visible' : ''}" id="nba-search-clear" title="Clear search">&#10005;</button>
        </div>
        <div class="nba-header-right">
          <button class="nba-btn nba-btn-today" id="nba-today-btn">Today</button>
          <button class="nba-btn nba-btn-nav"   id="nba-prev-btn">&#8249;</button>
          <span class="nba-month-label">${MONTHS[month]} ${year}</span>
          <button class="nba-btn nba-btn-nav"   id="nba-next-btn">&#8250;</button>
          ${state._autoList ? '' : `<div class="nba-view-toggle">
            <button class="nba-view-btn${view==='month'?' active':''}" data-view="month">Month</button>
            <button class="nba-view-btn${view==='list' ?' active':''}" data-view="list">List</button>
          </div>`}
        </div>
      </div>
      ${buildFilters()}
      ${body}`;

    attachListeners();
    enforceMonthStyles();
    setTimeout(enforceMonthStyles, 0);
    setTimeout(enforceMonthStyles, 300);
    setTimeout(enforceMonthStyles, 1000);
  }

  // ── Force layout overrides regardless of host CSS/JS ─────────────────────────
  function enforceMonthStyles() {
    const q = s => document.querySelectorAll(s);
    const f = (el, prop, val) => el.style.setProperty(prop, val, 'important');
    // Kill any host-injected margins between widget sections
    const cal = document.getElementById('nba-calendar');
    if (cal) {
      f(cal, 'display', 'flex'); f(cal, 'flex-direction', 'column'); f(cal, 'gap', '0');
      Array.from(cal.children).forEach(c => {
        f(c, 'margin-top', '0'); f(c, 'margin-bottom', '0');
      });
    }
    // Header — also set height:auto in case host has a fixed height rule
    q('#nba-calendar .nba-header').forEach(el => {
      f(el, 'padding', '8px 16px'); f(el, 'height', 'auto'); f(el, 'min-height', '0');
    });
    q('#nba-calendar .nba-filters').forEach(el => {
      f(el, 'padding', '7px 16px'); f(el, 'margin', '0');
    });
    // chips-stack: grid so align-content:start and align-items:start pack chips tightly
    q('#nba-calendar .nba-chips-stack').forEach(el => {
      f(el, 'display', 'grid');
      f(el, 'grid-template-columns', '1fr');
      f(el, 'row-gap', '3px');
      f(el, 'align-content', 'start');
      f(el, 'align-items', 'start');
      f(el, 'margin', '0');
      f(el, 'padding', '0');
    });
    // Chip is now direct grid item — enforce height:auto so host can't inflate it
    q('#nba-calendar .nba-event-chip').forEach(el => {
      f(el, 'display', 'flex');
      f(el, 'flex-direction', 'column');
      f(el, 'gap', '2px');
      f(el, 'padding', '5px 7px 6px');
      f(el, 'margin', '0');
      f(el, 'height', 'auto');
      f(el, 'min-height', '0');
      f(el, 'position', 'relative');
    });
    q('#nba-calendar .nba-chip-time').forEach(el => {
      f(el, 'display', 'block'); f(el, 'margin', '0');
      f(el, 'padding', '0'); f(el, 'line-height', '1.2'); f(el, 'min-height', '0');
      f(el, 'white-space', 'nowrap'); f(el, 'overflow', 'hidden');
    });
    q('#nba-calendar .nba-chip-title').forEach(el => {
      f(el, 'display', 'block'); f(el, 'margin', '0');
      f(el, 'padding', '0'); f(el, 'line-height', '1.3'); f(el, 'min-height', '0');
      f(el, 'overflow', 'hidden'); f(el, 'max-height', 'calc(1.3em * 4)');
    });
  }

  // ── Attach all event listeners after each render ─────────────────────────────
  function attachListeners() {
    const el = document.getElementById('nba-calendar');
    if (!el) return;

    // Today
    el.querySelector('#nba-today-btn')?.addEventListener('click', () => {
      const t = new Date();
      if (state.year !== t.getFullYear() || state.month !== t.getMonth()) {
        state.year  = t.getFullYear();
        state.month = t.getMonth();
        loadMonth();
      }
    });

    // Prev
    el.querySelector('#nba-prev-btn')?.addEventListener('click', () => {
      if (--state.month < 0) { state.month = 11; state.year--; }
      loadMonth();
    });

    // Next
    el.querySelector('#nba-next-btn')?.addEventListener('click', () => {
      if (++state.month > 11) { state.month = 0; state.year++; }
      loadMonth();
    });

    // View toggle
    el.querySelectorAll('.nba-view-btn').forEach(b =>
      b.addEventListener('click', () => { state.view = b.dataset.view; state._autoList = false; render(); })
    );

    // Filter chips (category and borough share the same chip style)
    el.querySelectorAll('.nba-filter-chip[data-filter]').forEach(b =>
      b.addEventListener('click', () => {
        const { filter, value } = b.dataset;
        const arr = filter === 'borough' ? state.filters.boroughs : state.filters.categories;
        const i   = arr.indexOf(value);
        i === -1 ? arr.push(value) : arr.splice(i, 1);
        render();
      })
    );

    // Search – debounced
    el.querySelector('#nba-search-input')?.addEventListener('input', e => {
      clearTimeout(state._searchTimer);
      const val = e.target.value;
      // show/hide × immediately without waiting for debounce
      const clr = el.querySelector('#nba-search-clear');
      if (clr) clr.classList.toggle('visible', !!val);
      state._searchTimer = setTimeout(() => {
        state.filters.search = val;
        render();
        // restore focus
        const inp = document.getElementById('nba-search-input');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      }, 260);
    });

    // Search clear ×
    el.querySelector('#nba-search-clear')?.addEventListener('click', () => {
      clearTimeout(state._searchTimer);
      state.filters.search = '';
      render();
      document.getElementById('nba-search-input')?.focus();
    });

    // List-view bottom nav — prev / next month
    el.querySelector('#nba-list-prev-btn')?.addEventListener('click', () => {
      if (--state.month < 0) { state.month = 11; state.year--; }
      loadMonth();
    });
    el.querySelector('#nba-list-next-btn')?.addEventListener('click', () => {
      if (++state.month > 11) { state.month = 0; state.year++; }
      loadMonth();
    });

    // "+ N more" → switch to list view
    el.querySelectorAll('.nba-more-btn[data-date]').forEach(b =>
      b.addEventListener('click', () => {
        state.view           = 'list';
        state.filters.search = b.dataset.date;
        render();
        setTimeout(() => {
          state.filters.search = '';
          const inp = document.getElementById('nba-search-input');
          if (inp) inp.value = '';
        }, 0);
      })
    );
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  // Fetch all pages for a given date range in parallel and return the full
  // event array. Throws on network/HTTP errors for the first page; subsequent
  // page failures are swallowed so a partial result is still returned.
  async function fetchAllPages(startDate, endDate) {
    const res = await fetch(`${BASE_URL}/api/events?startDate=${startDate}&endDate=${endDate}&pageSize=200`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let events = data.events || [];
    const total    = data.pagination?.totalResults ?? events.length;
    const size     = data.pagination?.pageSize      ?? 200;
    const maxPages = Math.ceil(total / size);

    if (maxPages > 1) {
      // Fire all remaining page requests in parallel — much faster than sequential.
      const pageNums = Array.from({ length: maxPages - 1 }, (_, i) => i + 2);
      const pages = await Promise.all(
        pageNums.map(pg =>
          fetch(`${BASE_URL}/api/events?startDate=${startDate}&endDate=${endDate}&pageSize=${size}&page=${pg}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      pages.forEach(pd => { if (pd) events = events.concat(pd.events || []); });
    }

    return events;
  }

  async function loadMonth() {
    const { year, month } = state;
    const key       = `${year}-${String(month+1).padStart(2,'0')}`;
    const startDate = `${key}-01`;
    const lastDay   = new Date(year, month+1, 0).getDate();
    const endDate   = `${key}-${lastDay}`;

    if (state._cache[key]) {
      state.events = state._cache[key];
      render();
      // Still kick off adjacent pre-fetches in case they aren't cached yet.
      prefetchAdjacentMonths(year, month);
      return;
    }

    state.loading = true;
    state.error   = null;
    render();

    try {
      let events = await fetchAllPages(startDate, endDate);

      // ── Client-side date guard ─────────────────────────────────────────────
      // Some Neon orgs return all events regardless of date params; filter here
      // to only include events that START within the requested month.
      events = events.filter(e => e.startDate >= startDate && e.startDate <= endDate);

      state._cache[key] = events;
      state.events      = events;
      state.error       = null;

    } catch (err) {
      state.error  = err.message;
      state.events = [];
    } finally {
      state.loading = false;
      render();
    }

    // Pre-fetch neighbours silently so navigating feels instant.
    prefetchAdjacentMonths(year, month);
  }

  // Silently populate the cache for the months immediately before and after
  // the given month. Errors are swallowed — this is best-effort only.
  function prefetchAdjacentMonths(year, month) {
    [
      month === 0  ? [year - 1, 11] : [year, month - 1],
      month === 11 ? [year + 1, 0]  : [year, month + 1],
    ].forEach(([y, m]) => {
      const key   = `${y}-${String(m+1).padStart(2,'0')}`;
      if (state._cache[key]) return; // already have it
      const start = `${key}-01`;
      const last  = new Date(y, m+1, 0).getDate();
      const end   = `${key}-${last}`;
      fetchAllPages(start, end)
        .then(evts => {
          state._cache[key] = evts.filter(e => e.startDate >= start && e.startDate <= end);
        })
        .catch(() => {}); // silent fail
    });
  }

  // ── Responsive: auto-switch to list view when widget is too narrow ───────────
  const NARROW_PX = 560;
  function checkResponsive() {
    const el = document.getElementById('nba-calendar');
    if (!el) return;
    const narrow = el.offsetWidth > 0 && el.offsetWidth < NARROW_PX;
    if (narrow && state.view === 'month') {
      state.view = 'list';
      state._autoList = true;
      render();
    } else if (!narrow && state._autoList) {
      state.view = 'month';
      state._autoList = false;
      render();
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    let el = document.getElementById('nba-calendar');
    if (!el) {
      el    = document.createElement('div');
      el.id = 'nba-calendar';
      document.body.appendChild(el);
    }
    // Auto-switch to list on narrow screens
    if (window.ResizeObserver) {
      new ResizeObserver(checkResponsive).observe(el);
    }
    if (el.offsetWidth > 0 && el.offsetWidth < NARROW_PX) {
      state.view = 'list';
      state._autoList = true;
    }
    loadMonth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
