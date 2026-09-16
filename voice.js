/* ============================================================
   VOICE.JS
   Everything layered on top of the core WebRTC plumbing in
   peer-manager.js (which still owns localStream/mediaConns/
   audioEls/acquireMicStream/attachSpeakingDetector):

   - Auto-join voice on room entry (togglable in Settings)
   - Per-person local volume + local-only mute (Talk pane tiles)
   - Deafen (mute your ears AND your mic in one tap)
   - Push-to-talk (hold the mic button instead of toggling it)
   - Mic test with a live level meter
   - Connection-quality dot per person, via RTCPeerConnection.getStats()
   - Auto-reconnect hook for dropped media connections (the actual
     retry call lives in peer-manager.js's setupMediaConn; this
     file just provides attemptMediaReconnect for it to call)
   ============================================================ */

// ---------- State ----------
window.autoJoinVoiceOn = true;
let pushToTalkOn = false;
let deafened = false;
const localVolumes = {};        // peerId -> 0-100 (defaults to 100)
const locallyMutedPeers = new Set();
const connectionQuality = {};   // peerId -> 'good' | 'unstable' | 'poor' | null

// ---------- Per-person audio settings ----------
function applyAudioSettings(peerId, audioEl){
  const el = audioEl || audioEls[peerId];
  if (!el) return;
  el.volume = (deafened || locallyMutedPeers.has(peerId)) ? 0 : (localVolumes[peerId] ?? 100) / 100;
}
function setLocalVolume(peerId, value){
  localVolumes[peerId] = value;
  applyAudioSettings(peerId);
}
function toggleLocalMute(peerId){
  if (locallyMutedPeers.has(peerId)) locallyMutedPeers.delete(peerId);
  else locallyMutedPeers.add(peerId);
  applyAudioSettings(peerId);
  renderTalkGrid(); // cheapest way to refresh that one button's icon
}

// ---------- Deafen ----------
function toggleDeafen(){
  deafened = !deafened;
  if (deafened && micOn){
    micOn = false;
    if (localStream) localStream.getAudioTracks().forEach(t=> t.enabled=false);
    updateMicButtonsUI(false);
    broadcast({ type:'mic', muted:true });
  }
  Object.keys(audioEls).forEach(peerId=> applyAudioSettings(peerId));
  updateDeafenButtonsUI();
}
function updateDeafenButtonsUI(){
  ['btn-deafen','btn-deafen-talk'].forEach(id=>{
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = deafened ? '🔇' : '🔊';
    btn.title = deafened ? 'Undeafen' : 'Deafen';
    btn.classList.toggle('on', deafened);
  });
}
document.getElementById('btn-deafen')?.addEventListener('click', toggleDeafen);
document.getElementById('btn-deafen-talk')?.addEventListener('click', toggleDeafen);

// ---------- Auto-join on room entry ----------
async function autoJoinVoiceIfEnabled(){
  if (!window.autoJoinVoiceOn) return;
  if (pushToTalkOn){
    // Connect and stay ready, but silent until they actually hold the button —
    // matches push-to-talk's "silent by default" expectation.
    if (!localStream){
      try{
        localStream = await acquireMicStream();
        attachSpeakingDetector(localStream, myId);
        localStream.getAudioTracks().forEach(t=> t.enabled = false);
        Object.keys(dataConns).forEach(id=> maybeCallPeer(id));
      }catch(e){ console.warn('Auto-join (push-to-talk) skipped:', e.message || e); }
    }
  } else {
    toggleMic();
  }
}

// ---------- Push-to-talk ----------
function setupPushToTalkButton(id){
  const btn = document.getElementById(id);
  if (!btn) return;
  const pressStart = async (e)=>{
    if (!pushToTalkOn) return;
    e.preventDefault();
    if (!localStream){
      try{
        localStream = await acquireMicStream();
        attachSpeakingDetector(localStream, myId);
        Object.keys(dataConns).forEach(pid=> maybeCallPeer(pid));
      }catch(err){ toast("Couldn't access your microphone", 'err'); return; }
    }
    micOn = true;
    localStream.getAudioTracks().forEach(t=> t.enabled = true);
    updateMicButtonsUI(true);
    broadcast({ type:'mic', muted:false });
  };
  const pressEnd = ()=>{
    if (!pushToTalkOn || !localStream) return;
    micOn = false;
    localStream.getAudioTracks().forEach(t=> t.enabled = false);
    updateMicButtonsUI(false);
    broadcast({ type:'mic', muted:true });
  };
  btn.addEventListener('mousedown', pressStart);
  btn.addEventListener('touchstart', pressStart, { passive:false });
  btn.addEventListener('mouseup', pressEnd);
  btn.addEventListener('mouseleave', pressEnd);
  btn.addEventListener('touchend', pressEnd);
}
setupPushToTalkButton('btn-mic');
setupPushToTalkButton('btn-mic-talk');

document.getElementById('toggle-push-to-talk')?.addEventListener('click', function(){
  pushToTalkOn = !pushToTalkOn;
  this.classList.toggle('on', pushToTalkOn);
  if (pushToTalkOn && micOn){
    // Switching into PTT mid-call — go silent until they hold the button.
    micOn = false;
    if (localStream) localStream.getAudioTracks().forEach(t=> t.enabled=false);
    broadcast({ type:'mic', muted:true });
  }
  updateMicButtonsUI(micOn);
});
document.getElementById('toggle-autojoin-voice')?.addEventListener('click', function(){
  window.autoJoinVoiceOn = !window.autoJoinVoiceOn;
  this.classList.toggle('on', window.autoJoinVoiceOn);
});

