/* ============================================================
   VOICE.JS
   Everything layered on top of the core WebRTC plumbing in
   peer-manager.js (which still owns localStream/mediaConns/
   audioEls/acquireMicStream/attachSpeakingDetector):

   - Microphone only held while you're unmuted (keeps phones out of "call mode")
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

// ---------- Microphone lifecycle ----------
// An open microphone puts a phone into "call mode": everything else it plays gets quieter and
// tinny and may be routed to the earpiece. That is the "sounds like a phone call" effect people
// heard on the room's music. So the mic is held ONLY while you're unmuted (or holding
// push-to-talk) and released a few seconds after you mute. Hearing everyone needs no mic at all.
const MIC_RELEASE_AFTER_MS = 6000;     // a quick mute/unmute stays instant; longer than this returns the phone to normal audio
let micReleaseTimer = null;
let selectedMicId = null;
let micChain = Promise.resolve();      // makes rapid taps / push-to-talk presses apply strictly in order

function micStreamLive(){ return !!localStream && localStream.getAudioTracks().some(t=> t.readyState === 'live'); }

// Put the current mic track on every voice call: swap it in where we already send audio,
// start a fresh call where we had only been listening.
function sendMicToPeers(){
  const track = localStream && localStream.getAudioTracks()[0];
  if (!track) return;
  Object.keys(dataConns).forEach(id=>{
    const call = mediaConns[id];
    if (!call){ maybeCallPeer(id); return; }
    if (call._sendsAudio && call.peerConnection){
      const sender = call.peerConnection.getSenders().find(s=> !s.track || s.track.kind === 'audio');
      if (sender){ sender.replaceTrack(track).catch(()=>{}); return; }
    }
    try{ call.close(); }catch(e){}
    delete mediaConns[id];
    maybeCallPeer(id);
  });
}

async function applyMicEnabled(on){
  if (on){
    clearTimeout(micReleaseTimer);
    if (!micStreamLive()){
      localStream = await acquireMicStream(selectedMicId || undefined);
      attachSpeakingDetector(localStream, myId);
    }
    localStream.getAudioTracks().forEach(t=> t.enabled = true);
    micOn = true;
    sendMicToPeers();
    updateMicButtonsUI(true);
    broadcast({ type:'mic', muted:false });
  } else {
    micOn = false;
    if (localStream) localStream.getAudioTracks().forEach(t=> t.enabled = false);
    updateMicButtonsUI(false);
    broadcast({ type:'mic', muted:true });
    clearTimeout(micReleaseTimer);
    micReleaseTimer = setTimeout(releaseMicStream, MIC_RELEASE_AFTER_MS);
  }
}
function setMicEnabled(on){
  const run = micChain.then(()=> applyMicEnabled(on));
  micChain = run.catch(()=>{});
  return run;
}
function releaseMicStream(){
  if (micOn || !localStream) return;
  localStream.getTracks().forEach(t=> t.stop());
  localStream = null;
}

// ---------- Deafen ----------
function toggleDeafen(){
  deafened = !deafened;
  if (deafened && micOn) setMicEnabled(false);
  Object.keys(audioEls).forEach(peerId=> applyAudioSettings(peerId));
  updateDeafenButtonsUI();
}
function updateDeafenButtonsUI(){
  ['btn-deafen-talk'].forEach(id=>{
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = deafened ? '🔇' : '🔊';
    btn.title = deafened ? 'Undeafen' : 'Deafen';
    btn.classList.toggle('on', deafened);
  });
}
document.getElementById('btn-deafen-talk')?.addEventListener('click', toggleDeafen);

// ---------- Push-to-talk ----------
function setupPushToTalkButton(id){
  const btn = document.getElementById(id);
  if (!btn) return;
  let held = false;
  const pressStart = async (e)=>{
    if (!pushToTalkOn) return;
    e.preventDefault();
    held = true;
    try{ await setMicEnabled(true); }
    catch(err){ held = false; toast("Couldn't access your microphone", 'err'); }
  };
  const pressEnd = ()=>{
    if (!pushToTalkOn || !held) return;
    held = false;
    setMicEnabled(false);
  };
  btn.addEventListener('mousedown', pressStart);
  btn.addEventListener('touchstart', pressStart, { passive:false });
  btn.addEventListener('mouseup', pressEnd);
  btn.addEventListener('mouseleave', pressEnd);
  btn.addEventListener('touchend', pressEnd);
}
setupPushToTalkButton('btn-mic-talk');

document.getElementById('toggle-push-to-talk')?.addEventListener('click', function(){
  pushToTalkOn = !pushToTalkOn;
  this.classList.toggle('on', pushToTalkOn);
  if (pushToTalkOn && micOn) setMicEnabled(false);   // switching into PTT mid-call — go silent until they hold the button
  updateMicButtonsUI(micOn);
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
