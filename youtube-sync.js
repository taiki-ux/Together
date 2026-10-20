/* ============================================================
   YOUTUBE-SYNC.js
   Room Playback State for the Watch and Music channels.

   Each channel keeps ONE shared state — { currentId, playing, position, rev, controller }.
   Whoever takes a playback action (Play, Pause, Seek, loading something) bumps `rev` and becomes
   the controller; everyone applies an update only if it is newer.

   Why a counter and not a clock: the old version stamped updates with each phone's own
   Date.now(). Two phones a few seconds apart made one of them ignore the other's updates
   forever ("I press play and my friend's video never starts"). `rev` needs no clock; if two
   people act at the same instant the higher controller id wins, identically on every device.
   Playback position is estimated from the moment an update ARRIVED, again without clocks.

   The YouTube player is NOT the source of truth — it is kept in step with the state. The
   player also reports its own changes (loading, autoplay blocked, the OS pausing media in
   the background). Those reports are only treated as a person's action when we haven't just
   told the player to do something, so a blocked autoplay can never pause the whole room.
   ============================================================ */

let ytApiReady = false;
const ytTag = document.createElement('script');
ytTag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytTag);
window.onYouTubeIframeAPIReady = function(){ ytApiReady = true; };

const YT_ECHO_WINDOW_MS = 8000;      // after WE command the player, its state events are answers, not people
const YT_BLOCKED_AFTER_MS = 4000;    // still not playing this long after the room said "play" -> offer "Tap to join"
const YT_HEARTBEAT_MS = 5000;

function ytMakeChannel(containerId, size){
  return { containerId, size, player:null, ready:false,
           currentId:null, playing:false, position:0, rev:0, controller:null, stateAt:0,
           applyingUntil:0, blocked:false, watchToken:0 };
}
const YTChannels = {
  video: ytMakeChannel('yt-player-video', null),
  // YouTube wants a player of at least 200x200; the music player is kept that big but hidden off-screen
  music: ytMakeChannel('yt-player-music', { w:220, h:220 })
};

function extractVideoId(input){
  input = (input||'').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const m = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function isValidVideoId(id){ return typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id); }
function isSpotifyLink(input){ return /open\.spotify\.com/i.test(input||''); }
function parseTimeInput(str){
  str = (str||'').trim();
  if (/^\d+$/.test(str)) return parseInt(str,10);
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  let secs = 0; for (const p of parts) secs = secs*60 + p;
  return secs;
}

// ---------- Helpers ----------
// Where playback SHOULD be right now. stateAt is OUR clock at the moment we set/received the state.
function ytEstimatePosition(c){
  return c.playing ? c.position + (Date.now() - c.stateAt)/1000 : c.position;
}
function ytLocalTime(c){
  try{
    const t = c.player.getCurrentTime();
    return (typeof t === 'number' && isFinite(t)) ? t : c.position;
  }catch(e){ return c.position; }
}
function ytLocalState(c){
  try{ return (c.player && c.ready) ? c.player.getPlayerState() : -1; }catch(e){ return -1; }
}
// Is an update (rev, controller) newer than what the channel already holds?
function ytIsNewer(rev, controller, c){
  if (rev !== c.rev) return rev > c.rev;
  return String(controller || '') > String(c.controller || '');
}
function ytSetBlocked(ch, blocked){
  const c = YTChannels[ch];
  if (c.blocked === blocked) return;
  c.blocked = blocked;
  if (window.onChannelBlocked) window.onChannelBlocked(ch, blocked);
}

// ---------- Player lifecycle ----------
function ytWhenApiReady(fn){
  if (ytApiReady && typeof YT !== 'undefined' && YT.Player) fn();
  else setTimeout(()=> ytWhenApiReady(fn), 300);
}

function ytCreateOrLoad(ch, videoId, startTime){
  const c = YTChannels[ch];
  if (c.currentId !== videoId) return;                 // the room moved on while the API was loading
  const start = Math.max(0, startTime || 0);
  if (!c.player){
    const opts = {
      videoId,
      playerVars:{ rel:0, playsinline:1, autoplay: c.playing ? 1 : 0, start: Math.floor(start) },
      events:{
        onReady: ()=>{
          c.ready = true;
          // Anything that changed while the player was starting up: line up with the latest state
          let loaded = null;
          try{ loaded = c.player.getVideoData && c.player.getVideoData().video_id; }catch(e){}
          ytApplyToPlayer(ch, loaded !== c.currentId);
        },
        onStateChange: e=> ytOnStateChange(ch, e),
        onError: e=> ytOnError(ch, e),
        onAutoplayBlocked: ()=> ytSetBlocked(ch, true)
      }
    };
    if (c.size){ opts.width = String(c.size.w); opts.height = String(c.size.h); }
    c.player = new YT.Player(c.containerId, opts);
  } else if (c.ready){
    if (c.playing) c.player.loadVideoById({ videoId, startSeconds:start });
    else c.player.cueVideoById({ videoId, startSeconds:start });
  }
  // else: the player exists but isn't ready — onReady will load whatever is current by then
}

