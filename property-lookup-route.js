/* =========================================================================
   ADD THIS ROUTE TO YOUR EXISTING smg-claude-proxy Render SERVICE
   =========================================================================
   Where to put it: in the same file where your existing
   app.post('/api/claude', ...) (or similar) route lives. Paste this whole
   block near that route, then redeploy.

   New environment variable required on Render:
     Key:   RAPIDAPI_KEY
     Value: <your rotated RapidAPI key>
   (Render dashboard > smg-claude-proxy > Environment > Add Environment Variable)

   This single endpoint replaces three separate AI web-search calls
   (listing check, AVM/home value, tax & insurance) with one direct API call
   to real data. It is faster, cheaper, and more accurate.
   ========================================================================= */

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
        'x-rapidapi-key': process.env.RAPIDAPI_KEY
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
