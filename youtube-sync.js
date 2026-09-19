/* ============================================================
   YOUTUBE-SYNC.JS
   Room Playback State model (Phase 0 rebuild).

   Each channel (video/music) keeps ONE authoritative state —
   { currentId, playing, position, lastUpdated, controller } —
   instead of broadcasting individual play/pause/seek/heartbeat
   messages and hoping everyone converges on the same thing.

   Whoever last took a playback action (pressed Play, Pause,
   Seek, loaded something new) becomes that channel's controller
   and stamps the update with lastUpdated = Date.now(). Peers
   only apply an incoming update if it's newer than the one they
   already have. That single rule is what stops two people's
   Play/Pause from fighting each other forever — the room always
   converges on whichever action actually happened last, instead
   of both sides re-broadcasting in response to one another.

   Only the current controller sends the periodic drift-correction
   heartbeat (and only while actually playing) — not everyone
   whose local player happens to be playing — which also cuts
   down on unnecessary network chatter in bigger rooms.

   Local YT.Player instances are NOT the synced state — they're
   just kept in step with it.
   ============================================================ */

let ytApiReady = false;
const ytTag = document.createElement('script');
ytTag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(ytTag);
window.onYouTubeIframeAPIReady = function(){ ytApiReady = true; };

const YTChannels = {
  video: { containerId:'yt-player-video', player:null, ready:false, suppress:false,
           currentId:null, playing:false, position:0, lastUpdated:0, controller:null },
  music: { containerId:'yt-player-music', player:null, ready:false, suppress:false,
           currentId:null, playing:false, position:0, lastUpdated:0, controller:null }
};

function extractVideoId(input){
  input = (input||'').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  const m = input.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}
function isSpotifyLink(input){ return /open\.spotify\.com/i.test(input||''); }
function parseTimeInput(str){
  str = (str||'').trim();
  if (/^\d+$/.test(str)) return parseInt(str,10);
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  let secs = 0; for (const p of parts) secs = secs*60 + p;
  return secs;
}

// Where playback SHOULD be right now, given a state snapshot and however
// long it's been since that snapshot was taken.
function ytEstimatePosition(c){
  return c.playing ? c.position + (Date.now() - c.lastUpdated)/1000 : c.position;
}

function ytEnsurePlayerAndLoad(ch, videoId, startTime){
  const c = YTChannels[ch];
  if (window.onChannelLoading) window.onChannelLoading(ch, videoId);
  if (!ytApiReady || typeof YT==='undefined'){ setTimeout(()=>ytEnsurePlayerAndLoad(ch,videoId,startTime),300); return; }
  if (!c.player){
    c.player = new YT.Player(c.containerId, {
      videoId: videoId,
      playerVars:{ rel:0, playsinline:1 },
      events:{
        onReady: ()=>{
          c.ready = true;
          if (typeof startTime==='number' && startTime>0) c.player.seekTo(startTime,true);
          // A new player defaults to autoplaying — respect the room's actual
          // state instead (matters most for late joiners landing on a paused room).
          if (!c.playing) c.player.pauseVideo();
        },
        onStateChange: (e)=>ytOnStateChange(ch,e),
        onError: (e)=>ytOnError(ch,e)
      }
    });
  } else {
    c.player.loadVideoById(videoId, (typeof startTime==='number')?startTime:0);
  }
}

function ytOnStateChange(ch,e){
  const c = YTChannels[ch];
  if (window.onChannelStateChange) window.onChannelStateChange(ch, e.data);
  if (c.suppress) return; // echo of our own action or a remotely-applied update — already handled
  if (e.data === YT.PlayerState.PLAYING) ytSetState(ch, { playing:true, position:c.player.getCurrentTime() }, true);
  else if (e.data === YT.PlayerState.PAUSED) ytSetState(ch, { playing:false, position:c.player.getCurrentTime() }, true);
}

// YouTube error codes: 2=invalid id, 5=HTML5 player error, 100=removed/private,
// 101 & 150=embedding disabled by the video's owner (very common on official
// music videos specifically — this is the #1 real-world reason "music won't
// play" while random video content works fine).
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