// Make the local player match the room's state. `videoChanged` forces a (re)load.
function ytApplyToPlayer(ch, videoChanged){
  const c = YTChannels[ch];
  if (!c.currentId) return;
  const target = ytEstimatePosition(c);

  if (!c.player || !c.ready || videoChanged){
    c.applyingUntil = Date.now() + YT_ECHO_WINDOW_MS;
    ytWhenApiReady(()=> ytCreateOrLoad(ch, c.currentId, ytEstimatePosition(c)));
    if (c.playing) ytWatchPlayback(ch);
    return;
  }

  const st = ytLocalState(c);
  const drift = Math.abs(ytLocalTime(c) - target);
  // While buffering we're legitimately behind — only chase if we're far off, or it isn't just buffering
  if ((st !== 3 && drift > 1.5) || drift > 8) c.player.seekTo(target, true);

  const localPlaying = (st === 1 || st === 3);
  if (c.playing !== localPlaying){
    c.applyingUntil = Date.now() + YT_ECHO_WINDOW_MS;
    if (c.playing){ c.player.playVideo(); ytWatchPlayback(ch); }
    else c.player.pauseVideo();
  }
}

// The room says "playing" but this device's player never starts (autoplay blocked, slow
// network, OS paused it): after a few seconds, offer a tap that starts it for this device only.
function ytWatchPlayback(ch){
  const c = YTChannels[ch];
  const token = ++c.watchToken, videoId = c.currentId;
  setTimeout(()=>{
    if (token !== c.watchToken || !c.playing || c.currentId !== videoId) return;
    const st = ytLocalState(c);
    if (st !== 1 && st !== 3) ytSetBlocked(ch, true);
  }, YT_BLOCKED_AFTER_MS);
}

function ytOnStateChange(ch, e){
  const c = YTChannels[ch], S = YT.PlayerState;
  if (window.onChannelStateChange) window.onChannelStateChange(ch, e.data);   // queue auto-advance, vinyl, etc.
  if (e.data === S.PLAYING) ytSetBlocked(ch, false);

  if (Date.now() < c.applyingUntil){
    // We just told the player what to do — this is its answer, not a person pressing buttons.
    if (e.data === S.PLAYING){
      if (c.playing) c.applyingUntil = 0;           // arrived where the room wants it
      else c.player.pauseVideo();                    // started playing but the room is paused
    } else if (e.data === S.PAUSED && !c.playing){
      c.applyingUntil = 0;
    }
    return;                                          // (PAUSED while the room plays = blocked autoplay: the watchdog handles it)
  }
  // Phones pause media when you leave the app — that's not the room's decision
  if (document.hidden || Date.now() - ytLastVisibilityChange < 2000) return;

  // Settled: a change that disagrees with the room is a person using the player's own controls
  if (e.data === S.PLAYING && !c.playing) ytSetState(ch, { playing:true, position:ytLocalTime(c) });
  else if (e.data === S.PAUSED && c.playing) ytSetState(ch, { playing:false, position:ytLocalTime(c) });
}

// YouTube error codes: 2=invalid id, 5=HTML5 player error, 100=removed/private,
// 101 & 150=embedding disabled by the video's owner (the #1 reason official music videos won't play).
function ytOnError(ch, e){
  const messages = {
    2: "That link doesn't point to a valid video.",
    5: "This player can't play that video.",
    100: "That video was removed or is private.",
    101: "The video's owner doesn't allow it to be played in embedded players like this one.",
    150: "The video's owner doesn't allow it to be played in embedded players like this one."
  };
  const message = messages[e.data] || "That video can't be played here.";
  if (window.onChannelError) window.onChannelError(ch, message);
  else console.error(`YouTube player error on ${ch}:`, message);
}

// ---------- Shared state ----------
// The single place a local ACTION becomes room state: bump the counter, claim control, broadcast.
function ytSetState(ch, partial){
  const c = YTChannels[ch];
  Object.assign(c, partial);
  c.rev += 1;
  c.stateAt = Date.now();
  c.controller = (typeof myId !== 'undefined' && myId) ? myId : (c.controller || '');
  broadcast({ type:'video', channel:ch, action:'state',
    currentId:c.currentId, playing:c.playing, position:c.position, rev:c.rev, controller:c.controller });
}

