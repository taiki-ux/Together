/* ============================================================
   VIDEO-CALL.JS
   Camera video over its own PeerJS calls (separate from voice, so
   a bad connection can never break audio). Low-data by default,
   and adapts quality to the connection every few seconds.
   ============================================================ */

// Each tier is a cap on what we SEND. Capture is 480x360; smaller tiers
// shrink the picture and frame rate before sending.
const VIDEO_TIERS = [
  { label:'Data saver', scale:2,   fps:12, kbps:60  },  // ~240x180
  { label:'Low',        scale:1.5, fps:15, kbps:120 },  // ~320x240
  { label:'Clear',      scale:1,   fps:20, kbps:250 }   // 480x360
];

let camStream = null;
let camOn = false;
let camTier = 1;               // start small
let camMode = 'auto';          // 'auto' | 'saver' | 'clear'
let goodStreak = 0, criticalStreak = 0;
let adaptTimer = null;
const videoOut = {};           // peerId -> outgoing call (my camera to them)
const videoIn = {};            // peerId -> incoming call (their camera to me)
const videoEls = {};           // peerId -> <video> element (persists across grid redraws)

// ---------- Limits ----------
// Every person you send video to costs you a full copy of the upload.
function tierCap(){
  const n = Object.keys(videoOut).length;
  if (n >= 4) return 0;
  if (n >= 2) return 1;
  return 2;
}

// ---------- Camera on/off ----------
async function startCamera(){
  try{
    camStream = await navigator.mediaDevices.getUserMedia({
      video:{ width:{ideal:480}, height:{ideal:360}, frameRate:{ideal:20, max:24}, facingMode:'user' },
      audio:false
    });
  }catch(e){
    console.error('Camera failed:', e);
    const reason = e.name === 'NotAllowedError' ? 'Camera permission was denied.'
      : e.name === 'NotFoundError' ? 'No camera was found on this device.'
      : `Couldn't open your camera (${e.message || e.name || 'unknown error'}).`;
    toast(reason, 'err');
    return;
  }
  const track = camStream.getVideoTracks()[0];
  if (track) track.contentHint = 'motion';
  camOn = true;
  goodStreak = 0; criticalStreak = 0;
  if (participants[myId]) participants[myId].cam = true;

  const me = document.createElement('video');
  me.autoplay = true; me.muted = true; me.playsInline = true;
  me.srcObject = camStream;
  me.play().catch(()=>{});
  videoEls[myId] = me;

  Object.keys(dataConns).forEach(callPeerVideo);
  broadcast({ type:'cam', on:true });
  clearInterval(adaptTimer);
  adaptTimer = setInterval(adaptTick, 3000);
  updateCamUI();
  renderTalkGrid();
}

function stopCamera(){
  if (camStream) camStream.getTracks().forEach(t=> t.stop());
  camStream = null;
  camOn = false;
  clearInterval(adaptTimer);
  Object.values(videoOut).forEach(c=>{ try{ c.close(); }catch(e){} });
  Object.keys(videoOut).forEach(k=> delete videoOut[k]);
  if (videoEls[myId]){ videoEls[myId].srcObject = null; delete videoEls[myId]; }
  if (participants[myId]) participants[myId].cam = false;
  broadcast({ type:'cam', on:false });
  updateCamUI();
  renderTalkGrid();
}

function toggleCamera(){ return camOn ? stopCamera() : startCamera(); }

// ---------- Sending my camera to one person ----------
function callPeerVideo(peerId){
  if (!camStream || !peer || videoOut[peerId] || peerId === myId) return;
  const call = peer.call(peerId, camStream, { metadata:{ kind:'video' } });
  if (!call) return;
  videoOut[peerId] = call;
  call.on('close', ()=>{ if (videoOut[peerId] === call) delete videoOut[peerId]; });
  call.on('error', e=>{ console.warn('Video call error:', e); if (videoOut[peerId] === call) delete videoOut[peerId]; });
  // Sender settings can only be applied once the link is up
  const pc = call.peerConnection;
  if (pc) pc.addEventListener('connectionstatechange', ()=>{
    if (pc.connectionState === 'connected') applyTierToCall(call, camTier);
  });
  setTier(Math.min(camTier, tierCap()));
}

