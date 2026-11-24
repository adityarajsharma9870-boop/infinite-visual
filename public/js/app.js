/**
 * Ghostflix Web Streaming Application
 * Connects to TMDB Proxy and embeds VidBolt (Orion, Callisto, Quasar, etc.)
 */

const TMDB_IMAGE_BASE = '/api/image/';
const POSTER_SIZE = 'w342';
const BACKDROP_SIZE = 'w1280';
const STILL_SIZE = 'w300';

// Safe LocalStorage helpers for Android WebView & incognito
function safeGetItem(key, fallback = null) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (_) {
    return fallback;
  }
}

function safeSetItem(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (_) { }
}

// Global state
let currentPlaying = null; // { id, type, title, season, episode, totalEpisodes }
let currentAudio = safeGetItem('ghostflix_audio_pref', 'hindi');
let playerEngine = 'vidlink'; // 'vidlink' (100% verified working, multi-audio Hindi/English, zero popup redirects) | 'custom' | 'vidbolt' | 'autoembed' | 'vidsrc'
let artPlayerInstance = null;
let playerInactivityTimer = null;
let heroMedia = null;
let currentFilter = 'all';
let searchTimeout = null;
let watchlist = [];
try { watchlist = JSON.parse(safeGetItem('ghostflix_watchlist', '[]')); } catch (_) { watchlist = []; }

// Stream Servers (VidBolt Cluster: Orion, Callisto, Luna, Vega, Quantum, Quasar)
const STREAM_SERVERS = [
  { id: 'orion', name: 'Orion', flag: '🇺🇸', label: 'US High-Speed' },
  { id: 'callisto', name: 'Callisto', flag: '🇺🇸', label: 'US Direct' },
  { id: 'luna', name: 'Luna', flag: '🇺🇸', label: 'US Cloud' },
  { id: 'vega', name: 'Vega', flag: '🇺🇸', label: 'US Edge' },
  { id: 'quantum', name: 'Quantum', flag: '🇺🇸', label: 'US Ultra' },
  { id: 'quasar', name: 'Quasar', flag: '🇮🇳', label: 'India Direct' }
];

let currentStreamServer = safeGetItem('ghostflix_server_pref', 'orion');
let favoriteServers = ['orion'];
try { favoriteServers = JSON.parse(safeGetItem('ghostflix_fav_servers', '["orion"]')); } catch (_) { favoriteServers = ['orion']; }
let currentQualityLevel = -1; // -1 = Auto
let currentAudioTrackIndex = -1;
let currentSubtitleIndex = -1;
let currentHlsLevels = [];
let currentAudioTracks = [];
let currentSubtitleTracks = [];

const LANGUAGE_FLAGS = {
  'hindi': '🇮🇳', 'hin': '🇮🇳',
  'english': '🇺🇸', 'eng': '🇺🇸',
  'japanese': '🇯🇵', 'jpn': '🇯🇵', 'jap': '🇯🇵',
  'spanish': '🇪🇸', 'spa': '🇪🇸',
  'catalan': '🇪🇸', 'cat': '🇪🇸',
  'german': '🇩🇪', 'deu': '🇩🇪', 'ger': '🇩🇪',
  'french': '🇫🇷', 'fra': '🇫🇷',
  'italian': '🇮🇹', 'ita': '🇮🇹',
  'korean': '🇰🇷', 'kor': '🇰🇷',
  'polish': '🇵🇱', 'pol': '🇵🇱',
  'portuguese': '🇵🇹', 'por': '🇵🇹',
  'russian': '🇷🇺', 'rus': '🇷🇺',
  'tamil': '🇮🇳', 'tam': '🇮🇳',
  'telugu': '🇮🇳', 'tel': '🇮🇳',
  'ukrainian': '🇺🇦', 'ukr': '🇺🇦',
  'greek': '🇬🇷', 'ell': '🇬🇷',
  'chinese': '🇨🇳', 'zho': '🇨🇳',
  'turkish': '🇹🇷', 'tur': '🇹🇷',
  'arabic': '🇸🇦', 'ara': '🇸🇦'
};

function getLanguageFlag(name, lang) {
  const s = ((name || '') + ' ' + (lang || '')).toLowerCase();
  for (const [k, v] of Object.entries(LANGUAGE_FLAGS)) {
    if (s.includes(k)) return v;
  }
  return '🌐';
}

// Popular Curated Anime IDs to ensure Anime row always has peak titles
const CURATED_ANIME_IDS = [
  { id: 1311031, type: 'movie', title: 'Demon Slayer: Infinity Castle' },
  { id: 85937, type: 'tv', title: 'Demon Slayer: Kimetsu no Yaiba' },
  { id: 209867, type: 'tv', title: 'Solo Leveling' },
  { id: 95479, type: 'tv', title: 'Jujutsu Kaisen' },
  { id: 1429, type: 'tv', title: 'Attack on Titan' },
  { id: 114410, type: 'tv', title: 'Chainsaw Man' },
  { id: 37854, type: 'tv', title: 'One Piece' },
  { id: 30984, type: 'tv', title: 'Bleach: Thousand-Year Blood War' },
  { id: 635302, type: 'movie', title: 'Demon Slayer: Mugen Train' },
  { id: 92685, type: 'tv', title: 'DanDaDan' }
];

function initApp() {
  try { initNavbarScroll(); } catch (e) { console.warn('initNavbarScroll:', e); }
  try { initSearch(); } catch (e) { console.warn('initSearch:', e); }
  try { initStudiosCarouselGestures(); } catch (e) { console.warn('initStudiosCarouselGestures:', e); }
  try { loadAllRows(); } catch (e) { console.warn('loadAllRows:', e); }
  try { updateWatchlistBadge(); } catch (e) { console.warn('updateWatchlistBadge:', e); }
  try { handleUrlRouting(); } catch (e) { console.warn('handleUrlRouting:', e); }
  window.addEventListener('hashchange', handleUrlRouting);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ==========================================
// 1. ROUTING & URL HANDLING
// ==========================================
function handleUrlRouting() {
  const hash = window.location.hash;
  if (!hash) return;

  if (hash.startsWith('#play?')) {
    const params = new URLSearchParams(hash.replace('#play?', ''));
    const id = params.get('id');
    const type = params.get('type') || 'movie';
    const season = parseInt(params.get('season') || '1', 10);
    const episode = parseInt(params.get('episode') || '1', 10);

    // Guard: Prevent double-loading or infinite re-triggering loops
    if (currentPlaying && String(currentPlaying.id) === String(id) && currentPlaying.type === type && currentPlaying.season === season && currentPlaying.episode === episode) {
      return;
    }

    if (id) {
      launchDirectPlay(id, type, season, episode);
    }
  } else if (hash === '#mylist') {
    showMyList();
  } else if (hash === '#movies') {
    filterCategory('movie');
  } else if (hash === '#tv') {
    filterCategory('tv');
  } else if (hash === '#anime') {
    filterCategory('anime');
  } else if (hash === '#home') {
    showHome();
  } else if (hash.startsWith('#platforms') || hash.startsWith('#platform')) {
    // e.g. #platforms?id=8&type=movie or #platforms/8/movie
    let id = 8;
    let type = 'movie';
    if (hash.includes('?')) {
      const params = new URLSearchParams(hash.split('?')[1]);
      id = parseInt(params.get('id') || '8', 10);
      type = params.get('type') || 'movie';
    } else {
      const parts = hash.replace(/^#(platforms|platform)\/?/, '').split('/');
      if (parts[0]) id = parseInt(parts[0], 10);
      if (parts[1]) type = parts[1];
    }
    if (currentPlatformId !== id || currentPlatformType !== type) {
      selectPlatform(id, null, null, null, type);
    }
  }
}

async function launchDirectPlay(id, type, season = 1, episode = 1) {
  try {
    const res = await fetch(`/api/tmdb/${type}/${id}`);
    if (res.ok) {
      const data = await res.json();
      data.media_type = type;
      playMedia(data, season, episode);
    } else {
      // Fallback object if fetch delayed
      playMedia({ id, media_type: type, title: 'Streaming Media', name: 'Streaming Media' }, season, episode);
    }
  } catch (e) {
    playMedia({ id, media_type: type, title: 'Streaming Media', name: 'Streaming Media' }, season, episode);
  }
}

// ==========================================
// 2. DATA FETCHING & CAROUSELS
// ==========================================
async function loadAllRows() {
  // Load Hero with Demon Slayer Infinity Castle as default featured or top trending
  loadHeroBanner();

  // 1. Netflix Originals Row
  fetchAndRenderRow('/api/tmdb/discover/tv?with_networks=213&sort_by=popularity.desc', 'rowNetflix', 'tv');

  // 2. Anime Spotlight
  loadAnimeRow();

  // 3. Trending
  fetchAndRenderRow('/api/tmdb/trending/all/day', 'rowTrending');

  // 4. Movies
  fetchAndRenderRow('/api/tmdb/discover/movie?sort_by=popularity.desc', 'rowMovies', 'movie');

  // 5. TV Series
  fetchAndRenderRow('/api/tmdb/discover/tv?sort_by=popularity.desc', 'rowSeries', 'tv');

  // 6. Action
  fetchAndRenderRow('/api/tmdb/discover/movie?with_genres=28&sort_by=popularity.desc', 'rowAction', 'movie');

  // 7. Asian / K-Drama
  fetchAndRenderRow('/api/tmdb/discover/tv?with_original_language=ko&sort_by=popularity.desc', 'rowKdrama', 'tv');
}

// ==========================================
// STREAMING PLATFORMS & STUDIOS (Infinite Scroll Engine)
// Matches Ghostflix: https://ghostflix.st/platforms/8/movie
// ==========================================
const PLATFORMS_CONFIG = {
  8: {
    name: 'Netflix',
    logo: '/platform/Logonetflix.svg',
    gradient: 'linear-gradient(135deg, #870d10 0%, #300508 60%, #160203 100%)',
    color: '#E50914',
    tvNetwork: 213,
    providerId: 8
  },
  9: {
    name: 'Prime Video',
    logo: '/platform/Amazon_Prime_Video_logo.svg',
    gradient: 'linear-gradient(135deg, #0d3b61 0%, #06223b 60%, #021221 100%)',
    color: '#00A8E1',
    tvNetwork: 1024,
    providerId: 9
  },
  526: {
    name: 'AMC+',
    logo: '/platform/amclogo@2x.png',
    gradient: 'linear-gradient(135deg, #3d3016 0%, #251d0c 60%, #120e05 100%)',
    color: '#00D8C9',
    providerId: 526
  },
  350: {
    name: 'Apple TV+',
    logo: '/platform/Apple_TV_logo.svg',
    gradient: 'linear-gradient(135deg, #2b2b2b 0%, #181818 60%, #0d0d0d 100%)',
    color: '#FFFFFF',
    tvNetwork: 2552,
    providerId: 350
  },
  283: {
    name: 'Crunchyroll',
    logo: '/platform/crunchyroll.svg',
    gradient: 'linear-gradient(135deg, #613110 0%, #3d1e08 60%, #1f0f03 100%)',
    color: '#F47521',
    tvNetwork: 1112,
    providerId: 283,
    isAnime: true
  },
  337: {
    name: 'Disney+',
    logo: '/platform/Disney_logo.svg',
    gradient: 'linear-gradient(135deg, #163f96 0%, #0c2661 60%, #061436 100%)',
    color: '#113CCF',
    tvNetwork: 2739,
    providerId: 337
  },
  15: {
    name: 'Hulu',
    logo: '/platform/Hulu_logo_(2018).svg',
    gradient: 'linear-gradient(135deg, #074628 0%, #042a17 60%, #02160b 100%)',
    color: '#1CE783',
    tvNetwork: 453,
    providerId: 15
  },
  1899: {
    name: 'Max / HBO',
    logo: '/platform/hbo-logo.svg',
    gradient: 'linear-gradient(135deg, #3b1473 0%, #220947 60%, #110424 100%)',
    color: '#9933FF',
    tvNetwork: 49,
    providerId: 1899
  },
  99: {
    name: 'Paramount+',
    logo: '/platform/Paramount-_logo.svg',
    gradient: 'linear-gradient(135deg, #00368a 0%, #002257 60%, #001230 100%)',
    color: '#0064FF',
    tvNetwork: 4330,
    providerId: 99
  },
  387: {
    name: 'Peacock',
    logo: '/platform/peacock.svg',
    gradient: 'linear-gradient(135deg, #0a3d40 0%, #052527 60%, #021415 100%)',
    color: '#00DF89',
    tvNetwork: 3353,
    providerId: 387
  },
  585: {
    name: 'MGM+',
    logo: '/platform/mgm-logo.svg',
    gradient: 'linear-gradient(135deg, #4d3a0f 0%, #2f2207 60%, #171103 100%)',
    color: '#E0C479',
    providerId: 585
  },
  999: {
    name: 'Shudder',
    logo: '/platform/shudder.svg',
    gradient: 'linear-gradient(135deg, #400404 0%, #200202 60%, #0d0101 100%)',
    color: '#D40000',
    providerId: 99
  }
};

let currentPlatformId = null;
let currentPlatformType = 'movie'; // Default to 'movie' matching user's /platforms/8/movie link
let currentPlatformPage = 1;
let totalPlatformPages = 500;
let isPlatformLoading = false;
let loadedPlatformItemIds = new Set();
let platformObserver = null;
let isPlatformScrollListenerBound = false;

function scrollStudiosCarousel(direction) {
  const carousel = document.getElementById('studiosCarousel');
  if (!carousel) return;
  const scrollAmount = Math.max(300, Math.floor(carousel.clientWidth * 0.75)) * direction;
  carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
}

function initStudiosCarouselGestures() {
  const carousel = document.getElementById('studiosCarousel');
  if (!carousel || carousel._gesturesInitialized) return;
  carousel._gesturesInitialized = true;

  // Direct click & TV remote Enter-key listener on each studio card
  carousel.querySelectorAll('.studio-card').forEach(card => {
    card.style.cursor = 'pointer';
    card.onclick = (e) => {
      e.stopPropagation();
      const pid = card.getAttribute('data-platform-id');
      if (pid) {
        const id = parseInt(pid, 10);
        const title = card.getAttribute('title') || 'Platform';
        selectPlatform(id, card, title);
      }
    };
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault();
        card.click();
      }
    });
  });
}

