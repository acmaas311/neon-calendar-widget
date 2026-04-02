// api/events.js — Vercel serverless function
// Proxies NeonCRM API requests so the API key is never exposed to the browser.
//
// Environment variables required (set in Vercel dashboard):
//   NEON_ORG_ID  — your NeonCRM org subdomain, e.g. "nycbirdalliance"
//   NEON_API_KEY — your NeonCRM API key

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
      // Determine if the event has any paid registration sessions
      const sessions = e.registrationInfo?.registrationSessions ?? [];
      const isFree   = sessions.length === 0 || sessions.every(s => !s.fee || s.fee === 0);

      // Registration capacity — Neon provides maximumAttendees and
      // registrationInfo.registrationCount (current registered count)
      const maxAttendees  = e.maximumAttendees ?? e.capacity ?? null;
      const regCount      = e.registrationInfo?.registrationCount
                         ?? e.registrationInfo?.totalRegistrations
                         ?? null;
      const isFull = maxAttendees > 0 && regCount !== null && regCount >= maxAttendees;

      return {
        id:           e.id,
        name:         e.name || 'Untitled Event',
        startDate:    e.startDate,          // "YYYY-MM-DD"
        startTime:    e.startTime || null,  // "HH:mm:ss" or null
        endDate:      e.endDate,
        endTime:      e.endTime   || null,
        locationName: e.location?.locationName
                   || e.location?.name
                   || (typeof e.location === 'string' ? e.location : '')
                   || e.locationName
                   || '',
        // Neon returns category as an array of strings e.g. ["Festivals"]
        category:     (Array.isArray(e.category) ? e.category[0] : e.category?.name) || '',
        // Strip HTML tags and decode entities Neon embeds in summary/description
        summary: ((e.summary || e.description || '')
          .replace(/<[^>]*>/g, ' ')          // strip tags
          .replace(/&nbsp;/g,  ' ')          // decode common entities
          .replace(/&amp;/g,   '&')
          .replace(/&lt;/g,    '<')
          .replace(/&gt;/g,    '>')
          .replace(/&quot;/g,  '"')
          .replace(/&apos;/g,  "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
          .replace(/\s+/g, ' ')
          .trim()),
        imageUrl:     e.eventImage?.imageUrl  || null,
        isFree,
        isFull,
        // Deep link to the NeonCRM public event page
        url: `https://${orgId}.app.neoncrm.com/np/clients/${orgId}/event.jsp?event=${e.id}`,
      };
    });

    // ── Cache for 5 minutes on Vercel edge ────────────────────────────────
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      events,
      pagination: data.pagination ?? {},
      _debugFirstRaw: data.events?.[0] ?? null,  // TEMP — remove after finding location field
    });

  } catch (err) {
    console.error('Unexpected error in /api/events:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