// ---------- Receiving someone's camera (called from peer-manager.js) ----------
function setupVideoConn(call){
  videoIn[call.peer] = call;
  call.on('stream', stream=>{
    let v = videoEls[call.peer];
    if (!v){
      v = document.createElement('video');
      v.autoplay = true; v.muted = true; v.playsInline = true; // voice arrives on its own call
      videoEls[call.peer] = v;
    }
    v.srcObject = stream;
    v.play().catch(()=>{});
    if (participants[call.peer]) participants[call.peer].cam = true;
    renderTalkGrid();
  });
  call.on('close', ()=> dropRemoteVideo(call.peer));
  call.on('error', ()=> dropRemoteVideo(call.peer));
}
function dropRemoteVideo(peerId){
  if (videoEls[peerId] && peerId !== myId){ videoEls[peerId].srcObject = null; delete videoEls[peerId]; }
  delete videoIn[peerId];
  if (participants[peerId]) participants[peerId].cam = false;
  renderTalkGrid();
}

registerHandler('cam', (fromId, data)=>{
  if (participants[fromId]) participants[fromId].cam = !!data.on;
  if (!data.on) dropRemoteVideo(fromId);
});

// ---------- Quality control ----------
async function applyTierToCall(call, idx){
  const t = VIDEO_TIERS[idx];
  const pc = call.peerConnection;
  if (!pc) return;
  const sender = pc.getSenders().find(s=> s.track && s.track.kind === 'video');
  if (!sender) return;
  try{
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = t.kbps * 1000;
    params.encodings[0].maxFramerate = t.fps;
    params.encodings[0].scaleResolutionDownBy = t.scale;
    await sender.setParameters(params);
  }catch(e){ /* not negotiated yet — the connectionstatechange hook retries */ }
}
function setTier(idx){
  camTier = Math.max(0, Math.min(idx, VIDEO_TIERS.length - 1));
  Object.values(videoOut).forEach(c=> applyTierToCall(c, camTier));
  updateCamUI();
}
function applyMode(){
  if (camMode === 'saver') setTier(0);
  else if (camMode === 'clear') setTier(tierCap());
  else setTier(Math.min(camTier, tierCap()));
}

async function adaptTick(){
  if (!camOn) return;
  let loss = 0, rtt = 0, limited = false, seen = false;
  for (const call of Object.values(videoOut)){
    const pc = call.peerConnection;
    if (!pc) continue;
    let stats;
    try{ stats = await pc.getStats(); }catch(e){ continue; }
    stats.forEach(r=>{
      if (r.type === 'remote-inbound-rtp' && r.kind === 'video'){
        seen = true;
        loss = Math.max(loss, r.fractionLost || 0);
        rtt = Math.max(rtt, r.roundTripTime || 0);
      }
      if (r.type === 'outbound-rtp' && r.kind === 'video' && r.qualityLimitationReason === 'bandwidth') limited = true;
    });
  }
  if (!seen) return;

  const bad = loss > 0.05 || rtt > 0.5 || limited;
  const great = loss < 0.01 && rtt < 0.25 && !limited;

  if (camMode === 'auto'){
    if (bad){ goodStreak = 0; if (camTier > 0) setTier(camTier - 1); }
    else if (great){
      goodStreak++;
      if (goodStreak >= 4 && camTier < tierCap()){ setTier(camTier + 1); goodStreak = 0; }
    } else goodStreak = 0;
  }

  // Still awful at the lowest level? Protect the voice call.
  if (camTier === 0 && loss > 0.15){
    criticalStreak++;
    if (criticalStreak >= 3){
      toast('Your connection is too weak for video — camera turned off so voice stays clear.', 'err');
      stopCamera();
    }
  } else criticalStreak = 0;
}

