/* ============================================================
   MUSIC-PLAYER.JS
   Music-pane specific UI: vinyl spin / waveform bars driven by
   the 'music' YouTube-sync channel, a Spotify-link nudge (full
   Spotify playback needs OAuth + Premium + a backend — flagged
   as a roadmap item, see settings modal), and solo local-file
   playback for whatever's on your own device.
   ============================================================ */

const SONG_SUGGESTIONS = [
  "Blinding Lights — The Weeknd",
  "As It Was — Harry Styles",
  "Redbone — Childish Gambino",
  "Electric Feel — MGMT",
  "Sunflower — Post Malone & Swae Lee",
  "Levitating — Dua Lipa",
  "Feel Good Inc. — Gorillaz",
  "good 4 u — Olivia Rodrigo",
  "Heat Waves — Glass Animals",
  "Cruel Summer — Taylor Swift"
];
function suggestSong(){ return SONG_SUGGESTIONS[Math.floor(Math.random()*SONG_SUGGESTIONS.length)]; }

window.onChannelLoading = (function(prev){
  return function(ch, videoId){
    if (prev) prev(ch, videoId);
    if (ch !== 'music') return;
    const titleEl = document.getElementById('music-title');
    if (titleEl) titleEl.textContent = 'Loading…';
  };
})(window.onChannelLoading);

window.onChannelStateChange = (function(prev){
  return function(ch, ytState){
    if (prev) prev(ch, ytState);
    if (ch !== 'music') return;
    const playing = ytState === 1; // YT.PlayerState.PLAYING
    const vinyl = document.getElementById('vinyl');
    const bars = document.getElementById('music-bars');
    if (vinyl) vinyl.classList.toggle('spinning', playing);
    if (bars) bars.classList.toggle('playing', playing);
    const titleEl = document.getElementById('music-title');
    if (titleEl && titleEl.textContent === 'Loading…' && YTChannels.music.currentId){
      titleEl.textContent = 'Playing a synced track';
    }
  };
})(window.onChannelStateChange);

function musicLoadFromInput(rawUrl){
  if (isSpotifyLink(rawUrl)){
    return { ok:false, message:"Spotify sync needs sign-in, which isn't built yet — paste a YouTube link for now, or play a file from your device below." };
  }
  const id = extractVideoId(rawUrl);
  if (!id){
    return { ok:false, message:"Couldn't find a track in that link — paste a full YouTube URL, or an 11-character video ID." };
  }
  YTSync.load('music', id);
  return { ok:true };
}

// ---------- Local file playback (solo — not networked) ----------
function musicPlayLocalFile(file){
  const audioEl = document.getElementById('local-audio-player');
  const url = URL.createObjectURL(file);
  audioEl.src = url;
  audioEl.style.display = 'block';
  audioEl.play().catch(()=>{});
  const titleEl = document.getElementById('music-title');
  if (titleEl) titleEl.textContent = file.name + ' (just for you)';
  const vinyl = document.getElementById('vinyl');
  const bars = document.getElementById('music-bars');
  audioEl.onplay = ()=>{ vinyl && vinyl.classList.add('spinning'); bars && bars.classList.add('playing'); };
  audioEl.onpause = ()=>{ vinyl && vinyl.classList.remove('spinning'); bars && bars.classList.remove('playing'); };
}


// ---------- Collaborative queue ----------
// No real server, so ties/skip-decisions need a deterministic rule: whoever's
// participant id sorts first alphabetically is the "queue leader" for
// auto-advance. Everyone else just applies whatever gets broadcast.
let musicQueue = []; // {id, videoId, title, addedBy}
let queueVotes = {}; // trackId -> { peerId: 'keep'|'skip' }

function isQueueLeader(){
  const ids = Object.keys(participants).sort();
  return ids.length > 0 && ids[0] === myId;
}

