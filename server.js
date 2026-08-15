// Shoreline Mortgage Group — Claude API proxy
//
// Why this exists: inside Claude.ai, the calculators' fetch() calls to
// api.anthropic.com are auto-authenticated by Claude.ai itself. Once you copy
// the calculator HTML into GHL (or anywhere outside Claude.ai), that
// auto-auth goes away — there's no API key on the page, and there shouldn't
// be, because anything in page JS is visible to every visitor.
//
// This tiny server holds your real Anthropic API key as a secret environment
// variable and simply forwards requests to Anthropic on the page's behalf.
// Deploy it once on Render (same place smg_automation.py already runs), then
// point both calculators' API_ENDPOINT constant at this server's URL instead
// of api.anthropic.com directly.
//
// It also holds a second secret — your RapidAPI key — behind a
// /api/property-lookup route, so the calculators can pull real listing data
// (price, status, Zestimate, rent estimate, tax, insurance, price history)
// without that key ever being visible in the page's JavaScript either.
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors()); // allow requests from your GHL domain(s)
app.use(express.json({ limit: '1mb' }));
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const PORT = process.env.PORT || 3000;
if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY environment variable. Set it in Render before deploying.');
}
if (!RAPIDAPI_KEY) {
  console.error('Missing RAPIDAPI_KEY environment variable. Set it in Render before deploying.');
}
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy request failed', detail: String(err) });
  }
});

// Looks up a property by address via the RapidAPI Real-Time Real-Estate Data
// feed and returns a normalized JSON object (price, status, zestimate, rent
// estimate, tax, insurance, price history) that both calculators consume in
// one call. Replaces the old AI web-search based listing/AVM/tax lookups.
app.get('/api/property-lookup', async (req, res) => {
  try {
    const address = req.query.address;
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'address query parameter is required' });
    }

    const url = 'https://real-time-real-estate-data.p.rapidapi.com/property-details-address?address='
      + encodeURIComponent(address.trim());

    const apiRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': 'real-time-real-estate-data.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: 'Upstream API error', status: apiRes.status });
    }

    const json = await apiRes.json();

    if (json.status !== 'OK' || !json.data) {
      return res.status(404).json({ error: 'Property not found', found: false });
    }

    const d = json.data;
    const resoFacts = d.resoFacts || {};

    // Trim price history to the 6 most recent events, and only the fields we need.
    const priceHistory = Array.isArray(d.priceHistory)
      ? d.priceHistory.slice(0, 6).map(p => ({
          date: p.date || null,
          event: p.event || null,
          price: (typeof p.price === 'number') ? p.price : null
        }))
      : [];

    // Normalize into a clean, calculator-friendly shape.
    const normalized = {
      found: true,
      address: d.streetAddress || address,
      city: d.city || (d.address && d.address.city) || null,
      state: d.state || (d.address && d.address.state) || null,
      zip: d.zipcode || (d.address && d.address.zipcode) || null,

      // FOR_SALE, OTHER, SOLD, PENDING, etc.
      homeStatus: d.homeStatus || null,
      isForSale: d.homeStatus === 'FOR_SALE',

      price: (typeof d.price === 'number' && d.price > 0) ? d.price : null,
      zestimate: (typeof d.zestimate === 'number') ? d.zestimate : null,
      rentZestimate: (typeof d.rentZestimate === 'number') ? d.rentZestimate : null,

      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      livingArea: d.livingArea ?? null,
      yearBuilt: d.yearBuilt ?? null,

      taxAnnualAmount: (typeof resoFacts.taxAnnualAmount === 'number') ? resoFacts.taxAnnualAmount : null,
      annualHomeownersInsurance: (typeof d.annualHomeownersInsurance === 'number') ? d.annualHomeownersInsurance : null,

      daysOnZillow: d.daysOnZillow ?? null,
      onMarketDate: (resoFacts.onMarketDate && typeof resoFacts.onMarketDate === 'number')
        ? new Date(resoFacts.onMarketDate).toISOString().slice(0, 10)
        : null,
      priceHistory: priceHistory,
      hdpUrl: d.hdpUrl ? ('https://www.zillow.com' + d.hdpUrl) : null
    };

    res.json(normalized);
  } catch (err) {
    console.error('property-lookup error:', err);
    res.status(500).json({ error: 'Lookup failed', message: err.message });
  }
});

app.get('/health', (req, res) => res.send('ok'));
app.listen(PORT, () => {
  console.log(`SMG Claude proxy listening on port ${PORT}`);
});
