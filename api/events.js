// api/events.js — Vercel serverless function
// Proxies NeonCRM API requests so the API key is never exposed to the browser.
//
// Environment variables required (set in Vercel dashboard):
//   NEON_ORG_ID  — your NeonCRM org subdomain, e.g. "nycbirdalliance"
//   NEON_API_KEY — your NeonCRM API key

// Maps addressCity values (lowercased) to a NYC borough label.
// Anything not listed here gets an empty string (no borough / outside NYC).
const CITY_TO_BOROUGH = {
  // Manhattan
  'new york':          'Manhattan',
  'manhattan':         'Manhattan',
  'new york city':     'Manhattan',
  'nyc':               'Manhattan',
  // Brooklyn
  'brooklyn':          'Brooklyn',
  // Bronx
  'bronx':             'Bronx',
  'the bronx':         'Bronx',
  // Staten Island
  'staten island':     'Staten Island',
  // Queens neighborhoods
  'astoria':           'Queens',
  'bayside':           'Queens',
  'bellerose':         'Queens',
  'briarwood':         'Queens',
  'college point':     'Queens',
  'corona':            'Queens',
  'east elmhurst':     'Queens',
  'east rockaway':     'Queens',
  'elmhurst':          'Queens',
  'far rockaway':      'Queens',
  'floral park':       'Queens',
  'flushing':          'Queens',
  'forest hills':      'Queens',
  'fresh meadows':     'Queens',
  'glen oaks':         'Queens',
  'glendale':          'Queens',
  'hollis':            'Queens',
  'howard beach':      'Queens',
  'jackson heights':   'Queens',
  'jamaica':           'Queens',
  'jamaica hills':     'Queens',
  'kew gardens':       'Queens',
  'kew gardens hills': 'Queens',
  'laurelton':         'Queens',
  'little neck':       'Queens',
  'long island city':  'Queens',
  'maspeth':           'Queens',
  'middle village':    'Queens',
  'ozone park':        'Queens',
  'queens':            'Queens',
  'queens village':    'Queens',
  'rego park':         'Queens',
  'richmond hill':     'Queens',
  'ridgewood':         'Queens',
  'rockaway beach':    'Queens',
  'rockaway park':     'Queens',
  'rosedale':          'Queens',
  'saint albans':      'Queens',
  'south jamaica':     'Queens',
  'south ozone park':  'Queens',
  'springfield gardens':'Queens',
  'sunnyside':         'Queens',
  'whitestone':        'Queens',
  'woodhaven':         'Queens',
  'woodside':          'Queens',
};

// Comprehensive HTML entity map — covers typography, Latin-1 accented characters,
// and all common named entities NeonCRM may embed in event text.
const HTML_ENTITIES = {
  // Whitespace / typography
  nbsp:'\u00A0', ensp:'\u2002', emsp:'\u2003', thinsp:'\u2009',
  rsquo:'\u2019', lsquo:'\u2018', rdquo:'\u201D', ldquo:'\u201C',
  sbquo:'\u201A', bdquo:'\u201E',
  ndash:'\u2013', mdash:'\u2014', minus:'\u2212',
  hellip:'\u2026', bull:'\u2022', middot:'\u00B7',
  copy:'\u00A9', reg:'\u00AE', trade:'\u2122',
  euro:'\u20AC', pound:'\u00A3', cent:'\u00A2', yen:'\u00A5',
  lt:'<', gt:'>', quot:'"', apos:"'",
  // Latin uppercase accented
  Agrave:'À',Aacute:'Á',Acirc:'Â',Atilde:'Ã',Auml:'Ä',Aring:'Å',AElig:'Æ',
  Ccedil:'Ç',
  Egrave:'È',Eacute:'É',Ecirc:'Ê',Euml:'Ë',
  Igrave:'Ì',Iacute:'Í',Icirc:'Î',Iuml:'Ï',
  ETH:'Ð',Ntilde:'Ñ',
  Ograve:'Ò',Oacute:'Ó',Ocirc:'Ô',Otilde:'Õ',Ouml:'Ö',Oslash:'Ø',
  Ugrave:'Ù',Uacute:'Ú',Ucirc:'Û',Uuml:'Ü',
  Yacute:'Ý',THORN:'Þ',szlig:'ß',
  // Latin lowercase accented
  agrave:'à',aacute:'á',acirc:'â',atilde:'ã',auml:'ä',aring:'å',aelig:'æ',
  ccedil:'ç',
  egrave:'è',eacute:'é',ecirc:'ê',euml:'ë',
  igrave:'ì',iacute:'í',icirc:'î',iuml:'ï',
  eth:'ð',ntilde:'ñ',
  ograve:'ò',oacute:'ó',ocirc:'ô',otilde:'õ',ouml:'ö',oslash:'ø',
  ugrave:'ù',uacute:'ú',ucirc:'û',uuml:'ü',
  yacute:'ý',thorn:'þ',yuml:'ÿ',
};