// The single place that updates local state AND broadcasts it.
function ytSetState(ch, partial, claimController){
  const c = YTChannels[ch];
  Object.assign(c, partial);
  c.lastUpdated = Date.now();
  if (claimController && typeof myId !== 'undefined' && myId) c.controller = myId;
  broadcast({ type:'video', channel:ch, action:'state',
    currentId:c.currentId, playing:c.playing, position:c.position,
    lastUpdated:c.lastUpdated, controller:c.controller });
}

function ytApplyRemoteState(ch, data){
  const c = YTChannels[ch];
  if (data.lastUpdated <= c.lastUpdated) return; // stale or duplicate — we already have something newer

  const videoChanged = data.currentId !== c.currentId;
  c.currentId = data.currentId; c.playing = data.playing; c.position = data.position;
  c.lastUpdated = data.lastUpdated; c.controller = data.controller;
  if (!data.currentId) return;

  c.suppress = true;
  const targetPosition = ytEstimatePosition(c);
  if (!c.player || videoChanged){
    ytEnsurePlayerAndLoad(ch, data.currentId, targetPosition);
  } else {
    const localTime = c.player.getCurrentTime();
    if (Math.abs(localTime - targetPosition) > 1.5) c.player.seekTo(targetPosition, true);
    const localPlaying = c.player.getPlayerState()===1;
    if (localPlaying !== c.playing) c.playing ? c.player.playVideo() : c.player.pauseVideo();
  }
  setTimeout(()=>{ c.suppress=false; }, 900);
}
registerHandler('video', (fromId, data)=>{ if (data.action==='state') ytApplyRemoteState(data.channel, data); });

// New joiners get a direct, freshly-timestamped snapshot of whatever's
// currently loaded — not a broadcast, so it doesn't affect anyone else's state.
if (typeof window !== 'undefined'){
  window.onPeerConnected = (function(prev){
    return function(peerId){
      if (prev) prev(peerId);
      ['video','music'].forEach(ch=>{
        const c = YTChannels[ch];
        if (!c.currentId) return;
        sendData(dataConns[peerId], { type:'video', channel:ch, action:'state',
          currentId:c.currentId, playing:c.playing, position:ytEstimatePosition(c),
          lastUpdated:Date.now(), controller:c.controller });
      });
    };
  })(window.onPeerConnected);
}

// Drift-correction heartbeat — only the controller sends it, and only while playing.
setInterval(()=>{
  ['video','music'].forEach(ch=>{
    const c = YTChannels[ch];
    if (!c.player || !c.ready || !c.currentId) return;
    if (typeof myId==='undefined' || c.controller !== myId || !c.playing) return;
    ytSetState(ch, { position: c.player.getCurrentTime() }, false);
  });
}, 5000);

// ---------- Public actions used by app.js ----------
const YTSync = {
  load(ch, videoId){
    const c = YTChannels[ch];
    c.suppress = true;
    ytEnsurePlayerAndLoad(ch, videoId, 0);
    ytSetState(ch, { currentId:videoId, playing:true, position:0 }, true);
    setTimeout(()=>{ c.suppress=false; }, 900);
  },
  play(ch){
    const c = YTChannels[ch];
    c.suppress = true;
    if (c.player) c.player.playVideo();
    ytSetState(ch, { playing:true, position: c.player ? c.player.getCurrentTime() : c.position }, true);
    setTimeout(()=>{ c.suppress=false; }, 900);
  },
  pause(ch){
    const c = YTChannels[ch];
    c.suppress = true;
    if (c.player) c.player.pauseVideo();
    ytSetState(ch, { playing:false, position: c.player ? c.player.getCurrentTime() : c.position }, true);
    setTimeout(()=>{ c.suppress=false; }, 900);
  },
  syncToMe(ch){
    const c = YTChannels[ch]; if (!c.player || !c.currentId) return;
    ytSetState(ch, { position: c.player.getCurrentTime() }, true);
  },
  seek(ch, inputStr){
    const c = YTChannels[ch]; if (!c.player) return false;
    const secs = parseTimeInput(inputStr);
    if (secs===null) return false;
    c.suppress = true;
    c.player.seekTo(secs,true);
    ytSetState(ch, { position: secs }, true);
    setTimeout(()=>{ c.suppress=false; }, 900);
    return true;
  }
};