// Pause sending while the app is in the background
document.addEventListener('visibilitychange', ()=>{
  if (!camStream) return;
  camStream.getVideoTracks().forEach(t=> t.enabled = !document.hidden);
});

// ---------- New people / people leaving ----------
window.onPeerConnected = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (camOn){ callPeerVideo(peerId); applyMode(); }
    if (camOn) sendData(dataConns[peerId], { type:'cam', on:true });
  };
})(window.onPeerConnected);

window.onPeerRemoved = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (videoOut[peerId]){ try{ videoOut[peerId].close(); }catch(e){} delete videoOut[peerId]; }
    dropRemoteVideo(peerId);
    if (camOn) applyMode();
  };
})(window.onPeerRemoved);

// ---------- UI ----------
function updateCamUI(){
  const btn = document.getElementById('btn-cam-talk');
  if (btn){
    btn.textContent = camOn ? '📷 Stop camera' : '📷 Start camera';
    btn.classList.toggle('on', camOn);
  }
  const lbl = document.getElementById('video-quality-label');
  if (lbl){
    const t = VIDEO_TIERS[camTier];
    lbl.textContent = camOn
      ? `Sending: ${t.label} · up to ~${t.kbps} kbps per person watching you`
      : 'Camera is off — no video data is being used.';
  }
}
document.getElementById('btn-cam-talk').addEventListener('click', toggleCamera);
document.getElementById('select-video-quality').addEventListener('change', function(){
  camMode = this.value;
  applyMode();
});
updateCamUI();




// ---------- Floating faces strip (every page except Talk) ----------
let hideSelf = false;
let stripHidden = false;
let stripBigId = null;

function placeVideos(){
  const strip = document.getElementById('video-strip');
  const list = document.getElementById('video-strip-list');
  const grid = document.getElementById('talk-grid');
  const talkPane = document.getElementById('pane-talk');
  if (!strip || !list) return;

  const talkActive = !!(talkPane && talkPane.classList.contains('active'));
  list.innerHTML = '';
  const ids = Object.keys(videoEls);
  let shown = 0;

  ids.forEach(id=>{
    const v = videoEls[id];
    v.classList.toggle('self-video', id === myId);

    if (talkActive && grid){
      const tile = Array.from(grid.children).find(t=> t.dataset.id === id);
      if (tile){
        tile.classList.add('has-video');
        tile.querySelector('.video-slot').appendChild(v);
        v.play().catch(()=>{});
        return;
      }
    }

    if (id === myId && hideSelf) return; // my face stays out of the strip

    const p = participants[id] || {};
    const b = document.createElement('div');
    b.className = 'strip-bubble' + (id === stripBigId ? ' big' : '');
    b.appendChild(v);
    const chip = document.createElement('span');
    chip.className = 'avatar strip-chip';
    chip.dataset.peer = id;
    chip.textContent = initials(p.name);
    chip.style.background = nameColor(p.name || '?');
    if (speakingState[id]) chip.classList.add('speaking');
    b.appendChild(chip);
    b.addEventListener('click', ()=>{ stripBigId = (stripBigId === id) ? null : id; placeVideos(); });
    list.appendChild(b);
    v.play().catch(()=>{});
    shown++;
  });

  strip.style.display = (!talkActive && (shown > 0 || (camOn && hideSelf))) ? 'flex' : 'none';
  strip.classList.toggle('collapsed', stripHidden);
  const toggle = document.getElementById('video-strip-toggle');
  if (toggle) toggle.textContent = stripHidden ? '📷 Show faces' : '– Hide';
  const selfBtn = document.getElementById('video-strip-self');
  if (selfBtn){
    selfBtn.style.display = camOn ? '' : 'none';
    selfBtn.textContent = hideSelf ? '👁 Show me' : 'hide me';
  }
}

document.getElementById('video-strip-self').addEventListener('click', ()=>{
  hideSelf = !hideSelf;
  placeVideos();
});
document.getElementById('video-strip-toggle').addEventListener('click', ()=>{
  stripHidden = !stripHidden;
  placeVideos();
});
