/* ============================================================
   PEER-MANAGER.JS
   PeerJS signaling/data/audio plumbing, participant roster, and
   the DataHandlers dispatch registry that the other modules
   (youtube-sync, queue, chat, games) hook into. Everything here
   is shared, room-level state.

   Chat (transport, reactions, replies, edits) and typing
   indicators now live in chat.js.
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
// Safe for element text AND for values inside HTML attributes (quotes are escaped too).
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
// Ids that arrive from other peers/the network become object keys, selectors and
// attribute values — only accept plain id-shaped strings (and never '__proto__').
function isSafeId(s){ return typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s) && s !== '__proto__'; }

// ---------- Shared room state ----------
let peer=null, myId=null, myName='', roomCode='', isHost=false, requireApproval=false;
const dataConns = {};
const mediaConns = {};
const audioEls = {};
let participants = Object.create(null); // keyed by peer ids from the network — no inherited keys
let localStream = null;
let micOn = false;
let currentMode = null;      // 'video' | 'music' | 'games' — null until chosen
const speakingState = {};

// ---------- Dispatch registry ----------
// Other modules call registerHandler('type', fn) at load time; fn(fromId, data)
const DataHandlers = Object.create(null); // looked up by a remote-supplied message type
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
  clearView();
}
function getSavedSession(){
  const savedRoom = sessionStorage.getItem('together_room');
  const savedName = sessionStorage.getItem('together_name');
  const savedHost = sessionStorage.getItem('together_ishost');
  if (savedRoom && savedName) return { room:savedRoom, name:savedName, isHost: savedHost==='true' };
  return null;
}

// ---------- Where you were (so a reload puts you back on the same page) ----------
// sessionStorage = per tab, survives a reload, gone when the tab is closed.
function readView(){ try{ return JSON.parse(sessionStorage.getItem('together_view') || 'null'); }catch(e){ return null; } }
function saveView(patch){ try{ sessionStorage.setItem('together_view', JSON.stringify({ ...(readView() || {}), ...patch })); }catch(e){} }
function clearView(){ try{ sessionStorage.removeItem('together_view'); }catch(e){} }

// ---------- PeerJS plumbing (discovery now via Supabase Realtime presence — see joinRoomPresence) ----------
function initPeer(){
   peer = new Peer({debug:0}); // always a random id; roomCode is just the Supabase channel name now

   peer.on('open', id=>{
      myId = id;
      participants[myId] = {name: myName};
      saveSession();
      if (window.onConnectionStatus) window.onConnectionStatus('connected');
      if (requireApproval){
         beginKnock();
      } else {
         joinRoomPresence();
         if (window.onPeerReady) window.onPeerReady();
         renderOrbit();
      }
   });
   peer.on('connection', conn=> setupDataConn(conn));
   peer.on('call', call=>{
         if (call.metadata && call.metadata.kind === 'video'){
            call.answer();            // receive-only, we send our own camera separately
            setupVideoConn(call);
            return;
         }
         call.answer(localStream || undefined);
         setupMediaConn(call);
   });
   
   peer.on('disconnected', ()=>{
      // Lost the signaling connection (not the same as the data/voice links to
      // other people, which keep working) — try to quietly reconnect.
      if (window.onConnectionStatus) window.onConnectionStatus('reconnecting');
      setTimeout(()=>{ try{ if (peer && !peer.destroyed) peer.reconnect(); }catch(e){ console.warn('Reconnect failed:', e); } }, 1000);
   });
   peer.on('close', ()=>{
      if (window.onConnectionStatus) window.onConnectionStatus('offline');
   });
   peer.on('error', err=>{
      console.error('Peer error:', err);
      if (err && err.type === 'network' && window.onConnectionStatus) window.onConnectionStatus('reconnecting');
      if (window.onPeerError)
         window.onPeerError(String(err.type||err));
   });
}  

// ---------- Knock-to-enter (typed-code joins only) ----------
// A knocker subscribes to the room's channel WITHOUT tracking presence (so 
// they aren't "in" the room yet), broadcasts a request, and waits for any
// current member to accept or deny. Approval upgrades them to a full,
// presence-tracked member via the normal joinRoomPresence() path.

function beginKnock(){
   if (window.onKnockWaiting) window.onKnockWaiting();
   roomChannel = supabaseClient.channel(`room:${roomCode}`);
   roomChannel
      .on('broadcast', { event:'knock-response' }, ({ payload })=>{
         if (payload.peerId !== myId) return;
         if (payload.approved){
            try{ supabaseClient.removeChannel(roomChannel); }catch(e){}
            roomChannel = null;
            requireApproval = false;
            joinRoomPresence();
            if (window.onPeerReady) window.onPeerReady();
            renderOrbit();
         } else {
            try{ supabaseClient.removeChannel(roomChannel); }catch(e){}
            roomChannel = null;
            if (window.onKnockDenied) window.onKnockDenied();
         }
      })
      .subscribe((status)=>{
         if (status === 'SUBSCRIBED'){
            roomChannel.send({ type:'broadcast', event:'knock', payload:{ peerId:myId, name:myName,
                                 userId: (typeof currentUser!=='undefined' && currentUser) ? currentUser.id : null
                                 }
                             });
            setTimeout(()=>{
               if (roomChannel){
                  try{ supabaseClient.removeChannel(roomChannel); }catch(e){}
                  roomChannel = null;
                  if (window.onKnockTimeout) window.onKnockTimeout();
               }
            }, 30000);
         }
      });
}
function respondToKnock(peerId, approved){
   if (!roomChannel) return;
   roomChannel.send({ type:'broadcast', event:'knock-response', payload:{ peerId, approved }
                    });
} 

// ---------- Room discovery via Supabase Realtime presence ----------
// Replaces the old "dial the host's PeerJS id" bootstrap. Every client
// tracks its own {peerId, name} in a channel named after the room code;
// presence sync/join/leave events are the single source of truth for who's
// in the room, so the room keeps working even if whoever created it leaves.
let roomChannel = null;
// ---------- Who's in the room (presence -> roster) ----------
// A presence list can hold several sessions of one account: a reload leaves the old session
// lingering for ~30s, and an invite link opened in a second tab is a second session.
// The rules never compare device clocks, so a wrong phone clock can't get anyone kicked out:
//   - another session of ME that was already here when I arrived -> I'm the newer one: ignore it
//   - another session of ME that shows up AFTER I'm in           -> it's the newer one: this tab steps aside
//   - a second session of someone else's account                  -> list only the newest
const ignoredPeers = new Set();
let presenceReady = false;      // false until the first presence snapshot is processed; later arrivals are "live"

function myUserId(){ return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null; }

function acceptPresenceEntry(entry, isLive){
  const id = entry && entry.peerId;
  if (!isSafeId(id) || id === myId || ignoredPeers.has(id)) return false;
  const uid = entry.userId || null;
  if (uid){
    if (uid === myUserId()){
      if (isLive) yieldToNewerSession(); else ignoredPeers.add(id);
      return false;
    }
    const olderId = Object.keys(participants).find(pid => pid !== id && pid !== myId && participants[pid].userId === uid);
    if (olderId){
      if (isLive || (entry.joinedAt || 0) >= (participants[olderId].joinedAt || 0)){
        ignoredPeers.add(olderId);
        removePeer(olderId, true);
      } else {
        ignoredPeers.add(id);
        return false;
      }
    }
  }
  participants[id] = { ...(participants[id] || {}), name: String(entry.name || 'Someone').slice(0, 40), userId: uid, joinedAt: entry.joinedAt || 0 };
  return true;
}

// This tab was the older session of my own account and a newer one just joined the room.
function yieldToNewerSession(){
  if (window.__yielding) return;
  window.__yielding = true;
  try{ sessionStorage.setItem('together_notice', 'You opened this room somewhere else, so this tab was closed.'); }catch(e){}
  clearSession();
  leaveRoomPresence();
  try{ if (peer) peer.destroy(); }catch(e){}
  location.reload();
}

function joinRoomPresence(){
  if (!window.supabaseClient){
    if (window.onPeerError) window.onPeerError("Can't reach the room service — check your connection and try again.");
    return;
  }
  ignoredPeers.clear();
  presenceReady = false;
  const joinedAt = Date.now();
  roomChannel = supabaseClient.channel(`room:${roomCode}`, { config: { presence: { key: myId } } });
  roomChannel
    .on('presence', { event:'sync' }, ()=>{
      const state = roomChannel.presenceState();
      Object.values(state).forEach(entries=> entries.forEach(entry=>{
        if (acceptPresenceEntry(entry, presenceReady)) connectToPeer(entry.peerId);
      }));
      presenceReady = true;   // anything arriving from here on joined after me
      renderOrbit();
    })
    .on('presence', { event:'join' }, ({ newPresences })=>{
      newPresences.forEach(p=>{
        const isNew = !participants[p.peerId];
        if (acceptPresenceEntry(p, presenceReady)){
          if (isNew && presenceReady) addSystemMessage(`${participants[p.peerId].name} joined the room`);
          connectToPeer(p.peerId);
        }
      });
      renderOrbit();
    })
    .on('presence', { event:'leave' }, ({ leftPresences })=>{
      leftPresences.forEach(p=>{
        if (p.peerId === myId) return;
        ignoredPeers.delete(p.peerId);
        removePeer(p.peerId);
      });
    })
    .on('broadcast', { event:'knock' }, ({ payload })=>{
      if (window.onKnockReceived) window.onKnockReceived(payload);
    })
    .subscribe(async (status)=>{
      if (status === 'SUBSCRIBED') await roomChannel.track({ peerId: myId, name: myName, userId: myUserId(), joinedAt });
    });
}
function leaveRoomPresence(){
  if (!roomChannel) return;
  try{ roomChannel.untrack(); supabaseClient.removeChannel(roomChannel); }catch(e){}
  roomChannel = null;
}

// Only the lower peer id dials; the other side waits for the incoming link. That stops both
// of us opening a link to each other at the same time (the old cause of "X left the room"
// messages for people who were still there). If the expected dial never arrives, step in after 3s.
function connectToPeer(targetId, force){
  if (!targetId || targetId === myId || dataConns[targetId] || ignoredPeers.has(targetId)) return;
  const dial = ()=>{
    if (dataConns[targetId] || !participants[targetId] || !peer || peer.destroyed) return;
    setupDataConn(peer.connect(targetId, {metadata:{name:myName}, reliable:true}), true);
  };
  if (force || myId < targetId) dial();
  else setTimeout(dial, 3000);
}

// A dropped link isn't the same as someone leaving (phones drop links in the background).
// While they're still in the room's presence list we quietly try again; only presence
// saying they've gone removes them.
const redialAttempts = {};
function isInPresence(peerId){
  if (!roomChannel) return false;
  return Object.values(roomChannel.presenceState()).some(entries => entries.some(e => e.peerId === peerId));
}
function scheduleRedial(peerId){
  const n = (redialAttempts[peerId] = (redialAttempts[peerId] || 0) + 1);
  if (n > 8){ delete redialAttempts[peerId]; return; }
  setTimeout(()=>{
    if (dataConns[peerId] || !participants[peerId] || !isInPresence(peerId)) return;
    connectToPeer(peerId, true);
  }, Math.min(2000 * n, 10000));
}

function setupDataConn(conn, outgoing){
  if (ignoredPeers.has(conn.peer)){ try{ conn.close(); }catch(e){} return; }
  conn._outgoing = !!outgoing;
  conn.on('open', ()=>{
    const existing = dataConns[conn.peer];
    if (existing && existing !== conn && existing.open){
      // Two links between the same pair: both sides keep the one dialled by the lower id.
      const initiator = c => c._outgoing ? myId : c.peer;
      if (initiator(conn) >= initiator(existing)){ conn._duplicate = true; try{ conn.close(); }catch(e){} return; }
      existing._duplicate = true; try{ existing.close(); }catch(e){}
    }
    delete redialAttempts[conn.peer];
    dataConns[conn.peer] = conn;
    sendData(conn, {type:'hello', mode: currentMode});
    if (window.onPeerConnected) window.onPeerConnected(conn.peer);
    maybeCallPeer(conn.peer);
  });
  conn.on('data', data=> handleData(conn.peer, data));
  conn.on('close', ()=>{
    if (conn._duplicate) return;                       // we closed this one on purpose
    if (dataConns[conn.peer] === conn) delete dataConns[conn.peer];
    else if (dataConns[conn.peer]) return;             // a different live link exists — nothing to do
    if (!participants[conn.peer]) return;              // already removed
    if (isInPresence(conn.peer)) scheduleRedial(conn.peer);
    else removePeer(conn.peer);
  });
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
    if (typeof applyAudioSettings === 'function') applyAudioSettings(call.peer, audioEl);
  });
  call.on('close', ()=>{
    if (mediaConns[call.peer] !== call) return;   // a newer call to the same person replaced this one
    if (audioEls[call.peer]){ audioEls[call.peer].remove(); delete audioEls[call.peer]; }
    delete mediaConns[call.peer];
  });
  // Best-effort auto-reconnect: a network blip can drop the underlying
  // RTCPeerConnection without PeerJS itself firing 'close' or the person
  // ever leaving the room's presence — catch that case too.
  if (call.peerConnection){
    call.peerConnection.addEventListener('connectionstatechange', ()=>{
      const state = call.peerConnection.connectionState;
      if ((state === 'failed' || state === 'disconnected') && typeof attemptMediaReconnect === 'function'){
        setTimeout(()=> attemptMediaReconnect(call.peer), 2000);
      }
    });
  }
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

function removePeer(peerId, silent){
  const name = participants[peerId]?.name || 'Someone';
  const conn = dataConns[peerId];
  delete dataConns[peerId];
  delete redialAttempts[peerId];
  if (conn){ conn._duplicate = true; try{ conn.close(); }catch(e){} }
  if (mediaConns[peerId]){ mediaConns[peerId].close(); delete mediaConns[peerId]; }
  if (audioEls[peerId]){ audioEls[peerId].remove(); delete audioEls[peerId]; }
  if (participants[peerId]){ delete participants[peerId]; if (!silent) addSystemMessage(`${name} left the room`); }
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
registerHandler('mic', (fromId, data)=>{
  if (participants[fromId]) participants[fromId].muted = data.muted;
  renderOrbit();
  renderHubPresence();
});
registerHandler('mode', (fromId, data)=>{
  if (window.onRemoteMode) window.onRemoteMode(data.mode);
});
registerHandler('presence-status', (fromId, data)=>{
  if (participants[fromId]) participants[fromId].status = data.status;
  renderHubPresence();
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
        document.querySelectorAll(`.avatar[data-peer="${key}"]`).forEach(el=> el.classList.toggle('speaking', speaking));
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

// ---------- Roster-changed signal ----------
// (Used to draw the sidebar avatars; that sidebar is gone. Everything that shows the
// roster — hub presence, Talk grid, game opponent lists — hooks window.onOrbitRender.)
function renderOrbit(){
  if (window.onOrbitRender) window.onOrbitRender();
}

// ---------- Hub presence (entry-hub's "who's here and what they're up to") ----------
function presenceStatusLabel(status){
  return { video:'🎬 Watching', music:'🎵 Listening', games:'🎮 Playing', chat:'🗨️ Chatting', talk:'📞 Talking' }[status] || '💤 In the hub';
}
function renderHubPresence(){
  const el = document.getElementById('hub-presence-list');
  if (!el) return;
  const ids = Object.keys(participants);
  el.innerHTML = ids.map(id=>{
    const p = participants[id];
    const statusText = presenceStatusLabel(p.status);
    const micIcon = p.muted === false ? ' 🎤' : '';
    return `
      <div class="hub-presence-row" data-hub-avatar="${escapeHtml(id)}">
        <div class="avatar" data-peer="${escapeHtml(id)}" style="background:${nameColor(p.name||'?')}">${initials(p.name)}</div>
        <div class="hub-presence-info">
          <div class="hub-presence-name">${id===myId ? 'You' : escapeHtml(p.name)}</div>
          <div class="hub-presence-status">${statusText}${micIcon}</div>
        </div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('[data-hub-avatar]').forEach(row=>{
    row.style.cursor = 'pointer';
    row.addEventListener('click', ()=>{ if (typeof openProfileForPeer === 'function') openProfileForPeer(row.dataset.hubAvatar); });
  });
}
window.onOrbitRender = (function(prev){ return function(){ if (prev) prev(); renderHubPresence(); }; })(window.onOrbitRender);