async function selectPlatform(platformId, cardElement, title, brandColor, type) {
  const defaultRows = document.getElementById('defaultRowsContainer');
  const showcaseWrap = document.getElementById('platformShowcaseWrap');
  const resetBtn = document.getElementById('resetPlatformBtn');

  // Remove active from all studio cards and platform chips and clear inline style
  document.querySelectorAll('.studio-card, .platform-chip').forEach(c => {
    c.classList.remove('active');
    c.style.borderColor = '';
    c.style.boxShadow = '';
  });

  if (platformId === 'all') {
    currentPlatformId = null;
    if (resetBtn) resetBtn.classList.add('hidden');
    if (showcaseWrap) {
      showcaseWrap.classList.add('hidden');
      showcaseWrap.style.display = 'none';
    }
    if (defaultRows) {
      defaultRows.classList.remove('hidden');
      defaultRows.style.display = 'block';
    }
    window.location.hash = 'home';
    return;
  }

  const id = parseInt(platformId, 10);
  currentPlatformId = id;
  currentPlatformType = type || currentPlatformType || 'movie';
  currentPlatformPage = 1;
  totalPlatformPages = 500;
  isPlatformLoading = false;
  loadedPlatformItemIds.clear();

  // Lookup configuration
  const config = PLATFORMS_CONFIG[id] || {
    name: title || 'Platform Showcase',
    color: brandColor || '#E50914',
    gradient: 'linear-gradient(135deg, #1f1f1f 0%, #0d0d0d 100%)',
    logo: '/platform/Logonetflix.svg',
    providerId: id
  };

  // Find and mark active card strictly by exact data-platform-id
  const activeCard = cardElement || document.querySelector(`.studio-card[data-platform-id="${id}"]`);
  if (activeCard) {
    activeCard.classList.add('active');
    const accent = config.color || '#FFFFFF';
    activeCard.style.borderColor = accent;
    activeCard.style.boxShadow = `0 0 16px ${accent}90, 0 8px 24px rgba(0, 0, 0, 0.7)`;
  }

  if (resetBtn) resetBtn.classList.remove('hidden');

  // Update Header Banner
  const banner = document.getElementById('platformHeaderBanner');
  const bannerLogo = document.getElementById('platformBannerLogo');
  const titleEl = document.getElementById('platformShowcaseTitle');
  const countBadge = document.getElementById('platformCountBadge');
  const subtitleEl = document.getElementById('platformSubtitle');

  if (banner) banner.style.background = config.gradient;
  if (bannerLogo) bannerLogo.src = config.logo;
  if (titleEl) {
    titleEl.textContent = config.name;
    titleEl.style.color = '#FFFFFF';
  }
  if (countBadge) countBadge.textContent = 'Infinite Library';
  if (subtitleEl) subtitleEl.textContent = `Infinite catalog of ${config.name} titles • Scroll endlessly down`;

  // Update Type Filter Chips in Banner
  syncPlatformFilterChips();

  // Update hash route without causing scroll jump or hashchange loop
  const newHash = `#platforms?id=${id}&type=${currentPlatformType}`;
  if (window.location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }

  // Switch display: Hide default rows and show showcase with smooth scroll
  if (defaultRows) {
    defaultRows.classList.add('hidden');
    defaultRows.style.display = 'none';
  }
  if (showcaseWrap) {
    showcaseWrap.classList.remove('hidden');
    showcaseWrap.style.display = 'block';
    showcaseWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const grid = document.getElementById('platformShowcaseGrid');
  if (grid) grid.innerHTML = getSkeletonCards(12, true);

  const endMsg = document.getElementById('platformEndMessage');
  if (endMsg) endMsg.classList.add('hidden');

  // Load first page
  await loadPlatformPage(1, false);

  // Initialize infinite scroll observer & fallback
  setupPlatformInfiniteScroll();
}

function syncPlatformFilterChips() {
  const chipAll = document.getElementById('filterChipAll');
  const chipMovie = document.getElementById('filterChipMovie');
  const chipTv = document.getElementById('filterChipTv');

  [chipAll, chipMovie, chipTv].forEach(c => c && c.classList.remove('active'));

  if (currentPlatformType === 'movie' && chipMovie) chipMovie.classList.add('active');
  else if (currentPlatformType === 'tv' && chipTv) chipTv.classList.add('active');
  else if (chipAll) chipAll.classList.add('active');
}

async function applyPlatformTypeFilter(type, chip) {
  if (currentPlatformType === type) return;
  currentPlatformType = type;
  syncPlatformFilterChips();

  if (!currentPlatformId) return;

  // Update hash route
  window.location.hash = `platforms?id=${currentPlatformId}&type=${currentPlatformType}`;

  currentPlatformPage = 1;
  totalPlatformPages = 500;
  loadedPlatformItemIds.clear();

  const grid = document.getElementById('platformShowcaseGrid');
  if (grid) grid.innerHTML = getSkeletonCards(12, true);

  const endMsg = document.getElementById('platformEndMessage');
  if (endMsg) endMsg.classList.add('hidden');

  await loadPlatformPage(1, false);
}

/**
 * Fetch a specific page for the active platform and append or replace grid items.
 */
async function loadPlatformPage(page, append = false) {
  if (!currentPlatformId) return;
  isPlatformLoading = true;

  const id = currentPlatformId;
  const config = PLATFORMS_CONFIG[id] || { providerId: id };
  const loader = document.getElementById('platformInfiniteLoader');
  const grid = document.getElementById('platformShowcaseGrid');
  const countBadge = document.getElementById('platformCountBadge');
  const endMsg = document.getElementById('platformEndMessage');

  if (append && loader) loader.classList.remove('hidden');

  try {
    let items = [];

    // 1. Movie Query Builder
    const getMovieUrl = (p) => {
      if (id === 283) { // Crunchyroll anime movies
        return `/api/tmdb/discover/movie?with_genres=16&with_keywords=210024&sort_by=popularity.desc&page=${p}`;
      }
      return `/api/tmdb/discover/movie?with_watch_providers=${id}&watch_region=US&sort_by=popularity.desc&page=${p}`;
    };

    // 2. TV Series Query Builder
    const getTvUrl = (p) => {
      if (id === 283) { // Crunchyroll anime series
        return `/api/tmdb/discover/tv?with_genres=16&with_keywords=210024&sort_by=popularity.desc&page=${p}`;
      }
      if (config.tvNetwork) {
        return `/api/tmdb/discover/tv?with_networks=${config.tvNetwork}&sort_by=popularity.desc&page=${p}`;
      }
      return `/api/tmdb/discover/tv?with_watch_providers=${id}&watch_region=US&sort_by=popularity.desc&page=${p}`;
    };

    if (currentPlatformType === 'movie') {
      const res = await fetch(getMovieUrl(page)).then(r => r.ok ? r.json() : { results: [], total_pages: 1 });
      totalPlatformPages = Math.min(res.total_pages || 500, 500);
      items = (res.results || []).map(i => ({ ...i, media_type: 'movie' }));
    } else if (currentPlatformType === 'tv') {
      const res = await fetch(getTvUrl(page)).then(r => r.ok ? r.json() : { results: [], total_pages: 1 });
      totalPlatformPages = Math.min(res.total_pages || 500, 500);
      items = (res.results || []).map(i => ({ ...i, media_type: 'tv' }));
    } else {
      // 'all' mode: fetch both and interleave
      const [mRes, tRes] = await Promise.all([
        fetch(getMovieUrl(page)).then(r => r.ok ? r.json() : { results: [], total_pages: 1 }).catch(() => ({ results: [] })),
        fetch(getTvUrl(page)).then(r => r.ok ? r.json() : { results: [], total_pages: 1 }).catch(() => ({ results: [] }))
      ]);

      totalPlatformPages = Math.min(Math.max(mRes.total_pages || 1, tRes.total_pages || 1), 500);
      const mList = (mRes.results || []).map(i => ({ ...i, media_type: 'movie' }));
      const tList = (tRes.results || []).map(i => ({ ...i, media_type: 'tv' }));

      const maxLen = Math.max(mList.length, tList.length);
      for (let i = 0; i < maxLen; i++) {
        if (mList[i]) items.push(mList[i]);
        if (tList[i]) items.push(tList[i]);
      }
    }

    if (!append && grid) {
      grid.innerHTML = '';
    }

    // Append newly found items
    let addedCount = 0;
    if (grid) {
      items.forEach(item => {
        const key = `${item.media_type || 'm'}_${item.id}`;
        if (item.poster_path && !loadedPlatformItemIds.has(key)) {
          loadedPlatformItemIds.add(key);
          grid.appendChild(createMediaCard(item, true));
          addedCount++;
        }
      });
    }

    if (countBadge) {
      countBadge.textContent = `${loadedPlatformItemIds.size.toLocaleString()}+ Titles Loaded`;
    }

    if (page >= totalPlatformPages || items.length === 0) {
      if (endMsg) endMsg.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Failed to load platform page:', err);
    if (!append && grid) {
      grid.innerHTML = `<div class="col-span-full py-16 text-center text-neutral-400">Failed to load platform catalog. Please try again.</div>`;
    }
  } finally {
    if (loader) loader.classList.add('hidden');
    isPlatformLoading = false;
  }
}

/**
 * Loads the next page endlessly as the user scrolls down
 */
async function loadNextPlatformPage() {
  if (isPlatformLoading) return;
  if (!currentPlatformId) return;
  if (currentPlatformPage >= totalPlatformPages) return;

  currentPlatformPage++;
  await loadPlatformPage(currentPlatformPage, true);
}

/**
 * Setup IntersectionObserver + scroll fallback for Infinite Scrolling
 */
function setupPlatformInfiniteScroll() {
  const sentinel = document.getElementById('platformScrollSentinel');

  if (platformObserver) {
    platformObserver.disconnect();
    platformObserver = null;
  }

  if (sentinel && 'IntersectionObserver' in window) {
    platformObserver = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.isIntersecting && !isPlatformLoading && currentPlatformId) {
        loadNextPlatformPage();
      }
    }, {
      rootMargin: '600px 0px 600px 0px',
      threshold: 0.01
    });

    platformObserver.observe(sentinel);
  }

  // Fallback window scroll listener with throttle
  if (!isPlatformScrollListenerBound) {
    isPlatformScrollListenerBound = true;
    let throttleTimeout = null;
    window.addEventListener('scroll', () => {
      if (throttleTimeout) return;
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        if (!currentPlatformId || isPlatformLoading) return;
        const showcaseWrap = document.getElementById('platformShowcaseWrap');
        if (!showcaseWrap || showcaseWrap.classList.contains('hidden')) return;

        const scrollY = window.scrollY || window.pageYOffset;
        const viewportHeight = window.innerHeight;
        const totalHeight = document.documentElement.scrollHeight;

        // If user is within 700px of bottom, trigger next page
        if (scrollY + viewportHeight >= totalHeight - 700) {
          loadNextPlatformPage();
        }
      }, 150);
    }, { passive: true });
  }
}

