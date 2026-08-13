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

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors()); // allow requests from your GHL domain(s)
app.use(express.json({ limit: '1mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY environment variable. Set it in Render before deploying.');
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

app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`SMG Claude proxy listening on port ${PORT}`);
});