// ---------- Talk-tile voice controls (quality dot + local mute + volume) ----------
function buildVoiceControlsForTile(peerId){
  const wrap = document.createElement('div');
  wrap.className = 'talk-voice-controls';

  const qualityDot = document.createElement('span');
  qualityDot.className = 'quality-dot';
  qualityDot.dataset.qualityDot = peerId;
  qualityDot.textContent = qualityEmoji(connectionQuality[peerId]);
  wrap.appendChild(qualityDot);

  if (peerId !== myId){
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'icon-btn local-mute-btn';
    muteBtn.textContent = locallyMutedPeers.has(peerId) ? '🔇' : '🔊';
    muteBtn.title = 'Mute locally (only for you)';
    muteBtn.addEventListener('click', ()=> toggleLocalMute(peerId));
    wrap.appendChild(muteBtn);

    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100';
    slider.className = 'volume-slider';
    slider.value = String(localVolumes[peerId] ?? 100);
    slider.title = 'Volume (only for you)';
    slider.addEventListener('input', ()=> setLocalVolume(peerId, parseInt(slider.value,10)));
    wrap.appendChild(slider);
  }
  return wrap;
}
function qualityEmoji(q){ return q === 'good' ? '🟢' : q === 'unstable' ? '🟡' : q === 'poor' ? '🔴' : ''; }
function refreshConnectionQualityDots(){
  document.querySelectorAll('[data-quality-dot]').forEach(el=>{
    el.textContent = qualityEmoji(connectionQuality[el.dataset.qualityDot]);
  });
}

// ---------- Connection quality (RTCPeerConnection.getStats()) ----------
async function assessConnectionQuality(peerId){
  const call = mediaConns[peerId];
  if (!call || !call.peerConnection) return null;
  try{
    const stats = await call.peerConnection.getStats();
    let packetsLost = 0, packetsReceived = 0, jitter = 0, found = false;
    stats.forEach(report=>{
      if (report.type === 'inbound-rtp' && report.kind === 'audio'){
        packetsLost += report.packetsLost || 0;
        packetsReceived += report.packetsReceived || 0;
        jitter = Math.max(jitter, report.jitter || 0);
        found = true;
      }
    });
    if (!found) return null;
    const lossRatio = (packetsLost + packetsReceived) > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
    if (lossRatio < 0.03 && jitter < 0.03) return 'good';
    if (lossRatio < 0.1) return 'unstable';
    return 'poor';
  }catch(e){ return null; }
}
setInterval(async ()=>{
  const ids = Object.keys(mediaConns);
  if (!ids.length) return;
  for (const id of ids) connectionQuality[id] = await assessConnectionQuality(id);
  refreshConnectionQualityDots();
}, 4000);

// ---------- Auto-reconnect (called from peer-manager.js on connection failure) ----------
function attemptMediaReconnect(peerId){
  if (!localStream || !participants[peerId]) return;
  if (mediaConns[peerId]){ try{ mediaConns[peerId].close(); }catch(e){} delete mediaConns[peerId]; }
  if (audioEls[peerId]){ audioEls[peerId].remove(); delete audioEls[peerId]; }
  maybeCallPeer(peerId);
}

// ---------- Mic test ----------
let micTestStream = null;   // only set if we created a stream JUST for testing (needs cleanup)
let micTestCtx = null;
let micTestAnimFrame = null;

async function startMicTest(){
  const btn = document.getElementById('btn-mic-test');
  try{
    const deviceId = document.getElementById('select-mic')?.value || undefined;
    const stream = localStream || await acquireMicStream(deviceId);
    if (!localStream) micTestStream = stream;
    micTestCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = micTestCtx.createMediaStreamSource(stream);
    const analyser = micTestCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    if (btn) btn.textContent = '⏹ Stop test';
    (function tick(){
      analyser.getByteFrequencyData(buf);
      let sum = 0; for (let i=0;i<buf.length;i++) sum += buf[i];
      const level = Math.min(100, Math.round((sum / buf.length) * 1.5));
      const meter = document.getElementById('mic-test-meter');
      if (meter) meter.style.width = level + '%';
      micTestAnimFrame = requestAnimationFrame(tick);
    })();
  }catch(e){
    toast("Couldn't access your microphone to test it", 'err');
  }
}
function stopMicTest(){
  if (micTestAnimFrame) cancelAnimationFrame(micTestAnimFrame);
  micTestAnimFrame = null;
  if (micTestCtx){ try{ micTestCtx.close(); }catch(e){} micTestCtx = null; }
  if (micTestStream){ micTestStream.getTracks().forEach(t=> t.stop()); micTestStream = null; }
  const meter = document.getElementById('mic-test-meter');
  if (meter) meter.style.width = '0%';
  const btn = document.getElementById('btn-mic-test');
  if (btn) btn.textContent = '🎚 Test microphone';
}
document.getElementById('btn-mic-test')?.addEventListener('click', ()=>{
  if (micTestAnimFrame) stopMicTest(); else startMicTest();
});
document.getElementById('btn-settings-close')?.addEventListener('click', stopMicTest);
document.getElementById('settings-overlay')?.addEventListener('click', e=>{ if (e.target.id === 'settings-overlay') stopMicTest(); });