async function loadHeroBanner() {
  try {
    // Default to Demon Slayer Infinity Castle (1311031)
    const res = await fetch('/api/tmdb/movie/1311031');
    if (res.ok) {
      const data = await res.json();
      data.media_type = 'movie';
      setHero(data);
      return;
    }
  } catch (e) {
    console.warn('Hero load error:', e);
  }

  // Fallback to trending
  try {
    const res2 = await fetch('/api/tmdb/trending/all/day');
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.results && data2.results.length > 0) {
        setHero(data2.results[0]);
      }
    }
  } catch (err) { }
}

function setHero(item) {
  heroMedia = item;
  const title = item.title || item.name || 'Demon Slayer: Kimetsu no Yaiba Infinity Castle';
  const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  const year = (item.release_date || item.first_air_date || '2025').substring(0, 4);
  const rating = (item.vote_average || 8.8).toFixed(1);
  const backdrop = (item.id === 1311031) ? '/images/demon-slayer-hero.jpg' : (item.backdrop_path ? `${TMDB_IMAGE_BASE}${BACKDROP_SIZE}${item.backdrop_path}` : '/images/demon-slayer-hero.jpg');

  document.getElementById('heroTitle').textContent = title;
  document.getElementById('heroOverview').textContent = item.overview || 'The Demon Slayer Corps are drawn into the Infinity Castle, where Tanjiro, Nezuko, and the Hashira face terrifying Upper Rank demons in a desperate final fight against Muzan Kibutsuji.';
  document.getElementById('heroYear').textContent = year;
  document.getElementById('heroRating').innerHTML = `<i class="fa-solid fa-star text-xs"></i> ${rating}`;
  document.getElementById('heroTypeBadge').textContent = type.toUpperCase();

  const heroImg = document.getElementById('heroBackdropImg');
  if (heroImg) {
    heroImg.src = backdrop;
  }
  const heroBg = document.getElementById('heroBackdrop');
  if (heroBg) {
    heroBg.style.backgroundImage = `url('${backdrop}')`;
  }

  updateHeroWatchlistBtn();
}

async function loadAnimeRow() {
  const container = document.getElementById('rowAnime');
  if (!container) return;
  container.innerHTML = getSkeletonCards(6);

  try {
    const promises = CURATED_ANIME_IDS.map(async (anime) => {
      try {
        const r = await fetch(`/api/tmdb/${anime.type}/${anime.id}`);
        if (r.ok) {
          const d = await r.json();
          d.media_type = anime.type;
          return d;
        }
      } catch (_) { }
      return null;
    });

    const items = (await Promise.all(promises)).filter(Boolean);
    if (items.length > 0) {
      renderCardsToContainer(items, container);
    } else {
      fetchAndRenderRow('/api/tmdb/discover/tv?with_genres=16&sort_by=popularity.desc', 'rowAnime', 'tv');
    }
  } catch (e) {
    fetchAndRenderRow('/api/tmdb/discover/tv?with_genres=16&sort_by=popularity.desc', 'rowAnime', 'tv');
  }
}

async function fetchAndRenderRow(endpoint, elementId, defaultType = null) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = getSkeletonCards(6);

  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    let results = data.results || [];

    if (defaultType) {
      results = results.map(i => ({ ...i, media_type: i.media_type || defaultType }));
    }

    renderCardsToContainer(results, container);
  } catch (err) {
    console.error(`Error loading row ${elementId}:`, err);
    container.innerHTML = `<p class="text-xs text-neutral-500 py-4">Unable to load titles right now.</p>`;
  }
}

function renderCardsToContainer(items, container) {
  container.innerHTML = '';
  items.forEach(item => {
    if (!item.poster_path) return;
    const card = createMediaCard(item);
    container.appendChild(card);
  });
}

function createMediaCard(item, isGrid = false) {
  const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
  const posterUrl = `${TMDB_IMAGE_BASE}${POSTER_SIZE}${item.poster_path}`;

  const el = document.createElement('div');
  el.tabIndex = 0;
  el.className = isGrid
    ? 'media-card w-full aspect-[2/3] tv-focusable'
    : 'media-card w-36 sm:w-44 md:w-48 lg:w-52 aspect-[2/3] flex-shrink-0 tv-focusable';

  // Direct card click opens video player immediately!
  el.onclick = (e) => {
    if (e && e.target && e.target.closest('.quick-wl-btn')) return;
    playMedia(item, 1, 1);
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      playMedia(item, 1, 1);
    }
  });

  el.innerHTML = `
    <img src="${posterUrl}" alt="${title}" loading="lazy" onerror="this.src='https://via.placeholder.com/300x450/111/fff?text=No+Poster'">
    <div class="card-overlay">
      <div class="flex items-center justify-between mb-2">
        <button class="quick-play-btn tv-focusable" title="Play Now">
          <i class="fa-solid fa-play ml-0.5"></i>
        </button>
        <button class="quick-wl-btn w-8 h-8 rounded-full border border-neutral-600 bg-neutral-900/80 hover:bg-neutral-800 text-white flex items-center justify-center text-xs transition" title="Watchlist">
          <i class="${isInWatchlist(item.id) ? 'fa-solid fa-check text-red-500' : 'fa-solid fa-plus'}"></i>
        </button>
      </div>
      <h4 class="font-bold text-xs sm:text-sm text-white line-clamp-1">${title}</h4>
      <div class="flex items-center space-x-2 text-[10px] sm:text-xs text-neutral-300 mt-0.5">
        ${rating ? `<span class="text-amber-400 font-bold flex items-center gap-0.5"><i class="fa-solid fa-star text-[10px]"></i> ${rating}</span>` : ''}
        ${year ? `<span>${year}</span>` : ''}
        <span class="uppercase text-[9px] px-1 py-0.2 bg-neutral-800 rounded font-semibold text-neutral-400">${type}</span>
      </div>
    </div>
  `;

  const playBtn = el.querySelector('.quick-play-btn');
  if (playBtn) {
    playBtn.onclick = (e) => {
      e.stopPropagation();
      playMedia(item, 1, 1);
    };
  }
  const wlBtn = el.querySelector('.quick-wl-btn');
  if (wlBtn) {
    wlBtn.onclick = (e) => {
      e.stopPropagation();
      toggleWatchlist(item, wlBtn);
    };
  }

  return el;
}

function getSkeletonCards(count = 6, isGrid = false) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += isGrid
      ? `<div class="w-full aspect-[2/3] rounded-lg shimmer"></div>`
      : `<div class="w-36 sm:w-44 md:w-48 lg:w-52 aspect-[2/3] rounded-lg shimmer flex-shrink-0"></div>`;
  }
  return html;
}

