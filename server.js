const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory cache for API responses (TTL: 10 minutes)
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// TMDB Proxy endpoint - handles queries via upstream proxy or fallback
app.use('/api/tmdb', async (req, res) => {
  // req.url starts with '/' e.g. /movie/1311031 or /search/multi?query=demon
  const subPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
  const cacheKey = subPath;

  const cached = getCached(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // Upstream proxy candidates (multiple redundant mirrors)
  const upstreamUrls = [
    `https://ghostflix.st/api/tmdb/${subPath}`,
    `https://stream-three-xi.vercel.app/api/tmdb/${subPath}`,
    `https://redflix-nextjs.vercel.app/api/tmdb/${subPath}`
  ];

  for (const url of upstreamUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://ghostflix.st/'
        },
        signal: AbortSignal.timeout(8000)
      });

      if (response.ok) {
        const data = await response.json();
        setCache(cacheKey, data);
        return res.json(data);
      }
    } catch (err) {
      console.warn(`Upstream failed (${url}):`, err.message);
    }
  }

  res.status(502).json({ error: 'Failed to fetch data from TMDB upstream providers' });
});

// Image Proxy - Solves Android WebView mixed content and ISP blocks for image.tmdb.org
app.use('/api/image', async (req, res) => {
  const cleanPath = req.url.startsWith('/') ? req.url.slice(1) : req.url;
  const tmdbUrl = cleanPath.startsWith('http') ? cleanPath : `https://image.tmdb.org/t/p/${cleanPath}`;

  try {
    const upstream = await fetch(tmdbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000)
    });

    if (upstream.ok) {
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const arrayBuffer = await upstream.arrayBuffer();
      return res.send(Buffer.from(arrayBuffer));
    }
    return res.redirect(`https://wsrv.nl/?url=${encodeURIComponent(tmdbUrl)}`);
  } catch (err) {
    return res.redirect(`https://wsrv.nl/?url=${encodeURIComponent(tmdbUrl)}`);
  }
});

// Stream Resolver - gets direct HLS streams, multi-audio & subtitles for our custom player
app.get('/api/resolve', async (req, res) => {
  const { type, id, season, episode, server } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing ID' });

  let target = `https://vidbolt.pro/api/resolve?type=${type || 'movie'}&id=${id}`;
  if (type === 'tv' && season && episode) {
    target += `&season=${season}&episode=${episode}`;
  }
  if (server) {
    target += `&server=${encodeURIComponent(server)}`;
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `https://vidbolt.pro/${type || 'movie'}/${id}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(9000)
    });

    if (upstream.ok) {
      const data = await upstream.json();
      return res.json(data);
    }
  } catch (err) {
    console.warn('Stream resolve failed:', err.message);
  }

  res.status(502).json({ error: 'Unable to resolve direct stream' });
});

// Direct Embed Player Redirect
app.get('/player/embed', (req, res) => {
  const { type, id, season, episode, audio } = req.query;
  let target = type === 'tv'
    ? `https://vidbolt.pro/tv/${id}/${season || 1}/${episode || 1}?theme=E50914&autoPlay=true&mobileSheets=true`
    : `https://vidbolt.pro/movie/${id}?theme=E50914&autoPlay=true&mobileSheets=true`;
  if (audio && audio !== 'default') target += `&audio=${encodeURIComponent(audio)}`;
  return res.redirect(target);
});

// Disable caching for development / live WebView sync
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Catch-all route to serve index.html for SPA hash routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Ghostflix & Netflix Streamer Running!`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`🎬 Try: http://localhost:${PORT}/#play?id=1311031&type=movie`);
    console.log(`======================================================\n`);
  });
}

module.exports = app;
