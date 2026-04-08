// api/event.js — Vercel serverless function
// Fetches a single NeonCRM event by ID and returns the first image URL
// found in eventDescription. Used to backfill images missing from the
// list API response (which truncates/strips description HTML).

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const orgId  = process.env.NEON_ORG_ID;
  const apiKey = process.env.NEON_API_KEY;
  if (!orgId || !apiKey) return res.status(500).json({ error: 'Server configuration error' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  const credentials = Buffer.from(`${orgId}:${apiKey}`).toString('base64');

  try {
    const neonRes = await fetch(
      `https://api.neoncrm.com/v2/events/${id}`,
      { headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' } }
    );

    if (!neonRes.ok) return res.status(neonRes.status).json({ error: `Neon API error: ${neonRes.status}` });

    const data = await neonRes.json();

    // Search eventDescription, description, summary in order for first <img src>
    let imageUrl = null;
    for (const field of [data.eventDescription, data.description, data.summary]) {
      if (!field) continue;
      const m = field.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) { try { imageUrl = encodeURI(decodeURI(m[1])); } catch (_) { imageUrl = m[1]; } break; }
    }

    // Cache individual event responses for 30 minutes
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ imageUrl });

  } catch (err) {
    console.error('Unexpected error in /api/event:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