// ==========================================
// 3. SEARCH & FILTERS
// ==========================================
function initSearch() {
  const input = document.getElementById('searchInput');
  const mobInput = document.getElementById('mobileSearchInput');

  const handleSearch = (val) => {
    clearTimeout(searchTimeout);
    if (!val || val.trim().length === 0) {
      closeSearch();
      return;
    }

    document.getElementById('clearSearchBtn').classList.remove('hidden');

    searchTimeout = setTimeout(async () => {
      await performSearch(val.trim());
    }, 350);
  };

  input.addEventListener('input', (e) => handleSearch(e.target.value));
  mobInput.addEventListener('input', (e) => {
    input.value = e.target.value;
    handleSearch(e.target.value);
  });
}

function toggleSearchInput() {
  const container = document.getElementById('mobileSearchWrap');
  const heroBtn = document.getElementById('heroSearchBtn');
  container.classList.toggle('hidden');
  const mobInput = document.getElementById('mobileSearchInput');
  if (!container.classList.contains('hidden')) {
    if (heroBtn) heroBtn.classList.add('hidden');
    setTimeout(() => { mobInput.focus(); }, 50);
  } else {
    if (heroBtn) heroBtn.classList.remove('hidden');
    closeSearch();
  }
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('mobileSearchInput').value = '';
  document.getElementById('clearSearchBtn').classList.add('hidden');
  closeSearch();
}

function closeSearch() {
  const mobWrap = document.getElementById('mobileSearchWrap');
  if (mobWrap) {
    mobWrap.classList.add('hidden');
    mobWrap.style.display = 'none';
  }
  const heroBtn = document.getElementById('heroSearchBtn');
  if (heroBtn) {
    heroBtn.classList.remove('hidden');
    heroBtn.style.display = '';
  }
  const searchSec = document.getElementById('searchResultsSection');
  if (searchSec) {
    searchSec.classList.add('hidden');
    searchSec.style.display = 'none';
  }
  const mainCont = document.getElementById('mainContent');
  if (mainCont) {
    mainCont.classList.remove('hidden');
    mainCont.style.display = 'block';
  }
  const myListSec = document.getElementById('myListSection');
  if (myListSec) {
    myListSec.classList.add('hidden');
    myListSec.style.display = 'none';
  }
}

async function performSearch(query) {
  const searchSec = document.getElementById('searchResultsSection');
  searchSec.classList.remove('hidden');
  searchSec.style.display = 'block';

  const mainCont = document.getElementById('mainContent');
  mainCont.classList.add('hidden');
  mainCont.style.display = 'none';

  const myListSec = document.getElementById('myListSection');
  myListSec.classList.add('hidden');
  myListSec.style.display = 'none';

  document.getElementById('searchQueryLabel').textContent = `Showing results for "${query}"`;

  const grid = document.getElementById('searchResultsGrid');
  const empty = document.getElementById('searchEmptyState');
  grid.innerHTML = getSkeletonCards(12, true);
  empty.classList.add('hidden');
  empty.style.display = 'none';

  try {
    const cleanQuery = query.trim();
    let res = await fetch(`/api/tmdb/search/multi?query=${encodeURIComponent(cleanQuery)}`);
    if (!res.ok) throw new Error('Search failed');
    let data = await res.json();
    let results = (data.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');

    // Fallback 1: trailing 1 (e.g. stree1 -> stree)
    if (results.length === 0 && /1$/.test(cleanQuery)) {
      const q1 = cleanQuery.replace(/1$/, '').trim();
      const res1 = await fetch(`/api/tmdb/search/multi?query=${encodeURIComponent(q1)}`);
      if (res1.ok) {
        const d1 = await res1.json();
        const r1 = (d1.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');
        if (r1.length > 0) results = r1;
      }
    }

    // Fallback 2: letter+digit without space (e.g. stree2 -> stree 2, kgf2 -> kgf 2)
    if (results.length === 0 && /([a-zA-Z]+)(\d+)/.test(cleanQuery)) {
      const q2 = cleanQuery.replace(/([a-zA-Z]+)(\d+)/g, '$1 $2').trim();
      const res2 = await fetch(`/api/tmdb/search/multi?query=${encodeURIComponent(q2)}`);
      if (res2.ok) {
        const d2 = await res2.json();
        const r2 = (d2.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');
        if (r2.length > 0) results = r2;
      }
    }

    window.lastSearchResults = results;
    renderFilteredSearch();
  } catch (e) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    empty.style.display = 'block';
  }
}

function applySearchFilter(filter, chip) {
  currentFilter = filter;
  document.querySelectorAll('.search-filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  renderFilteredSearch();
}

function renderFilteredSearch() {
  const grid = document.getElementById('searchResultsGrid');
  const empty = document.getElementById('searchEmptyState');
  const allResults = window.lastSearchResults || [];

  let filtered = allResults;
  if (currentFilter === 'movie') {
    filtered = allResults.filter(i => i.media_type === 'movie');
  } else if (currentFilter === 'tv') {
    filtered = allResults.filter(i => i.media_type === 'tv');
  } else if (currentFilter === 'anime') {
    // anime usually has genre 16 (Animation) and Japanese origin
    filtered = allResults.filter(i => (i.genre_ids && i.genre_ids.includes(16)) || i.original_language === 'ja');
  }

  grid.innerHTML = '';
  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    empty.style.display = 'block';
  } else {
    empty.classList.add('hidden');
    empty.style.display = 'none';
    filtered.forEach(item => {
      if (item.poster_path) {
        grid.appendChild(createMediaCard(item, true));
      }
    });
  }
}

// ==========================================
// 4. STREAMING PLAYER & SERVER SWITCHER
// ==========================================
/**
 * Opens fullscreen player for media.
 * Supports:
 * 1. VidBolt (Primary - exact server matching user's photo with Orion/Quasar/Vega/Callisto/Quantum)
 * 2. VidLink (Multi-Audio & Multi-Subtitles)
 * 3. VidSrc CC
 * 4. AutoEmbed
 * 5. SuperEmbed
 */
function playMedia(item, season = 1, episode = 1) {
  // Close details modal if open
  closeDetailsModal();

  // Hide search bar & blur input so keyboard/search overlay disappears immediately
  const mobWrap = document.getElementById('mobileSearchWrap');
  if (mobWrap) mobWrap.classList.add('hidden');
  const mobInput = document.getElementById('mobileSearchInput');
  if (mobInput) mobInput.blur();
  const mainInput = document.getElementById('searchInput');
  if (mainInput) mainInput.blur();
  const heroBtn = document.getElementById('heroSearchBtn');
  if (heroBtn) heroBtn.classList.remove('hidden');

  const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  const id = item.id;
  const title = item.title || item.name || 'Playing Video';

  currentPlaying = {
    id,
    type,
    title,
    season,
    episode,
    item
  };

  const modal = document.getElementById('playerModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.zIndex = '9999';
  document.body.classList.add('overflow-hidden');

  document.getElementById('playerMediaTitle').textContent = title;
  const epInfo = document.getElementById('playerEpisodeInfo');
  const tvSection = document.getElementById('playerTvNavSection');
  const currentEpBadge = document.getElementById('playerCurrentEpBadge');

  if (type === 'tv') {
    epInfo.textContent = `Season ${season} • Episode ${episode}`;
    if (tvSection) tvSection.classList.remove('hidden');
    if (currentEpBadge) currentEpBadge.textContent = `S${season} E${episode}`;
    populatePlayerSeasons(item, season);
  } else {
    epInfo.textContent = `Movie`;
    if (tvSection) tvSection.classList.add('hidden');
  }

  // Populate media info card below video
  const yearEl = document.getElementById('playerMetaYear');
  if (yearEl) yearEl.textContent = (item.release_date || item.first_air_date || '2025').slice(0, 4);

  const ratingEl = document.getElementById('playerMetaRating');
  if (ratingEl) ratingEl.innerHTML = `<i class="fa-solid fa-star text-[10px]"></i> ${item.vote_average ? item.vote_average.toFixed(1) : '8.8'}`;

  const genresEl = document.getElementById('playerMetaGenres');
  if (genresEl) genresEl.textContent = (item.genres || []).map(g => g.name).join(', ') || (type === 'tv' ? 'TV Series' : 'Movie');

  const overviewEl = document.getElementById('playerMetaOverview');
  if (overviewEl) overviewEl.textContent = item.overview || 'Enjoy high-speed streaming in HD with multi-language audio and subtitles on PlayMax.';

  const engineSel = document.getElementById('playerEngineSelect');
  if (engineSel) engineSel.value = playerEngine;

  // Update hash route safely without triggering hashchange loop crash
  const newHash = type === 'tv'
    ? `#play?id=${id}&type=tv&season=${season}&episode=${episode}`
    : `#play?id=${id}&type=movie`;
  if (window.location.hash !== newHash) {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', newHash);
    } else {
      window.location.hash = newHash;
    }
  }

  // Launch playback via chosen engine
  startPlayback();
}

async function populatePlayerSeasons(show, activeSeason) {
  const select = document.getElementById('playerSeasonSelect');
  if (!select) return;
  select.innerHTML = '';

  let seasons = show.seasons;
  if (!seasons || seasons.length === 0) {
    try {
      const res = await fetch(`/api/tmdb/tv/${show.id}`);
      if (res.ok) {
        const full = await res.json();
        seasons = full.seasons || [];
        show.seasons = seasons;
      }
    } catch (_) { }
  }

  const validSeasons = (seasons || []).filter(s => s.season_number > 0);
  validSeasons.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.season_number;
    opt.textContent = `${s.name || 'Season ' + s.season_number} (${s.episode_count || ''} eps)`;
    if (s.season_number === Number(activeSeason)) opt.selected = true;
    select.appendChild(opt);
  });
}

function onPlayerSeasonChanged(seasonNum) {
  if (!currentPlaying) return;
  playMedia(currentPlaying.item, Number(seasonNum), 1);
}

function changePlayerEngine(engine) {
  playerEngine = engine;
  startPlayback();
}

async function startPlayback() {
  if (!currentPlaying) return;
  const { id, type, season, episode } = currentPlaying;

  if (playerEngine === 'custom') {
    await loadCustomPlayer(id, type, season, episode);
  } else {
    loadEmbedPlayer();
  }
}

/**
 * 100% Rock-Solid Video Player (Native HTML5 Video + HLS.js + Smart TV Hardware Acceleration)
 * Zero CDN crashes, zero popup redirects, 60fps native TV remote D-Pad controls
 */