function ytApplyRemoteState(ch, data){
  const rev = Number(data.rev), position = Number(data.position);
  if (!Number.isFinite(rev) || rev < 0 || rev > 1e9 || !Number.isFinite(position) || position < 0) return;
  const c = YTChannels[ch];
  const controller = String(data.controller || '');
  if (!ytIsNewer(rev, controller, c)) return;        // old or duplicate — we already have something newer

  const videoChanged = (data.currentId || null) !== c.currentId;
  c.currentId = data.currentId || null;
  c.playing = !!data.playing;
  c.position = position;
  c.rev = rev;
  c.controller = controller;
  c.stateAt = Date.now();
  if (!c.currentId) return;

  if (videoChanged && window.onChannelLoading) window.onChannelLoading(ch, c.currentId);
  ytApplyToPlayer(ch, videoChanged);
}

registerHandler('video', (fromId, data)=>{
  if (data.action !== 'state') return;
  if (data.channel !== 'video' && data.channel !== 'music') return;           // never index by an arbitrary remote key
  if (data.currentId != null && !isValidVideoId(data.currentId)) return;       // null = nothing loaded yet
  ytApplyRemoteState(data.channel, data);
});

// New joiners get a direct snapshot of what's loaded (not a broadcast, so nobody else's state changes).
if (typeof window !== 'undefined'){
  window.onPeerConnected = (function(prev){
    return function(peerId){
      if (prev) prev(peerId);
      ['video','music'].forEach(ch=>{
        const c = YTChannels[ch];
        if (!c.currentId) return;
        sendData(dataConns[peerId], { type:'video', channel:ch, action:'state',
          currentId:c.currentId, playing:c.playing, position:ytEstimatePosition(c),
          rev:c.rev, controller:c.controller || '' });
      });
    };
  })(window.onPeerConnected);
}

// Drift-correction heartbeat — only the controller, only while its own player is genuinely playing
// (a frozen player — tab hidden, autoplay blocked — must never drag everyone back to its position).
setInterval(()=>{
  ['video','music'].forEach(ch=>{
    const c = YTChannels[ch];
    if (!c.player || !c.ready || !c.currentId || !c.playing) return;
    if (typeof myId === 'undefined' || c.controller !== myId) return;
    if (document.hidden || Date.now() < c.applyingUntil) return;
    if (ytLocalState(c) !== 1) return;
    ytSetState(ch, { position: ytLocalTime(c) });
  });
}, YT_HEARTBEAT_MS);

// Coming back to the app: the OS may have paused or frozen the players — line them up again
let ytLastVisibilityChange = 0;
document.addEventListener('visibilitychange', ()=>{
  ytLastVisibilityChange = Date.now();
  if (document.hidden) return;
  ['video','music'].forEach(ch=>{ if (YTChannels[ch].currentId) ytApplyToPlayer(ch, false); });
});

// ---------- Public actions used by app.js / queue.js ----------
const YTSync = {
  load(ch, videoId){
    ytSetState(ch, { currentId:videoId, playing:true, position:0 });
    if (window.onChannelLoading) window.onChannelLoading(ch, videoId);
    ytApplyToPlayer(ch, true);
  },
  play(ch){
    const c = YTChannels[ch]; if (!c.currentId) return;
    ytSetState(ch, { playing:true, position: c.player && c.ready ? ytLocalTime(c) : c.position });
    ytApplyToPlayer(ch, false);
  },
  pause(ch){
    const c = YTChannels[ch]; if (!c.currentId) return;
    ytSetState(ch, { playing:false, position: c.player && c.ready ? ytLocalTime(c) : c.position });
    ytApplyToPlayer(ch, false);
  },
  stop(ch){
    const c = YTChannels[ch]; if (!c.player || !c.ready || !c.currentId) return;
    c.applyingUntil = 0;
    c.player.stopVideo();
    ytSetState(ch, { playing:false, position:0 });
  },
  syncToMe(ch){
    const c = YTChannels[ch]; if (!c.player || !c.ready || !c.currentId) return;
    ytSetState(ch, { position: ytLocalTime(c) });
  },
  seekTo(ch, secs){
    const c = YTChannels[ch]; if (!c.player || !c.ready || !c.currentId) return false;
    if (typeof secs !== 'number' || !isFinite(secs) || secs < 0) return false;
    c.player.seekTo(secs, true);
    ytSetState(ch, { position: secs });
    return true;
  },
  seek(ch, inputStr){
    const secs = parseTimeInput(inputStr);
    if (secs === null) return false;
    return YTSync.seekTo(ch, secs);
  },
  // "Tap to join": starts this device's player at the room's position (a real tap lets the browser play sound).
  // Local only — nothing is broadcast, so it can't disturb anyone else.
  joinPlayback(ch){
    const c = YTChannels[ch]; if (!c.currentId) return;
    ytSetBlocked(ch, false);
    if (!c.player || !c.ready){ ytApplyToPlayer(ch, true); return; }
    c.applyingUntil = Date.now() + YT_ECHO_WINDOW_MS;
    c.player.seekTo(ytEstimatePosition(c), true);
    if (c.playing){ c.player.playVideo(); ytWatchPlayback(ch); } else c.player.pauseVideo();
  }
};