function queueAddTrack(videoId, title){
  const id = 'q' + Date.now() + Math.random().toString(36).slice(2,7);
  const track = { id, videoId, title, addedBy: myName };
  const wasEmpty = musicQueue.length === 0;
  musicQueue.push(track);
  renderQueue();
  broadcast({ type:'queue', action:'add', track });
  if (wasEmpty) playQueueHead(true);
}
function playQueueHead(broadcastLoad){
  if (musicQueue.length === 0) return;
  if (broadcastLoad) YTSync.load('music', musicQueue[0].videoId);
  renderQueue();
}
function queueVote(trackId, choice){
  if (!queueVotes[trackId]) queueVotes[trackId] = {};
  queueVotes[trackId][myId] = choice;
  renderQueue();
  broadcast({ type:'queue', action:'vote', trackId, peerId:myId, choice });
  maybeSkipFromVotes(trackId);
}
function maybeSkipFromVotes(trackId){
  if (musicQueue.length === 0 || musicQueue[0].id !== trackId) return;
  const votes = queueVotes[trackId] || {};
  const skipCount = Object.values(votes).filter(v=> v==='skip').length;
  const participantCount = Object.keys(participants).length;
  if (skipCount > Math.floor(participantCount/2) && isQueueLeader()) advanceQueue();
}
function advanceQueue(){
  if (musicQueue.length === 0) return;
  const finished = musicQueue.shift();
  delete queueVotes[finished.id];
  broadcast({ type:'queue', action:'remove', trackId: finished.id });
  if (musicQueue.length > 0) playQueueHead(true);
  else renderQueue();
}

registerHandler('queue', (fromId, data)=>{
  if (data.action==='add'){
    if (!musicQueue.find(t=> t.id===data.track.id)) musicQueue.push(data.track);
    renderQueue();
  } else if (data.action==='vote'){
    if (!queueVotes[data.trackId]) queueVotes[data.trackId] = {};
    queueVotes[data.trackId][data.peerId] = data.choice;
    renderQueue();
  } else if (data.action==='remove'){
    musicQueue = musicQueue.filter(t=> t.id !== data.trackId);
    delete queueVotes[data.trackId];
    renderQueue();
  } else if (data.action==='sync'){
    musicQueue = data.queue || [];
    queueVotes = data.votes || {};
    renderQueue();
  }
});

// New joiners need the current queue — same pattern youtube-sync.js already
// uses for channel state.
window.onPeerConnected = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    sendData(dataConns[peerId], { type:'queue', action:'sync', queue: musicQueue, votes: queueVotes });
  };
})(window.onPeerConnected);

function renderQueue(){
  const el = document.getElementById('queue-list');
  if (!el) return;
  if (musicQueue.length === 0){ el.innerHTML = '<p class="queue-empty">Nothing queued — add a track to get started.</p>'; return; }
  el.innerHTML = musicQueue.map((t,i)=>{
    const votes = queueVotes[t.id] || {};
    const keepCount = Object.values(votes).filter(v=>v==='keep').length;
    const skipCount = Object.values(votes).filter(v=>v==='skip').length;
    const myVote = votes[myId];
    return `
      <div class="queue-item ${i===0?'now-playing':''}">
        <div class="queue-item-info">
          <div class="title">${i===0?'▶ ':''}${escapeHtml(t.title)}</div>
          <div class="added-by">added by ${escapeHtml(t.addedBy)}</div>
        </div>
        <div class="queue-votes">
          <button class="vote-btn ${myVote==='keep'?'voted':''}" data-vote-track="${t.id}" data-vote-choice="keep" type="button">❤ ${keepCount}</button>
          <button class="vote-btn ${myVote==='skip'?'voted':''}" data-vote-track="${t.id}" data-vote-choice="skip" type="button">👎 ${skipCount}</button>
        </div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('[data-vote-track]').forEach(btn=>{
    btn.addEventListener('click', ()=> queueVote(btn.dataset.voteTrack, btn.dataset.voteChoice));
  });
}

// Auto-advance when the current track finishes playing (YT state 0 = ENDED)
window.onChannelStateChange = (function(prev){
  return function(ch, ytState){
    if (prev) prev(ch, ytState);
    if (ch === 'music' && ytState === 0 && isQueueLeader()) advanceQueue();
  };
})(window.onChannelStateChange);