async function loadCustomPlayer(id, type, season, episode, savedTime = 0) {
  const container = document.getElementById('artplayerContainer');
  const nativeVid = document.getElementById('nativePlayerVideo');
  const iframe = document.getElementById('videoIframe');

  if (iframe) {
    iframe.classList.add('hidden');
    iframe.style.display = 'none';
    iframe.src = '';
  }

  // Stop any previous active streams
  if (window.activeHls) {
    try { window.activeHls.destroy(); } catch (_) { }
    window.activeHls = null;
  }
  if (artPlayerInstance) {
    try { artPlayerInstance.destroy(false); } catch (e) { }
    artPlayerInstance = null;
  }
  if (nativeVid) {
    nativeVid.pause();
    nativeVid.src = '';
  }

  // Show loading indicator in player stage
  if (container) {
    container.classList.remove('hidden');
    container.style.display = 'flex';
    container.style.zIndex = '20';
    container.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center bg-black text-neutral-300 gap-3">
        <div class="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-semibold tracking-wide">Connecting to High-Speed Stream...</p>
      </div>
    `;
  }

  try {
    let resolveUrl = `/api/resolve?type=${type}&id=${id}&server=${encodeURIComponent(currentStreamServer)}`;
    if (type === 'tv' && season && episode) {
      resolveUrl += `&season=${season}&episode=${episode}`;
    }

    const res = await fetch(resolveUrl);
    if (!res.ok) throw new Error('Stream resolve failed');
    const data = await res.json();
    const stream = data.stream;

    if (!stream || !stream.sources || stream.sources.length === 0) {
      throw new Error('No stream sources found');
    }

    const selectedSource = stream.sources[0];
    const streamUrl = selectedSource.url;

    // Stream ready: hide loader and display native video player
    if (container) {
      container.innerHTML = '';
      container.classList.add('hidden');
      container.style.display = 'none';
    }

    if (nativeVid) {
      nativeVid.classList.remove('hidden');
      nativeVid.style.display = 'block';
      nativeVid.style.zIndex = '20';

      if (nativeVid.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS (Safari, iOS, TV browsers with native HLS)
        nativeVid.src = streamUrl;
        if (savedTime > 0) nativeVid.currentTime = savedTime;
        nativeVid.play().catch(() => { });
      } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false, // Disabling worker prevents low-RAM Smart TV crashes
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(nativeVid);
        window.activeHls = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (savedTime > 0) nativeVid.currentTime = savedTime;
          nativeVid.play().catch(() => { });
        });

        hls.on(Hls.Events.ERROR, (event, errData) => {
          if (errData && errData.fatal) {
            console.warn('[HLS Fatal Error] Switching to embed:', errData.type);
            loadEmbedPlayer();
          }
        });
      } else {
        nativeVid.src = streamUrl;
        nativeVid.play().catch(() => { });
      }
    }

    showToast('Playing via Direct Stream (No Ads)');
  } catch (err) {
    console.warn('Custom player fallback to embed:', err);
    loadEmbedPlayer();
  }
}

function loadEmbedPlayer() {
  if (artPlayerInstance) {
    try { artPlayerInstance.destroy(false); } catch (e) { }
    artPlayerInstance = null;
  }
  if (window.activeHls) {
    try { window.activeHls.destroy(); } catch (_) { }
    window.activeHls = null;
  }
  const nativeVid = document.getElementById('nativePlayerVideo');
  if (nativeVid) {
    nativeVid.pause();
    nativeVid.src = '';
    nativeVid.classList.add('hidden');
    nativeVid.style.display = 'none';
  }
  const artContainer = document.getElementById('artplayerContainer');
  if (artContainer) {
    artContainer.classList.add('hidden');
    artContainer.style.display = 'none';
  }
  const iframe = document.getElementById('videoIframe');
  if (iframe) {
    iframe.classList.remove('hidden');
    iframe.style.display = 'block';
    iframe.style.zIndex = '20';
  }
  updateIframeSource();
}

function updateIframeSource() {
  if (!currentPlaying) return;
  const audio = safeGetItem('ghostflix_audio_pref', 'hindi');
  const { id, type, season, episode } = currentPlaying;
  const iframe = document.getElementById('videoIframe');
  if (!iframe) return;

  let streamUrl = '';
  const engine = playerEngine || 'vidlink';

  if (engine === 'vidbolt') {
    let audioParam = audio && audio !== 'default' ? `&audio=${encodeURIComponent(audio)}` : '';
    streamUrl = type === 'tv'
      ? `https://vidbolt.pro/tv/${id}/${season}/${episode}?theme=E50914&autoPlay=true&mobileSheets=true${audioParam}`
      : `https://vidbolt.pro/movie/${id}?theme=E50914&autoPlay=true&mobileSheets=true${audioParam}`;
  } else if (engine === 'vidsrc') {
    streamUrl = type === 'tv'
      ? `https://vidsrc.xyz/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`
      : `https://vidsrc.xyz/embed/movie?tmdb=${id}`;
  } else if (engine === 'autoembed') {
    streamUrl = type === 'tv'
      ? `https://player.autoembed.cc/embed/tv/${id}/${season}/${episode}`
      : `https://player.autoembed.cc/embed/movie/${id}`;
  } else {
    // VidLink: 100% live, fast JWPlayer streaming with Hindi/English audio & subtitles!
    streamUrl = type === 'tv'
      ? `https://vidlink.pro/tv/${id}/${season}/${episode}?primaryColor=e50914&autoplay=true`
      : `https://vidlink.pro/movie/${id}?primaryColor=e50914&autoplay=true`;
  }

  iframe.src = streamUrl;
}

// ==========================================
// QUALITY & SERVER BOTTOM SHEET LOGIC
// ==========================================
function renderQualitySheet() {
  const list = document.getElementById('qualityOptionsList');
  if (!list) return;

  const autoActive = currentQualityLevel === -1;
  let activeResLabel = 'Auto';
  if (autoActive && artPlayerInstance && artPlayerInstance.hls && artPlayerInstance.hls.currentLevel !== -1) {
    const lvl = artPlayerInstance.hls.levels[artPlayerInstance.hls.currentLevel];
    if (lvl) activeResLabel = `${lvl.height || 720}p`;
  }

  let html = `
    <button onclick="selectQualityLevel(-1)" class="sheet-option-btn ${autoActive ? 'active' : ''}">
      <div class="flex items-center gap-2">
        ${autoActive ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
        <div>
          <div class="font-bold">Auto</div>
          <div class="text-[10px] text-neutral-400 font-normal">${activeResLabel}</div>
        </div>
      </div>
    </button>
  `;

  const standardQualities = [
    { label: '1080p', desc: 'Full HD', height: 1080 },
    { label: '720p', desc: 'HD', height: 720 },
    { label: '480p', desc: 'SD', height: 480 }
  ];

  standardQualities.forEach(q => {
    let targetIdx = -1;
    if (currentHlsLevels && currentHlsLevels.length > 0) {
      targetIdx = currentHlsLevels.findIndex(l => {
        if (q.height === 1080) return l.height >= 1000;
        if (q.height === 720) return l.height >= 700 && l.height < 1000;
        if (q.height === 480) return l.height < 700;
        return false;
      });
    }

    const isActive = currentQualityLevel === targetIdx && targetIdx !== -1;
    html += `
      <button onclick="selectQualityLevel(${targetIdx}, '${q.label}')" class="sheet-option-btn ${isActive ? 'active' : ''}">
        <div class="flex items-center gap-2">
          ${isActive ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
          <div>
            <div class="font-bold">${q.label}</div>
            <div class="text-[10px] text-neutral-400 font-normal">${q.desc}</div>
          </div>
        </div>
      </button>
    `;
  });

  list.innerHTML = html;
}

function selectQualityLevel(levelIdx, label) {
  currentQualityLevel = levelIdx;
  if (artPlayerInstance && artPlayerInstance.hls) {
    artPlayerInstance.hls.currentLevel = levelIdx;
  }
  renderQualitySheet();
  showToast(levelIdx === -1 ? 'Quality: Auto' : `Quality: ${label || 'Manual'}`);
}

function renderServerSheet() {
  const list = document.getElementById('serverOptionsList');
  if (!list) return;

  let html = '';
  STREAM_SERVERS.forEach(srv => {
    const isSelected = currentStreamServer === srv.id;
    const isFav = favoriteServers.includes(srv.id);

    html += `
      <div class="sheet-option-btn ${isSelected ? 'active' : ''}" onclick="selectStreamServer('${srv.id}')">
        <div class="flex items-center gap-2 truncate">
          ${isSelected ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
          <span class="text-sm">${srv.flag}</span>
          <span class="font-semibold truncate">${srv.name}</span>
        </div>
        <button type="button" class="sheet-server-heart ${isFav ? 'favorited' : 'text-neutral-500 hover:text-red-400'}" 
                onclick="event.stopPropagation(); toggleServerFavorite('${srv.id}')" title="Favorite Server">
          <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
        </button>
      </div>
    `;
  });

  list.innerHTML = html;
}

function selectStreamServer(serverId) {
  if (currentStreamServer === serverId) return;
  currentStreamServer = serverId;
  safeSetItem('ghostflix_server_pref', serverId);
  renderServerSheet();
  const srv = STREAM_SERVERS.find(s => s.id === serverId);
  showToast(`Server: ${srv ? srv.name + ' ' + srv.flag : serverId}`);

  if (currentPlaying) {
    const savedTime = artPlayerInstance ? artPlayerInstance.currentTime : 0;
    loadCustomPlayer(currentPlaying.id, currentPlaying.type, currentPlaying.season, currentPlaying.episode, savedTime);
  }
}

function toggleServerFavorite(serverId) {
  if (favoriteServers.includes(serverId)) {
    favoriteServers = favoriteServers.filter(s => s !== serverId);
  } else {
    favoriteServers.push(serverId);
  }
  safeSetItem('ghostflix_fav_servers', JSON.stringify(favoriteServers));
  renderServerSheet();
}

// ==========================================
// AUDIO & SUBTITLES BOTTOM SHEET LOGIC
// ==========================================
function renderAudioSheet() {
  const list = document.getElementById('audioOptionsList');
  if (!list) return;

  if (!currentAudioTracks || currentAudioTracks.length === 0) {
    list.innerHTML = `<div class="text-xs text-neutral-500 py-3 text-center">Loading audio tracks...</div>`;
    return;
  }

  let html = '';
  currentAudioTracks.forEach((track, idx) => {
    const isSelected = idx === currentAudioTrackIndex;
    const flag = getLanguageFlag(track.name, track.lang);
    let displayName = track.name || track.lang || `Track ${idx + 1}`;
    displayName = displayName.replace(/^\d+\.\s*/, '');

    html += `
      <button onclick="selectAudioTrack(${idx})" class="sheet-option-btn ${isSelected ? 'active' : ''}">
        <div class="flex items-center gap-2 truncate">
          ${isSelected ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
          <span class="text-sm">${flag}</span>
          <span class="truncate">${displayName}</span>
        </div>
      </button>
    `;
  });

  list.innerHTML = html;
}

