/* ============================================================
   PEER-MANAGER.JS
   PeerJS signaling/data/audio plumbing, participant roster,
   chat transport, and the DataHandlers dispatch registry that
   the other modules (youtube-sync, music-player, games) hook
   into. Everything here is shared, room-level state.
   ============================================================ */

// ---------- Utils ----------
function generateRoomCode(){
  // Cryptographically random 24-char hex — not guessable, unlike the old
  // friendly word-pair codes. A little less pretty to share, a lot safer.
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function nameColor(name){
  let hash=0;
  for(let i=0;i<name.length;i++){ hash = name.charCodeAt(i) + ((hash<<5)-hash); }
  return `hsl(${Math.abs(hash)%360},70%,62%)`;
}
function initials(name){ return (name||'?').trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

// ---------- Shared room state ----------
let peer=null, myId=null, myName='', roomCode='', isHost=false;
const dataConns = {};
const mediaConns = {};
const audioEls = {};
let participants = {};
let localStream = null;
let micOn = false;
let currentMode = null;      // 'video' | 'music' | 'games' — null until chosen
const speakingState = {};

// ---------- Dispatch registry ----------
// Other modules call registerHandler('type', fn) at load time; fn(fromId, data)
const DataHandlers = {};
function registerHandler(type, fn){ DataHandlers[type] = fn; }
function handleData(fromId, data){
  const fn = DataHandlers[data.type];
  if (fn) fn(fromId, data);
}

// ---------- Session persistence (survive a reload) ----------
function saveSession(){
  sessionStorage.setItem('together_room', roomCode);
  sessionStorage.setItem('together_name', myName);
  sessionStorage.setItem('together_ishost', isHost ? 'true' : 'false');
}
function clearSession(){
  sessionStorage.removeItem('together_room');
  sessionStorage.removeItem('together_name');
  sessionStorage.removeItem('together_ishost');
}
function getSavedSession(){
  const savedRoom = sessionStorage.getItem('together_room');
  const savedName = sessionStorage.getItem('together_name');
  const savedHost = sessionStorage.getItem('together_ishost');
  if (savedRoom && savedName) return { room:savedRoom, name:savedName, isHost: savedHost==='true' };
  return null;
}

// ---------- PeerJS plumbing (discovery now via Supabase Realtime presence — see joinRoomPresence) ----------
function initPeer(){
  peer = new Peer({debug:0}); // always a random id; roomCode is just the Supabase channel name now

  peer.on('open', id=>{
    myId = id;
    participants[myId] = {name: myName};
    saveSession();
    joinRoomPresence();
    if (window.onPeerReady) window.onPeerReady();
    renderOrbit();
  });

  peer.on('connection', conn=> setupDataConn(conn));

  peer.on('call', call=>{
    call.answer(localStream || undefined);
    setupMediaConn(call);
  });

  peer.on('error', err=>{
    console.error('Peer error:', err);
    if (window.onPeerError) window.onPeerError(String(err.type||err));
  });
}

// ---------- Room discovery via Supabase Realtime presence ----------
// Replaces the old "dial the host's PeerJS id" bootstrap. Every client
// tracks its own {peerId, name} in a channel named after the room code;
// presence sync/join/leave events are the single source of truth for who's
// in the room, so the room keeps working even if whoever created it leaves.
let roomChannel = null;
function joinRoomPresence(){
  if (!window.supabaseClient){
    if (window.onPeerError) window.onPeerError("Can't reach the room service — check your connection and try again.");
    return;
  }
  roomChannel = supabaseClient.channel(`room:${roomCode}`, { config: { presence: { key: myId } } });
  roomChannel
    .on('presence', { event:'sync' }, ()=>{
      // Full snapshot — used once on join to find everyone already here (no "joined" spam)
      const state = roomChannel.presenceState();
      Object.values(state).forEach(entries=> entries.forEach(entry=>{
        if (entry.peerId === myId) return;
        if (!participants[entry.peerId]) participants[entry.peerId] = { name: entry.name };
        connectToPeer(entry.peerId);
      }));
      renderOrbit();
    })
    .on('presence', { event:'join' }, ({ newPresences })=>{
      newPresences.forEach(p=>{
        if (p.peerId === myId) return;
        if (!participants[p.peerId]){ participants[p.peerId] = { name:p.name }; addSystemMessage(`${p.name} joined the room`); }
        connectToPeer(p.peerId);
      });
      renderOrbit();
    })
    .on('presence', { event:'leave' }, ({ leftPresences })=>{
      leftPresences.forEach(p=>{ if (p.peerId !== myId) removePeer(p.peerId); });
    })
    .subscribe(async (status)=>{
      if (status === 'SUBSCRIBED') await roomChannel.track({ peerId: myId, name: myName });
    });
}
function leaveRoomPresence(){
  if (!roomChannel) return;
  try{ roomChannel.untrack(); supabaseClient.removeChannel(roomChannel); }catch(e){}
  roomChannel = null;
}

function connectToPeer(targetId){
  if (!targetId || targetId === myId || dataConns[targetId]) return;
  const conn = peer.connect(targetId, {metadata:{name:myName}, reliable:true});
  setupDataConn(conn);
}

function setupDataConn(conn){
  conn.on('open', ()=>{
    dataConns[conn.peer] = conn;
    sendData(conn, {type:'hello', mode: currentMode});
    if (window.onPeerConnected) window.onPeerConnected(conn.peer);
    maybeCallPeer(conn.peer);
  });
  conn.on('data', data=> handleData(conn.peer, data));
  conn.on('close', ()=> removePeer(conn.peer));
}

function setupMediaConn(call){
  mediaConns[call.peer] = call;
  call.on('stream', remoteStream=>{
    let audioEl = audioEls[call.peer];
    if (!audioEl){
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.volume = 1.0;
      if ('playsInline' in audioEl) audioEl.playsInline = true;
      document.body.appendChild(audioEl);
      audioEls[call.peer] = audioEl;
    }
    audioEl.srcObject = remoteStream;
    audioEl.play().catch(err=> console.warn('Audio play blocked:', err));
    attachSpeakingDetector(remoteStream, call.peer);
  });
  call.on('close', ()=>{
    if (audioEls[call.peer]){ audioEls[call.peer].remove(); delete audioEls[call.peer]; }
    delete mediaConns[call.peer];
  });
}

function maybeCallPeer(peerId){
  if (!localStream || mediaConns[peerId]) return;
  setupMediaConn(peer.call(peerId, localStream));
}

function sendData(conn, obj){
  try{ if (conn.open) conn.send(obj); }catch(e){ console.warn(e); }
}
function broadcast(obj){
  for (const id in dataConns) sendData(dataConns[id], obj);
}

function removePeer(peerId){
  const name = participants[peerId]?.name || 'Someone';
  delete dataConns[peerId];
  if (mediaConns[peerId]){ mediaConns[peerId].close(); delete mediaConns[peerId]; }
  if (audioEls[peerId]){ audioEls[peerId].remove(); delete audioEls[peerId]; }
  if (participants[peerId]){ delete participants[peerId]; addSystemMessage(`${name} left the room`); }
  if (window.onPeerRemoved) window.onPeerRemoved(peerId);
  renderOrbit();
}

// ---------- Core handlers: mode sync, rename, chat, mic ----------
// Roster discovery/join/leave now lives in joinRoomPresence() (Supabase Realtime).
// 'hello' still travels over the fresh data connection purely to hand the
// current activity mode to whoever just connected.
registerHandler('hello', (fromId, data)=>{
  if (data.mode && window.onRemoteMode) window.onRemoteMode(data.mode);
});
registerHandler('rename', (fromId, data)=>{
  if (participants[fromId]){
    addSystemMessage(`${participants[fromId].name} is now "${data.name}"`);
    participants[fromId].name = data.name;
    renderOrbit();
  }
});
registerHandler('chat', (fromId, data)=>{
  addChatMessage(data.name, data.text, false, !!data.isAI);
  if (window.onChatReceived) window.onChatReceived();
});
registerHandler('mic', (fromId, data)=>{
  if (participants[fromId]) participants[fromId].muted = data.muted;
  renderOrbit();
});
registerHandler('mode', (fromId, data)=>{
  if (window.onRemoteMode) window.onRemoteMode(data.mode);
});

// ---------- Speaking detection ----------
function attachSpeakingDetector(stream, key){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    (function tick(){
      analyser.getByteFrequencyData(buf);
      let sum=0; for (let i=0;i<buf.length;i++) sum+=buf[i];
      const speaking = (sum/buf.length) > 14;
      if (speakingState[key]!==speaking){
        speakingState[key]=speaking;
        const el = document.querySelector(`.avatar[data-peer="${key}"]`);
        if (el) el.classList.toggle('speaking', speaking);
      }
      requestAnimationFrame(tick);
    })();
  }catch(e){ console.warn('speaking detector failed', e); }
}

// ---------- Mic (device stream + toggle used by app.js) ----------
async function acquireMicStream(deviceId){
  const constraints = { audio: {
    echoCancellation:true, noiseSuppression:true, autoGainControl:true,
    channelCount:1, sampleRate:48000,
    ...(deviceId ? {deviceId:{exact:deviceId}} : {})
  }};
  return navigator.mediaDevices.getUserMedia(constraints);
}

// ---------- Chat ----------
function sendChatMessage(name, text, isAI){
  addChatMessage(name, text, true, !!isAI);
  broadcast({type:'chat', name, text, isAI: !!isAI});
}
function addChatMessage(name, text, mine, isAI){
  const log = document.getElementById('chat-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'msg' + (isAI ? ' ai' : '');
  const color = isAI ? 'var(--violet)' : (mine ? 'var(--gold)' : nameColor(name));
  div.innerHTML = `<div class="who" style="color:${color}">${escapeHtml(name)}</div><div class="txt">${escapeHtml(text)}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function addSystemMessage(text){
  const log = document.getElementById('chat-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------- Orbit (participant avatars) ----------
function renderOrbit(){
  const orbit = document.getElementById('orbit');
  if (!orbit) return;
  orbit.innerHTML = '';
  const ids = Object.keys(participants);
  const countEl = document.getElementById('participant-count');
  if (countEl) countEl.textContent = `In the room · ${ids.length}`;
  ids.forEach(id=>{
    const p = participants[id];
    const wrap = document.createElement('div'); wrap.className='avatar-wrap';
    const av = document.createElement('div'); av.className='avatar'; av.dataset.peer=id;
    av.style.background = nameColor(p.name||'?'); av.textContent = initials(p.name);
    if (speakingState[id]) av.classList.add('speaking');
    const badge = document.createElement('div'); badge.className='mic-badge'; badge.textContent = p.muted===false ? '🎤' : '·';
    av.appendChild(badge);
    const nm = document.createElement('div'); nm.className='avatar-name'; nm.textContent = (id===myId ? 'You' : p.name);
    wrap.appendChild(av); wrap.appendChild(nm); orbit.appendChild(wrap);
  });
  if (window.onOrbitRender) window.onOrbitRender();
}