// Strip HTML tags and decode all entities NeonCRM may embed in text fields.
function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, ' ')          // strip HTML tags
    .replace(/&([a-zA-Z]+);/g, (m, name) => HTML_ENTITIES[name] ?? m)  // named entities
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) // hex numeric
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))               // decimal numeric
    .replace(/&amp;/g, '&')            // must be last to avoid double-decoding
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Credentials ───────────────────────────────────────────────────────────
  const orgId  = process.env.NEON_ORG_ID;
  const apiKey = process.env.NEON_API_KEY;

  if (!orgId || !apiKey) {
    console.error('Missing NEON_ORG_ID or NEON_API_KEY environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const credentials = Buffer.from(`${orgId}:${apiKey}`).toString('base64');

  // ── Query params ──────────────────────────────────────────────────────────
  const {
    startDate,
    endDate,
    page     = '1',
    pageSize = '200',
  } = req.query;

  const params = new URLSearchParams({
    archived:    'false',
    pageSize,
    currentPage: String(Number(page) - 1),  // Neon pages are 0-based
  });

  if (startDate) params.append('startDate', startDate);
  if (endDate)   params.append('endDate',   endDate);

  // ── Fetch from Neon ───────────────────────────────────────────────────────
  try {
    const neonRes = await fetch(
      `https://api.neoncrm.com/v2/events?${params.toString()}`,
      {
        headers: {
          Authorization:  `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!neonRes.ok) {
      const body = await neonRes.text();
      console.error('Neon API error:', neonRes.status, body);
      return res.status(neonRes.status).json({ error: `Neon API error: ${neonRes.status}` });
    }

    const data = await neonRes.json();

    // ── Transform ──────────────────────────────────────────────────────────
    const events = (data.events || []).map(e => {
      // NeonCRM v2 list API does not return fee/registrationSessions data.
      // Best available proxy: enableEventRegistrationForm === true means the
      // event has a registration form and is likely paid; false = free/walk-in.
      const isFree = !e.enableEventRegistrationForm;

      // Registration capacity — Neon provides maximumAttendees and
      // registrationInfo.registrationCount (current registered count)
      const maxAttendees  = e.maximumAttendees ?? e.capacity ?? null;
      const regCount      = e.registrationInfo?.registrationCount
                         ?? e.registrationInfo?.totalRegistrations
                         ?? null;
      const isFull = maxAttendees > 0 && regCount !== null && regCount >= maxAttendees;

      return {
        id:           e.id,
        startDate:    e.startDate,          // "YYYY-MM-DD"
        startTime:    e.startTime || null,  // "HH:mm:ss" or null
        endDate:      e.endDate,
        endTime:      e.endTime   || null,
        // NeonCRM v2 list API returns location as flat address fields, not
        // a nested object. Prefer addressLine1 (venue/street) + city.
        locationName: e.location?.locationName
                   || e.location?.name
                   || (typeof e.location === 'string' ? e.location : '')
                   || e.locationName
                   || [e.addressLine1, e.addressCity].filter(Boolean).join(', ')
                   || '',
        // Neon returns category as an array of strings e.g. ["Festivals"]
        category:     (Array.isArray(e.category) ? e.category[0] : e.category?.name) || '',
        // Strip HTML tags and decode all entities Neon may embed in text fields.
        name:    cleanText(e.name || 'Untitled Event'),
        summary: cleanText(e.summary || e.description || ''),
        // thumbnailUrl is often null from NeonCRM. The first <img> in the raw
        // description HTML is the reliable source. Use thumbnailUrl as fallback.
        imageUrl: ((() => { const m = (e.summary || e.description || '').match(/<img[^>]+src=["']([^"']+)["']/i); return m ? m[1] : null; })()) || e.thumbnailUrl || null,
        isFree,
        isFull,
        // Borough derived from addressCity
        borough: CITY_TO_BOROUGH[(e.addressCity || '').toLowerCase().trim()] || '',
        // Deep link to the NeonCRM public event page
        url: `https://${orgId}.app.neoncrm.com/np/clients/${orgId}/event.jsp?event=${e.id}`,
      };
    });

    // ── Cache for 30 minutes on Vercel edge ───────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

    return res.status(200).json({
      events,
      pagination: data.pagination ?? {},
    });

  } catch (err) {
    console.error('Unexpected error in /api/events:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