function selectAudioTrack(idx) {
  if (artPlayerInstance && artPlayerInstance.hls) {
    const hls = artPlayerInstance.hls;
    if (hls.audioTracks && hls.audioTracks[idx]) {
      hls.audioTrack = idx;
      currentAudioTrackIndex = idx;
      const t = hls.audioTracks[idx];
      let cleanName = (t.name || t.lang || '').replace(/^\d+\.\s*/, '');
      const flag = getLanguageFlag(t.name, t.lang);
      if (cleanName.toLowerCase().includes('hindi')) safeSetItem('ghostflix_audio_pref', 'hindi');
      else if (cleanName.toLowerCase().includes('english')) safeSetItem('ghostflix_audio_pref', 'english');
      else if (cleanName.toLowerCase().includes('japanese')) safeSetItem('ghostflix_audio_pref', 'japanese');
      renderAudioSheet();
      showToast(`Audio: ${cleanName} ${flag}`);
    }
  }
}

function renderSubtitlesSheet() {
  const list = document.getElementById('subtitlesOptionsList');
  if (!list) return;

  const isOff = currentSubtitleIndex === -1;
  let html = `
    <button onclick="selectSubtitleTrack(-1)" class="sheet-option-btn ${isOff ? 'active' : ''}">
      <div class="flex items-center gap-2">
        ${isOff ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
        <span>Off</span>
      </div>
    </button>
  `;

  if (currentSubtitleTracks && currentSubtitleTracks.length > 0) {
    currentSubtitleTracks.forEach((sub, idx) => {
      const isSelected = idx === currentSubtitleIndex;
      const flag = getLanguageFlag(sub.name || sub.label, sub.lang);
      const name = sub.name || sub.label || sub.lang || `Sub ${idx + 1}`;

      html += `
        <button onclick="selectSubtitleTrack(${idx})" class="sheet-option-btn ${isSelected ? 'active' : ''}">
          <div class="flex items-center gap-2 truncate">
            ${isSelected ? '<i class="fa-solid fa-check text-red-500 text-xs flex-shrink-0"></i>' : '<span class="w-3 flex-shrink-0"></span>'}
            <span class="text-sm">${flag}</span>
            <span class="truncate">${name}</span>
          </div>
        </button>
      `;
    });
  }

  list.innerHTML = html;
}

function selectSubtitleTrack(idx) {
  currentSubtitleIndex = idx;
  if (idx === -1) {
    if (artPlayerInstance) {
      if (artPlayerInstance.hls) artPlayerInstance.hls.subtitleTrack = -1;
      artPlayerInstance.subtitle.show = false;
    }
    renderSubtitlesSheet();
    showToast('Subtitles: Off');
    return;
  }

  if (artPlayerInstance) {
    if (artPlayerInstance.hls && artPlayerInstance.hls.subtitleTracks && artPlayerInstance.hls.subtitleTracks[idx]) {
      artPlayerInstance.hls.subtitleTrack = idx;
      artPlayerInstance.hls.subtitleDisplay = true;
      const sub = artPlayerInstance.hls.subtitleTracks[idx];
      renderSubtitlesSheet();
      showToast(`Subtitles: ${sub.name || sub.lang}`);
    } else if (currentSubtitleTracks && currentSubtitleTracks[idx] && currentSubtitleTracks[idx].url) {
      const sub = currentSubtitleTracks[idx];
      artPlayerInstance.subtitle.switch(sub.url, { name: sub.name || sub.label });
      artPlayerInstance.subtitle.show = true;
      renderSubtitlesSheet();
      showToast(`Subtitles: ${sub.name || sub.label}`);
    }
  }
}

// Bottom sheet modals open/close
function openPlayerSettingsSheet() {
  document.getElementById('playerAudioSubsSheet').classList.add('hidden');
  document.getElementById('playerSettingsSheet').classList.remove('hidden');
  renderQualitySheet();
  renderServerSheet();
}

function closePlayerSettingsSheet() {
  document.getElementById('playerSettingsSheet').classList.add('hidden');
}

function openPlayerAudioSubsSheet() {
  document.getElementById('playerSettingsSheet').classList.add('hidden');
  document.getElementById('playerAudioSubsSheet').classList.remove('hidden');
  renderAudioSheet();
  renderSubtitlesSheet();
}

function closePlayerAudioSubsSheet() {
  document.getElementById('playerAudioSubsSheet').classList.add('hidden');
}

function switchToAudioSubsSheet() {
  closePlayerSettingsSheet();
  openPlayerAudioSubsSheet();
}

function switchToSettingsSheet() {
  closePlayerAudioSubsSheet();
  openPlayerSettingsSheet();
}

// ==========================================
// OFFICIAL YOUTUBE TRAILER MODAL LOGIC
// ==========================================
async function openTrailerModal() {
  if (!currentPlaying) return;
  const { id, type, title } = currentPlaying;

  if (artPlayerInstance && artPlayerInstance.playing) {
    artPlayerInstance.pause();
  }

  const modal = document.getElementById('playerTrailerModal');
  const iframe = document.getElementById('trailerIframe');
  const trailerTitle = document.getElementById('trailerTitle');
  trailerTitle.innerHTML = `<i class="fa-brands fa-youtube text-red-500 text-base"></i> ${title} — Trailer`;
  iframe.src = '';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/tmdb/${type}/${id}/videos`);
    if (res.ok) {
      const data = await res.json();
      const videos = data.results || [];
      const trailer = videos.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')) ||
        videos.find(v => v.site === 'YouTube');
      if (trailer && trailer.key) {
        iframe.src = `https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0`;
        return;
      }
    }
  } catch (e) {
    console.error('Trailer fetch error:', e);
  }

  showToast('No official YouTube trailer available for this title');
}

function closeTrailerModal() {
  const modal = document.getElementById('playerTrailerModal');
  const iframe = document.getElementById('trailerIframe');
  modal.classList.add('hidden');
  iframe.src = '';

  if (artPlayerInstance) {
    artPlayerInstance.play().catch(() => { });
  }
}

function playAdjacentEpisode(direction) {
  if (!currentPlaying || currentPlaying.type !== 'tv') return;
  const nextEp = currentPlaying.episode + direction;
  if (nextEp < 1) return;

  playMedia(currentPlaying.item, currentPlaying.season, nextEp);
}

function closePlayerModal() {
  const modal = document.getElementById('playerModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  closePlayerSettingsSheet();
  closePlayerAudioSubsSheet();
  closeTrailerModal();

  const nativeVid = document.getElementById('nativePlayerVideo');
  if (nativeVid) {
    nativeVid.pause();
    nativeVid.src = '';
    nativeVid.classList.add('hidden');
    nativeVid.style.display = 'none';
  }
  if (window.activeHls) {
    try { window.activeHls.destroy(); } catch (_) { }
    window.activeHls = null;
  }
  if (artPlayerInstance) {
    try { artPlayerInstance.destroy(false); } catch (e) { }
    artPlayerInstance = null;
  }
  const iframe = document.getElementById('videoIframe');
  if (iframe) {
    iframe.src = '';
    iframe.classList.add('hidden');
    iframe.style.display = 'none';
  }
  document.body.classList.remove('overflow-hidden');
  currentPlaying = null;
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    window.location.hash = '';
  }
}

function togglePlayerFullscreen() {
  const modal = document.getElementById('playerModal');
  if (!document.fullscreenElement) {
    modal.requestFullscreen().catch(err => console.error(err));
  } else {
    document.exitFullscreen().catch(err => console.error(err));
  }
}

// ==========================================
// 5. DETAILS & EPISODE SELECTOR MODAL
// ==========================================
let currentModalItem = null;

function onModalPlayClicked(e) {
  if (e) { try { e.preventDefault(); e.stopPropagation(); } catch (_) { } }
  if (currentModalItem) {
    const itm = currentModalItem;
    closeDetailsModal();
    playMedia(itm, 1, 1);
  }
}

function openDetailsModal(item) {
  const mobWrap = document.getElementById('mobileSearchWrap');
  if (mobWrap) {
    mobWrap.classList.add('hidden');
    mobWrap.style.display = 'none';
  }
  const mobInput = document.getElementById('mobileSearchInput');
  if (mobInput) mobInput.blur();

  currentModalItem = item;
  const type = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  const id = item.id;
  const modal = document.getElementById('detailsModal');

  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').substring(0, 4);
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '8.5';
  const backdrop = item.backdrop_path ? `${TMDB_IMAGE_BASE}${BACKDROP_SIZE}${item.backdrop_path}` : (item.poster_path ? `${TMDB_IMAGE_BASE}${POSTER_SIZE}${item.poster_path}` : '');
  const genres = (item.genres || []).map(g => g.name).join(', ') || 'Action, Anime, Adventure';

  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalOverview').textContent = item.overview || 'No storyline available.';
  document.getElementById('modalYear').textContent = year;
  document.getElementById('modalRating').innerHTML = `<i class="fa-solid fa-star text-xs"></i> ${rating}`;
  document.getElementById('modalTypeBadge').textContent = type.toUpperCase();
  document.getElementById('modalGenres').textContent = genres;
  document.getElementById('modalBackdrop').src = backdrop;

  const playBtn = document.getElementById('modalPrimaryPlayBtn');
  const triggerPlay = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    closeDetailsModal();
    playMedia(currentModalItem || item, 1, 1);
  };
  playBtn.onclick = triggerPlay;
  playBtn.ontouchend = triggerPlay;

  // TV / Anime: Check if seasons exist
  const episodesWrap = document.getElementById('modalEpisodesWrap');
  if (type === 'tv' && item.seasons && item.seasons.length > 0) {
    episodesWrap.classList.remove('hidden');
    episodesWrap.style.display = 'block';
    renderSeasonDropdown(item);
  } else {
    episodesWrap.classList.add('hidden');
    episodesWrap.style.display = 'none';
  }

  // Open modal instantly in 0ms!
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.zIndex = '9990';
  document.body.classList.add('overflow-hidden');
  setTimeout(() => {
    try {
      const pBtn = document.getElementById('modalPrimaryPlayBtn');
      if (pBtn) pBtn.focus();
    } catch (_) { }
  }, 50);

  // Background fetch full details if not fully loaded yet
  fetch(`/api/tmdb/${type}/${id}`)
    .then(res => res.ok ? res.json() : null)
    .then(full => {
      if (!full || !currentModalItem || currentModalItem.id !== id) return;
      full.media_type = type;
      currentModalItem = full;
      if (full.overview) document.getElementById('modalOverview').textContent = full.overview;
      if (full.genres) document.getElementById('modalGenres').textContent = full.genres.map(g => g.name).join(', ');
      if (type === 'tv' && full.seasons && full.seasons.length > 0) {
        episodesWrap.classList.remove('hidden');
        episodesWrap.style.display = 'block';
        renderSeasonDropdown(full);
      }
    })
    .catch(() => {});
}

function closeDetailsModal() {
  const modal = document.getElementById('detailsModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  document.body.classList.remove('overflow-hidden');
}

function renderSeasonDropdown(show) {
  const selector = document.getElementById('seasonSelector');
  selector.innerHTML = '';

  const validSeasons = show.seasons.filter(s => s.season_number > 0);
  validSeasons.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.season_number;
    opt.textContent = `${s.name || 'Season ' + s.season_number} (${s.episode_count} eps)`;
    selector.appendChild(opt);
  });

  window.currentSelectedShow = show;
  if (validSeasons.length > 0) {
    fetchAndRenderEpisodes(show.id, validSeasons[0].season_number);
  }
}

function onSeasonChanged(seasonNum) {
  if (window.currentSelectedShow) {
    fetchAndRenderEpisodes(window.currentSelectedShow.id, seasonNum);
  }
}

async function fetchAndRenderEpisodes(showId, seasonNum) {
  const list = document.getElementById('episodesList');
  list.innerHTML = `<div class="p-4 text-center text-xs text-neutral-400">Loading episodes...</div>`;

  try {
    const res = await fetch(`/api/tmdb/tv/${showId}/season/${seasonNum}`);
    if (!res.ok) throw new Error('Failed to load season');
    const data = await res.json();
    const episodes = data.episodes || [];

    list.innerHTML = '';
    episodes.forEach(ep => {
      const card = document.createElement('div');
      card.tabIndex = 0;
      card.className = 'episode-card tv-focusable';
      const still = ep.still_path ? `${TMDB_IMAGE_BASE}${STILL_SIZE}${ep.still_path}` : 'https://via.placeholder.com/160x90/222/fff?text=Episode';

      card.onclick = () => {
        closeDetailsModal();
        playMedia(window.currentSelectedShow, seasonNum, ep.episode_number);
      };

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.keyCode === 13) {
          e.preventDefault();
          card.click();
        }
      });

      card.innerHTML = `
        <img src="${still}" alt="${ep.name}" class="episode-thumb">
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <h4 class="text-xs sm:text-sm font-bold text-white truncate">${ep.episode_number}. ${ep.name}</h4>
            <span class="text-[10px] text-neutral-500">${ep.runtime ? ep.runtime + 'm' : ''}</span>
          </div>
          <p class="text-[11px] text-neutral-400 line-clamp-2 mt-1">${ep.overview || 'Watch this episode in full HD on VidBolt server.'}</p>
        </div>
        <button class="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center text-xs flex-shrink-0">
          <i class="fa-solid fa-play ml-0.5"></i>
        </button>
      `;

      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<div class="p-4 text-center text-xs text-neutral-500">Failed to load episode details. Click Play to start from Episode 1.</div>`;
  }
}

