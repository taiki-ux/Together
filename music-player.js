/* ============================================================
   MUSIC-PLAYER.JS
   Music-pane specific UI: vinyl spin / waveform bars driven by
   the 'music' YouTube-sync channel, a Spotify-link nudge (full
   Spotify playback needs OAuth + Premium + a backend — flagged
   as a roadmap item, see settings modal), and solo local-file
   playback for whatever's on your own device.

   The collaborative queue used to live in this file — it's now
   shared with the Watch pane too, see queue.js.
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

// ---------- Progress bar: time played on the left, time remaining on the right ----------
const musicSeekEl = document.getElementById('music-seek');
const musicElapsedEl = document.getElementById('music-time-elapsed');
const musicRemainingEl = document.getElementById('music-time-remaining');
let musicSeeking = false;

function formatClock(totalSeconds){
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function musicDuration(){
  const c = YTChannels.music;
  try{ return (c.player && c.ready && c.currentId) ? (c.player.getDuration() || 0) : 0; }catch(e){ return 0; }
}
function paintMusicProgress(cur, dur){
  const known = dur > 0 && isFinite(dur);
  const pct = known ? Math.max(0, Math.min(100, cur / dur * 100)) : 0;
  musicSeekEl.disabled = !known;
  musicSeekEl.value = String(Math.round(pct * 10));
  musicSeekEl.style.setProperty('--pct', pct + '%');
  musicElapsedEl.textContent = formatClock(cur);
  musicRemainingEl.textContent = known ? '-' + formatClock(dur - cur) : (YTChannels.music.currentId && YTChannels.music.ready ? 'LIVE' : '-0:00');
}
function updateMusicProgress(){
  if (musicSeeking || !musicSeekEl) return;
  const c = YTChannels.music;
  let cur = 0;
  try{ if (c.player && c.ready && c.currentId) cur = c.player.getCurrentTime() || 0; }catch(e){}
  paintMusicProgress(cur, musicDuration());
}
if (musicSeekEl){
  // Dragging previews the time; letting go jumps the whole room there (like any shared player)
  musicSeekEl.addEventListener('input', ()=>{
    musicSeeking = true;
    const dur = musicDuration();
    paintMusicProgress(dur * musicSeekEl.value / 1000, dur);
  });
  musicSeekEl.addEventListener('change', ()=>{
    const dur = musicDuration();
    musicSeeking = false;
    if (dur > 0) YTSync.seekTo('music', dur * musicSeekEl.value / 1000);
    updateMusicProgress();
  });
  musicSeekEl.addEventListener('blur', ()=>{ musicSeeking = false; });
  setInterval(()=>{ if (!document.hidden) updateMusicProgress(); }, 500);
}
