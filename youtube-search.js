/* ============================================================
   YOUTUBE-SEARCH.JS
   🔍 Search YouTube → tap a result → plays for the whole room.
   Calls a Supabase Edge Function (supabase/functions/youtube-search)
   that proxies the YouTube Data API — same pattern as the AI Buddy
   function: the API key lives server-side only, never in client
   code. See supabase/README.md for the one-time setup.

   Works for both the Watch pane ('video') and Music pane ('music')
   off the shared `ch` id already used by YTSync/YTChannels.
   Paste-a-link is still there as a fallback, just collapsed behind
   a toggle now that search is the primary way in.
   ============================================================ */

async function callYoutubeSearch(query, attempt){
  attempt = attempt || 1;
  try{
    const res = await fetch(YOUTUBE_SEARCH_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'apikey':SUPABASE_ANON_KEY },
      body: JSON.stringify({ query })
    });
    if (!res.ok) throw new Error(`Search service responded with HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json.results || [];
  }catch(e){
    if (attempt === 1){
      await new Promise(r=> setTimeout(r, 600));
      return callYoutubeSearch(query, 2);
    }
    throw e;
  }
}

const YTSearchState = {
  video: { query:'', results:[], loading:false },
  music: { query:'', results:[], loading:false }
};

function renderSearchResults(ch){
  const el = document.getElementById(ch + '-search-results');
  if (!el) return;
  const st = YTSearchState[ch];

  if (st.loading){
    el.innerHTML = '<p class="hint">🔍 Searching…</p>';
    el.classList.add('open');
    return;
  }
  if (!st.query){ el.innerHTML=''; el.classList.remove('open'); return; }
  if (!st.results.length){
    el.innerHTML = '<p class="hint">No results — try another search.</p>';
    el.classList.add('open');
    return;
  }

  el.classList.add('open');
  el.innerHTML = st.results.map(r => `
    <div class="search-result-card" data-video-id="${r.videoId}" data-title="${escapeHtml(r.title)}" tabindex="0" role="button">
      <img src="${r.thumbnail}" alt="" loading="lazy">
      <div class="search-result-info">
        <div class="search-result-title">${escapeHtml(r.title)}</div>
        <div class="search-result-channel">${escapeHtml(r.channelTitle)}</div>
      </div>
      <span class="btn btn-primary btn-sm search-result-play">▶ Play Together</span>
    </div>
  `).join('');

  el.querySelectorAll('.search-result-card').forEach(card=>{
    const play = ()=> playSearchResult(ch, card.dataset.videoId, card.dataset.title);
    card.addEventListener('click', play);
    card.addEventListener('keydown', e=>{ if (e.key==='Enter' || e.key===' '){ e.preventDefault(); play(); } });
  });
}

function playSearchResult(ch, videoId, title){
  addToQueue(ch, videoId, title);
  // Keep the (now-hidden) paste-row input in sync so favorites/room-context,
  // which already read from it, pick up the real title without any changes there.
  const urlInput = document.getElementById('input-' + ch + '-url');
  if (urlInput) urlInput.value = title;
  closeSearch(ch);
  setMode(ch, true);
  toast('Added to the queue 🎶');
}

function closeSearch(ch){
  YTSearchState[ch] = { query:'', results:[], loading:false };
  const input = document.getElementById('input-' + ch + '-search');
  if (input) input.value = '';
  renderSearchResults(ch);
}

async function runYoutubeSearch(ch){
  const input = document.getElementById('input-' + ch + '-search');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  YTSearchState[ch].query = query;
  YTSearchState[ch].loading = true;
  renderSearchResults(ch);

  try{
    YTSearchState[ch].results = await callYoutubeSearch(query);
  }catch(e){
    console.error('YouTube search failed:', e);
    toast(`Couldn't search right now (${e.message})`, 'err');
    YTSearchState[ch].results = [];
  }
  YTSearchState[ch].loading = false;
  renderSearchResults(ch);
}

['video','music'].forEach(ch=>{
  const searchBtn = document.getElementById('btn-' + ch + '-search');
  const searchInput = document.getElementById('input-' + ch + '-search');
  if (searchBtn) searchBtn.addEventListener('click', ()=> runYoutubeSearch(ch));
  if (searchInput) searchInput.addEventListener('keydown', e=>{ if (e.key==='Enter') runYoutubeSearch(ch); });

  const toggleBtn = document.getElementById('btn-' + ch + '-paste-toggle');
  const pasteRow = document.getElementById(ch + '-paste-row');
  if (toggleBtn && pasteRow){
    toggleBtn.addEventListener('click', ()=>{
      const opening = pasteRow.style.display !== 'flex';
      pasteRow.style.display = opening ? 'flex' : 'none';
      toggleBtn.textContent = opening ? 'or search YouTube instead' : 'or paste a link instead';
      if (opening) closeSearch(ch);
    });
  }
});