// ==========================================
// 6. HERO ACTIONS & WATCHLIST
// ==========================================
function playHeroMedia() {
  const media = heroMedia || {
    id: 1311031,
    title: 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
    media_type: 'movie',
    poster_path: '/fWVSwgjpT2D78VUh6X8UBd2rorW.jpg',
    backdrop_path: '/1RgPyOhN4DRs225BGTlHJqCudII.jpg',
    release_date: '2025-07-18',
    vote_average: 8.8,
    overview: 'The Demon Slayer Corps are drawn into the Infinity Castle, where Tanjiro, Nezuko, and the Hashira face terrifying Upper Rank demons in a desperate final fight against Muzan Kibutsuji.'
  };
  playMedia(media, 1, 1);
}

function openHeroDetails() {
  const media = heroMedia || {
    id: 1311031,
    title: 'Demon Slayer: Kimetsu no Yaiba Infinity Castle',
    media_type: 'movie',
    poster_path: '/fWVSwgjpT2D78VUh6X8UBd2rorW.jpg',
    backdrop_path: '/1RgPyOhN4DRs225BGTlHJqCudII.jpg',
    release_date: '2025-07-18',
    vote_average: 8.8,
    overview: 'The Demon Slayer Corps are drawn into the Infinity Castle, where Tanjiro, Nezuko, and the Hashira face terrifying Upper Rank demons in a desperate final fight against Muzan Kibutsuji.'
  };
  openDetailsModal(media);
}

function isInWatchlist(id) {
  return watchlist.some(i => i.id === id);
}

function toggleWatchlist(item, btn = null) {
  const index = watchlist.findIndex(i => i.id === item.id);
  if (index > -1) {
    watchlist.splice(index, 1);
    showToast('Removed from Watchlist');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  } else {
    watchlist.unshift(item);
    showToast('Added to Watchlist');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-check text-red-500"></i>';
  }
  safeSetItem('ghostflix_watchlist', JSON.stringify(watchlist));
  updateWatchlistBadge();
  updateHeroWatchlistBtn();

  if (!document.getElementById('myListSection').classList.contains('hidden')) {
    renderMyList();
  }
}

function toggleHeroWatchlist() {
  if (heroMedia) {
    toggleWatchlist(heroMedia);
  }
}

function updateHeroWatchlistBtn() {
  const icon = document.getElementById('heroAddListIcon');
  if (!icon || !heroMedia) return;
  if (isInWatchlist(heroMedia.id)) {
    icon.className = 'fa-solid fa-check text-red-500';
  } else {
    icon.className = 'fa-solid fa-plus';
  }
}

function updateWatchlistBadge() {
  const badge = document.getElementById('myListCount');
  if (watchlist.length > 0) {
    badge.textContent = watchlist.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function showMyList(e) {
  if (e) e.preventDefault();
  document.getElementById('mainContent').classList.add('hidden');
  document.getElementById('searchResultsSection').classList.add('hidden');
  document.getElementById('myListSection').classList.remove('hidden');
  updateNavActive('mylist');
  renderMyList();
}

function renderMyList() {
  const grid = document.getElementById('myListGrid');
  const empty = document.getElementById('myListEmpty');
  grid.innerHTML = '';

  if (watchlist.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    watchlist.forEach(item => {
      grid.appendChild(createMediaCard(item, true));
    });
  }
}

function clearMyList() {
  if (confirm('Are you sure you want to clear your watchlist?')) {
    watchlist = [];
    localStorage.removeItem('ghostflix_watchlist');
    updateWatchlistBadge();
    updateHeroWatchlistBtn();
    renderMyList();
    showToast('Watchlist cleared');
  }
}

// ==========================================
// 7. NAVIGATION & UTILITIES
// ==========================================
function showHome(e) {
  if (e) e.preventDefault();
  document.getElementById('mainContent').classList.remove('hidden');
  document.getElementById('searchResultsSection').classList.add('hidden');
  document.getElementById('myListSection').classList.add('hidden');
  const showcaseWrap = document.getElementById('platformShowcaseWrap');
  if (showcaseWrap) showcaseWrap.classList.add('hidden');
  const defaultRows = document.getElementById('defaultRowsContainer');
  if (defaultRows) defaultRows.classList.remove('hidden');
  const resetBtn = document.getElementById('resetPlatformBtn');
  if (resetBtn) resetBtn.classList.add('hidden');
  currentPlatformId = null;
  window.location.hash = 'home';
  updateNavActive('home');
}

function filterCategory(category, e) {
  if (e) e.preventDefault();
  if (category === 'movie') {
    document.getElementById('rowMovies').scrollIntoView({ behavior: 'smooth' });
    updateNavActive('movies');
  } else if (category === 'tv') {
    document.getElementById('rowSeries').scrollIntoView({ behavior: 'smooth' });
    updateNavActive('tv');
  } else if (category === 'anime') {
    document.getElementById('rowAnime').scrollIntoView({ behavior: 'smooth' });
    updateNavActive('anime');
  }
}

function updateNavActive(type) {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active', 'text-white');
    link.classList.add('text-gray-300');
    if (link.getAttribute('href') === `#${type}`) {
      link.classList.add('active', 'text-white');
      link.classList.remove('text-gray-300');
    }
  });
}

function initNavbarScroll() {
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      navbar.classList.add('bg-black/95', 'shadow-2xl');
      navbar.classList.remove('bg-gradient-to-b', 'from-black/90');
    } else {
      navbar.classList.remove('bg-black/95', 'shadow-2xl');
      navbar.classList.add('bg-gradient-to-b', 'from-black/90');
    }
  });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toastMsg');
  if (!toast || !msg) return;
  msg.textContent = message;
  toast.classList.remove('-translate-y-16', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.add('-translate-y-16', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 2500);
}

// ==========================================
// 8. SWIPE RIGHT GESTURE TO PLAYMAX (App Interop)
// ==========================================
(function initTadkaSwipeDetector() {
  if (typeof window === 'undefined') return;

  var touchStartX = null;
  var touchStartY = null;
  var hasSwiped = false;

  function getPoint(e) {
    var p = (e.touches && e.touches.length) ? e.touches[0] : ((e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e);
    return {
      x: p.clientX !== undefined ? p.clientX : (p.pageX !== undefined ? p.pageX : 0),
      y: p.clientY !== undefined ? p.clientY : (p.pageY !== undefined ? p.pageY : 0)
    };
  }

  function onGestureStart(e) {
    var pt = getPoint(e);
    touchStartX = pt.x;
    touchStartY = pt.y;
    hasSwiped = false;
  }

  function onGestureMove(e) {
    if (touchStartX === null || hasSwiped) return;
    var pt = getPoint(e);
    var deltaX = pt.x - touchStartX;
    var deltaY = pt.y - touchStartY;

    var playerModal = document.getElementById('playerModal');
    if (playerModal && !playerModal.classList.contains('hidden')) return;
    var detailsModal = document.getElementById('detailsModal');
    if (detailsModal && !detailsModal.classList.contains('hidden')) return;

    if (deltaX > 35 && deltaX > Math.abs(deltaY) * 1.2) {
      hasSwiped = true;
      touchStartX = null;
      touchStartY = null;
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SWIPE_RIGHT_TO_PLAYMAX' }));
      }
    }
  }

  function onGestureEnd(e) {
    if (touchStartX === null || hasSwiped) {
      touchStartX = null;
      touchStartY = null;
      return;
    }
    var pt = getPoint(e);
    var deltaX = pt.x - touchStartX;
    var deltaY = pt.y - touchStartY;
    touchStartX = null;
    touchStartY = null;

    var playerModal = document.getElementById('playerModal');
    if (playerModal && !playerModal.classList.contains('hidden')) return;
    var detailsModal = document.getElementById('detailsModal');
    if (detailsModal && !detailsModal.classList.contains('hidden')) return;

    if (deltaX > 30 && deltaX > Math.abs(deltaY) * 1.2) {
      hasSwiped = true;
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SWIPE_RIGHT_TO_PLAYMAX' }));
      }
    }
  }

  window.addEventListener('touchstart', onGestureStart, { passive: true });
  window.addEventListener('touchmove', onGestureMove, { passive: true });
  window.addEventListener('touchend', onGestureEnd, { passive: true });
  window.addEventListener('touchcancel', onGestureEnd, { passive: true });
})();

// ==========================================
// 9. SMART TV REMOTE D-PAD & SPATIAL NAVIGATION
// ==========================================
(function initSmartTVNavigation() {
  if (typeof window === 'undefined') return;

  let isTvMode = false;
  let currentFocusedEl = null;

  function enableTvMode() {
    if (!isTvMode) {
      isTvMode = true;
      document.body.classList.add('tv-mode');
    }
  }

  window.addEventListener('mousemove', () => {
    if (isTvMode) {
      isTvMode = false;
      document.body.classList.remove('tv-mode');
    }
  }, { passive: true });

  function getActiveModal() {
    const trailerModal = document.getElementById('playerTrailerModal') || document.getElementById('trailerModal');
    if (trailerModal && !trailerModal.classList.contains('hidden')) return trailerModal;

    const settingsSheet = document.getElementById('playerSettingsSheet');
    if (settingsSheet && !settingsSheet.classList.contains('hidden')) return settingsSheet;

    const audioSubsSheet = document.getElementById('playerAudioSubsSheet');
    if (audioSubsSheet && !audioSubsSheet.classList.contains('hidden')) return audioSubsSheet;

    const playerModal = document.getElementById('playerModal');
    if (playerModal && !playerModal.classList.contains('hidden')) return playerModal;

    const detailsModal = document.getElementById('detailsModal');
    if (detailsModal && !detailsModal.classList.contains('hidden')) return detailsModal;

    const searchSection = document.getElementById('searchResultsSection');
    if (searchSection && !searchSection.classList.contains('hidden')) return searchSection;

    return null;
  }

  function getFocusableElements() {
    const activeModal = getActiveModal();
    const root = activeModal || document;

    const selector = 'button:not([disabled]):not(.hidden), a[href]:not(.hidden), input:not([disabled]):not([type="hidden"]), select:not([disabled]), .media-card, .studio-card, .episode-card, .search-filter-chip, .sheet-option-btn, .tv-focusable, [tabindex="0"]';
    const elements = Array.from(root.querySelectorAll(selector));

    return elements.filter(el => {
      if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (!activeModal) {
        if (el.closest('#playerModal.hidden, #detailsModal.hidden, #playerTrailerModal.hidden, #trailerModal.hidden, #playerSettingsSheet.hidden, #playerAudioSubsSheet.hidden, #mobileSearchWrap.hidden')) {
          return false;
        }
      }
      return true;
    });
  }

  function setElementFocus(el, shouldScroll = true) {
    if (!el) return;
    enableTvMode();

    document.querySelectorAll('.tv-focused').forEach(e => e.classList.remove('tv-focused'));
    el.classList.add('tv-focused');
    currentFocusedEl = el;

    try {
      el.focus({ preventScroll: true });
    } catch (_) {}

    if (shouldScroll) {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center'
      });

      const row = el.closest('.row-scroll, #studiosCarousel, #episodesList');
      if (row) {
        const cardRect = el.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        if (cardRect.left < rowRect.left + 80 || cardRect.right > rowRect.right - 80) {
          const scrollDelta = (cardRect.left + cardRect.width / 2) - (rowRect.left + rowRect.width / 2);
          row.scrollBy({ left: scrollDelta, behavior: 'smooth' });
        }
      }
    }
  }

  function getCenter(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height
    };
  }

  function navigateDirection(direction) {
    const focusables = getFocusableElements();
    if (!focusables.length) return;

    let current = document.activeElement;
    if (!current || !focusables.includes(current)) {
      current = currentFocusedEl && focusables.includes(currentFocusedEl) ? currentFocusedEl : null;
    }

    if (!current) {
      const defaultEl = focusables.find(e => e.id === 'heroPlayBtn' || e.id === 'modalPrimaryPlayBtn') || focusables[0];
      setElementFocus(defaultEl);
      return;
    }

    const curCenter = getCenter(current);
    let bestCandidate = null;
    let minScore = Infinity;

    focusables.forEach(target => {
      if (target === current) return;
      const tCenter = getCenter(target);
      const dx = tCenter.x - curCenter.x;
      const dy = tCenter.y - curCenter.y;

      let isValid = false;
      let score = Infinity;

      const sameContainer = target.parentElement === current.parentElement ||
                            (target.closest('.row-scroll') && target.closest('.row-scroll') === current.closest('.row-scroll'));

      if (direction === 'right') {
        if (dx > 8) {
          isValid = true;
          score = dx + Math.abs(dy) * (sameContainer ? 1.2 : 3.0);
          if (sameContainer) score *= 0.5;
        }
      } else if (direction === 'left') {
        if (dx < -8) {
          isValid = true;
          score = Math.abs(dx) + Math.abs(dy) * (sameContainer ? 1.2 : 3.0);
          if (sameContainer) score *= 0.5;
        }
      } else if (direction === 'down') {
        if (dy > 12) {
          isValid = true;
          score = dy + Math.abs(dx) * 1.5;
        }
      } else if (direction === 'up') {
        if (dy < -12) {
          isValid = true;
          score = Math.abs(dy) + Math.abs(dx) * 1.5;
        }
      }

      if (isValid && score < minScore) {
        minScore = score;
        bestCandidate = target;
      }
    });

    if (bestCandidate) {
      setElementFocus(bestCandidate);
    }
  }

  window.addEventListener('keydown', (e) => {
    const key = e.key;
    const keyCode = e.keyCode || e.which;

    // Smart TV Remote Back Keys: Escape (27), Backspace (8), Tizen (10009), webOS (461), Android (166, 10182, 10222)
    const isBackKey = key === 'Escape' ||
                      (keyCode === 8 && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) ||
                      keyCode === 10009 || keyCode === 461 || keyCode === 166 || keyCode === 10182 || keyCode === 10222;

    if (isBackKey) {
      e.preventDefault();
      const trailerModal = document.getElementById('playerTrailerModal') || document.getElementById('trailerModal');
      if (trailerModal && !trailerModal.classList.contains('hidden')) {
        closeTrailerModal();
        return;
      }
      const settingsSheet = document.getElementById('playerSettingsSheet');
      if (settingsSheet && !settingsSheet.classList.contains('hidden')) {
        closePlayerSettingsSheet();
        return;
      }
      const audioSubsSheet = document.getElementById('playerAudioSubsSheet');
      if (audioSubsSheet && !audioSubsSheet.classList.contains('hidden')) {
        closePlayerAudioSubsSheet();
        return;
      }
      const playerModal = document.getElementById('playerModal');
      if (playerModal && !playerModal.classList.contains('hidden')) {
        closePlayerModal();
        return;
      }
      const detailsModal = document.getElementById('detailsModal');
      if (detailsModal && !detailsModal.classList.contains('hidden')) {
        closeDetailsModal();
        return;
      }
      const searchSection = document.getElementById('searchResultsSection');
      if (searchSection && !searchSection.classList.contains('hidden')) {
        showHome();
        return;
      }
      const mobSearch = document.getElementById('mobileSearchWrap');
      if (mobSearch && !mobSearch.classList.contains('hidden')) {
        toggleSearchInput();
        return;
      }
      return;
    }

    // Smart TV Media Keys: Play / Pause (179, 250, 19)
    const isMediaPlayPause = key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause' ||
                            keyCode === 179 || keyCode === 250 || keyCode === 19;
    if (isMediaPlayPause) {
      e.preventDefault();
      if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
        artPlayerInstance.toggle();
      }
      return;
    }

    // Smart TV Seek Keys: MediaFastForward (228), MediaRewind (227)
    if (key === 'MediaFastForward' || keyCode === 228) {
      e.preventDefault();
      if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
        artPlayerInstance.seek = artPlayerInstance.currentTime + 10;
      }
      return;
    }
    if (key === 'MediaRewind' || keyCode === 227) {
      e.preventDefault();
      if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
        artPlayerInstance.seek = Math.max(0, artPlayerInstance.currentTime - 10);
      }
      return;
    }

    // In Video Player: Space or OK toggles playback if no button is focused
    const playerModal = document.getElementById('playerModal');
    const isPlayerActive = playerModal && !playerModal.classList.contains('hidden');

    if (isPlayerActive) {
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
          artPlayerInstance.toggle();
        }
        return;
      }
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag !== 'BUTTON' && tag !== 'SELECT' && tag !== 'INPUT') {
        if (key === 'ArrowLeft' || keyCode === 37) {
          e.preventDefault();
          if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
            artPlayerInstance.seek = Math.max(0, artPlayerInstance.currentTime - 10);
          }
          return;
        }
        if (key === 'ArrowRight' || keyCode === 39) {
          e.preventDefault();
          if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
            artPlayerInstance.seek = artPlayerInstance.currentTime + 10;
          }
          return;
        }
        if (key === 'ArrowUp' || keyCode === 38) {
          e.preventDefault();
          if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
            artPlayerInstance.volume = Math.min(1, artPlayerInstance.volume + 0.1);
          }
          return;
        }
        if (key === 'ArrowDown' || keyCode === 40) {
          e.preventDefault();
          if (typeof artPlayerInstance !== 'undefined' && artPlayerInstance) {
            artPlayerInstance.volume = Math.max(0, artPlayerInstance.volume - 0.1);
          }
          return;
        }
      }
    }

    // D-Pad Arrow Navigation
    if (key === 'ArrowRight' || keyCode === 39) {
      e.preventDefault();
      navigateDirection('right');
    } else if (key === 'ArrowLeft' || keyCode === 37) {
      e.preventDefault();
      navigateDirection('left');
    } else if (key === 'ArrowDown' || keyCode === 40) {
      e.preventDefault();
      navigateDirection('down');
    } else if (key === 'ArrowUp' || keyCode === 38) {
      e.preventDefault();
      navigateDirection('up');
    } else if (key === 'Enter' || keyCode === 13) {
      const active = document.activeElement;
      if (active && active !== document.body) {
        active.click();
      } else if (currentFocusedEl) {
        currentFocusedEl.click();
      }
    }
  });

  // Auto-focus Hero "Play Now" button when page loads for instant TV remote usability
  window.addEventListener('load', () => {
    setTimeout(() => {
      const heroPlay = document.getElementById('heroPlayBtn');
      if (heroPlay) {
        setElementFocus(heroPlay, false);
      }
    }, 600);
  });
})();



