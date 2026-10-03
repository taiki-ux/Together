/* ============================================================
   APP.JS
   Boot sequence, screen/mode transitions, settings modal, and
   the lightweight @ai chat companion. Everything DOM-facing that
   isn't specific to one activity lives here.
   ============================================================ */

// ---------- Toast ----------
function toast(msg){
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(()=> el.remove(), 3000);
}

function withTimeout(promise, ms, message){
  return Promise.race([
    promise,
    new Promise((_, reject)=> setTimeout(()=> reject(new Error(message)), ms))
  ]);
}

function shortCode(code){ return code.length > 6 ? code.slice(0,3) + '…' : code; }

// ---------- Invite links ----------
// ?room=CODE is stashed for this tab and removed from the address bar straight away, so a
// reload (or sharing the page URL) can't re-trigger a join, and it survives the login step.
(function captureInvite(){
  try{
    const code = new URLSearchParams(location.search).get('room');
    if (!code) return;
    sessionStorage.setItem('together_invite', code.trim().toLowerCase());
    history.replaceState(null, '', location.pathname);
  }catch(e){}
})();
function takeInvite(){
  try{
    const code = sessionStorage.getItem('together_invite');
    if (code) sessionStorage.removeItem('together_invite');
    return code || null;
  }catch(e){ return null; }
}
function showPendingNotice(){
  try{
    const note = sessionStorage.getItem('together_notice');
    if (!note) return;
    sessionStorage.removeItem('together_notice');
    setTimeout(()=> toast(note), 400);
  }catch(e){}
}

// ---------- Splash + boot ----------
// A tab's first open plays the full 5s splash. Reloads skip straight through (the splash only
// holds until the saved login is checked), so refreshing feels like a refresh, not a restart.
let pendingRestoreView = null;   // where to put the person back once they're re-connected to their room
let appEntered = false;          // guards against entering the app twice (login event + explicit call)

// ---------- Screens ----------
const ALL_SCREENS = ['screen-auth','screen-landing','screen-saved-rooms','screen-room','screen-profile'];
function showOnly(id, display){
  ALL_SCREENS.forEach(s=>{ const el = document.getElementById(s); if (el) el.style.display = (s === id) ? display : 'none'; });
}
function showAuthScreen(){
  appEntered = false;
  showOnly('screen-auth', 'flex');
  // Never logged in on this device? Start on Sign up rather than a login they can't use yet.
  let known = false;
  try{ known = localStorage.getItem('together_has_account') === '1'; }catch(e){}
  setAuthTab(known ? 'login' : 'signup');
}
function showLandingScreen(){
  showOnly('screen-landing', 'flex');
  saveView({ screen:'landing' });
}

// ---------- Post-login entry point ----------
async function enterAppAsUser(){
  if (appEntered || window.__recoveryPending) return;
  if (!myProfile){
    console.error('myProfile is null, cannot enter app');
    showAuthScreen();
    return;
  }
  appEntered = true;
  try{ localStorage.setItem('together_has_account', '1'); }catch(e){}
  myName = myProfile.username || 'User';
  if (typeof startGlobalPresence === 'function' && currentUser) startGlobalPresence(currentUser.id);

  const invited = takeInvite();
  const saved = getSavedSession();

  // Reloaded while in a room: reconnect to the same room and put them back on the same page.
  if (saved && (!invited || invited === saved.room)){
    pendingRestoreView = readView();
    roomCode = saved.room; isHost = saved.isHost;
    showLandingScreen();
    setLandingLoading(true);
    showLandingStatus('Getting you back into the room…');
    initPeer();
    return;
  }
  if (saved){ clearSession(); }                      // opened a different room's invite: that wins

  // Opened an invite link: go straight in.
  if (invited){
    showLandingScreen();
    roomInput.value = invited;
    await joinRoomByCode(invited);
    return;
  }

  // Otherwise: back to the screen they were on, or home (their saved rooms, else create/join).
  const view = readView();
  if (view && view.screen === 'landing'){ showLandingScreen(); return; }
  let rooms = [];
  try{ rooms = await fetchMySavedRooms(); }catch(e){ console.warn('Could not load saved rooms:', e); }
  if (rooms.length) showSavedRoomsScreen(rooms); else showLandingScreen();
}

// ---------- Global toggles used by other modules ----------
window.autoSyncOn = true;
window.soundOn = true;

// ---------- Landing ----------
const roomInput = document.getElementById('input-roomcode');
function showLandingStatus(msg,isErr){ const el=document.getElementById('landing-status'); if(el){ el.textContent=msg; el.classList.toggle('err',!!isErr);} }

document.getElementById('btn-create').addEventListener('click', ()=>{
  roomCode = generateRoomCode(); isHost = true;
  setLandingLoading(true);
  showLandingStatus('Opening your room…');
  initPeer();
});
// Everything a typed code or invite link goes through. A wrong code must say so — it used to
// silently open a brand-new empty room.
const ROOM_CODE_RE = /^[a-z0-9_-]{3,64}$/;
async function joinRoomByCode(raw){
  const code = (raw || '').trim().toLowerCase();
  if (!code){ showLandingStatus("Enter the room code your friend sent you.", true); return; }
  if (!ROOM_CODE_RE.test(code)){ showLandingStatus("That doesn't look like a room code — check it and try again.", true); return; }
  setLandingLoading(true);
  showLandingStatus('Looking for the room…');
  let exists;
  try{ exists = await roomExists(code); }
  catch(e){
    console.warn('Room check failed:', e);
    setLandingLoading(false);
    showLandingStatus("Couldn't check that room — check your connection and try again.", true);
    return;
  }
  if (!exists){
    setLandingLoading(false);
    showLandingStatus("No room with that code is open right now. Check the code, or ask your friend for a fresh link.", true);
    return;
  }
  roomCode = code; isHost = false;
  showLandingStatus('Joining…');
  requireApproval = await resolveRequireApproval(code);
  initPeer();
}
document.getElementById('btn-join').addEventListener('click', ()=> joinRoomByCode(roomInput.value));
roomInput.addEventListener('keydown', e=>{ if (e.key === 'Enter') joinRoomByCode(roomInput.value); });
function setLandingLoading(loading){
  document.getElementById('btn-create').disabled = loading;
  document.getElementById('btn-join').disabled = loading;
}
window.onPeerError = (msg)=>{ setLandingLoading(false); showLandingStatus(msg, true); };

window.onConnectionStatus = function(state){
     const pill = document.getElementById('entry-conn-status');
        if (!pill) return;
           if (state === 'connected'){ pill.textContent = '🟢'; pill.title = 'Connected'; }
              else if (state === 'reconnecting'){ pill.textContent = '🟡'; pill.title = 'Reconnecting…'; toast('Connection dropped — reconnecting…', 'err'); }
                 else if (state === 'offline'){ pill.textContent = '🔴'; pill.title = 'Disconnected'; toast("You've been disconnected. Try rejoining the room.", 'err'); }
                 };

// ---------- Entry gate (choice-only) ----------
window.onPeerReady = async function(){
  const restore = pendingRestoreView;      // set when this is a reconnect after a reload
  pendingRestoreView = null;
  showOnly('screen-room', 'block');
  document.getElementById('entry-hub').style.display='flex';
  window.scrollTo(0,0);
  saveView({ screen:'room', roomView:'hub', profile:null });
  document.getElementById('entry-room-code').textContent = shortCode(roomCode);
  document.getElementById('input-rename').value = myName;
  if (typeof loadChatHistory === 'function') await loadChatHistory();
  addSystemMessage(isHost ? `Room created. Share the code "${roomCode}" with your friends.` : `You joined "${roomCode}".`);
  if (typeof autoJoinVoiceIfEnabled === 'function') autoJoinVoiceIfEnabled();
  if (typeof requestWakeLock === 'function') requestWakeLock();
  // After a reload: back to the page (and profile) they were on
  if (restore && restore.roomView === 'activity' && restore.mode) enterActivity(restore.mode, false);
  if (restore && restore.profile && restore.profile.userId) openProfileScreen(restore.profile.userId, restore.profile.name, !!restore.profile.isOwn);
};
document.getElementById('entry-btn-copy').addEventListener('click', copyRoomCode);
document.getElementById('entry-btn-invite').addEventListener('click', copyInviteLink);

const buttonStates = {};

function copyRoomCode(){
  if (buttonStates['copy-in-progress']) return;
  buttonStates['copy-in-progress'] = true;
  
  navigator.clipboard.writeText(roomCode).then(()=>{
    const btn = document.getElementById('entry-btn-copy');
    if (btn){
      const old = btn.textContent;
      btn.textContent = '✓';
      setTimeout(()=>{ btn.textContent = old; buttonStates['copy-in-progress'] = false; }, 1200);
    } else {
      buttonStates['copy-in-progress'] = false;
    }
    toast('Room code copied');
  }).catch(err => {
    console.error('Failed to copy room code:', err);
    buttonStates['copy-in-progress'] = false;
  });
}

function copyInviteLink(){
  const link = `${location.origin}${location.pathname}?room=${roomCode}`;
  navigator.clipboard.writeText(link).then(()=> toast('Invite link copied — anyone who opens it can join straight away')).catch(err => {
    console.error('Failed to copy invite link:', err);
  });
}

function leaveRoom(){
  if (!confirm('Leave the room?')) return;
  clearSession();
  leaveRoomPresence();
  if (peer) peer.destroy();
  location.reload();
}
document.getElementById('entry-btn-leave').addEventListener('click', leaveRoom);

document.querySelectorAll('.hub-card').forEach(c=> c.addEventListener('click', ()=> enterActivity(c.dataset.mode, true)));
document.getElementById('btn-back-to-hub').addEventListener('click', ()=>{

  document.getElementById('activity-shell').style.display='none';

  document.getElementById('entry-hub').style.display='flex';

  window.scrollTo(0,0);
  saveView({ roomView:'hub' });

});
document.getElementById('btn-chat-video-call').addEventListener('click', ()=>{
  setMode('talk', false);
  if (!micOn) toggleMic();
  if (!camOn) startCamera();
});
document.getElementById('btn-chat-voice-call').addEventListener('click', ()=> setMode('talk', false));
document.getElementById('btn-chat-menu').addEventListener('click', ()=> toast('More options coming soon'));

let isEnteringActivity = false;

function enterActivity(mode, broadcastIt){
  if (isEnteringActivity) return;
  isEnteringActivity = true;
  
  document.getElementById('entry-hub').style.display='none';
  document.getElementById('activity-shell').style.display='flex';
  window.scrollTo(0,0);
  setMode(mode, broadcastIt);
  
  isEnteringActivity = false;
}

const SHARED_MODES = ['video','music','games']; 

// Chat, Talk and Playlist views are personal — they never change what the room is doing.
function setMode(mode, broadcastIt){
  const shell = document.getElementById('activity-shell');
  if (shell && shell.style.display !== 'flex' && !isEnteringActivity) {
    enterActivity(mode, broadcastIt);
    return;
  }
  // currentMode only tracks the room's shared activity (Watch/Music/Games) —
  // Chat/Talk are personal views layered on top and never broadcast,
  // so navigating to them never interrupts what everyone else is doing.
  if (SHARED_MODES.includes(mode)) currentMode = mode;

  document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
  const pane = document.getElementById('pane-'+mode);
  if (pane) pane.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));

  // Chat page: layout locks to the viewport (message list scrolls, composer pinned above the nav).
  saveView({ screen:'room', roomView:'activity', mode });   // remembered for reloads
  const isChat = mode === 'chat';
  if (shell) shell.classList.toggle('chat-active', isChat);
  const chatActions = document.getElementById('topbar-chat-actions');
  if (chatActions) chatActions.classList.toggle('visible', isChat);
  const mainCol = document.getElementById('main-col');
  if (mainCol) mainCol.classList.toggle('chat-full-bleed', isChat);

  if (mode === 'video') renderPlaylistList('video', 'playlist-video-list-inline');
  if (mode === 'music') renderPlaylistList('music', 'playlist-music-list-inline');
  if (mode === 'talk') renderTalkGrid();
  placeVideos();

  if (isChat){
    clearUnread();
    scrollChatToBottom();   // always open on the latest message, not the top
  }

  if (broadcastIt && SHARED_MODES.includes(mode)) broadcast({type:'mode', mode});
  // Personal "what am I up to" status — distinct from the shared-mode broadcast
  // above (which syncs the ROOM's Watch/Music/Games view), this just tells
  // everyone what I'm personally looking at, for the hub presence list.
  if (participants[myId]) participants[myId].status = mode;
  broadcast({ type:'presence-status', status: mode });
  if (typeof renderHubPresence === 'function') renderHubPresence();
}

async function renderPlaylistList(kind, containerId){
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<p class="hint">Loading…</p>';
  let items = [];
  try{ items = await loadFavorites(kind); }
  catch(e){ console.error('Failed to load favorites:', e); el.innerHTML = '<p class="hint">Couldn\'t load these right now.</p>'; return; }

  if (!items || items.length === 0){ el.innerHTML = '<p class="hint">Nothing saved yet — hit ⭐ next to Load.</p>'; return; }

  el.innerHTML = items.map(it => `
    <div class="playlist-item">
      <img class="playlist-thumb" src="${escapeHtml(thumbUrl(it.video_id))}" alt="" loading="lazy">
      <div class="playlist-info">
        <div class="playlist-title" data-title-for="${escapeHtml(it.id)}">${escapeHtml(isUrlish(it.title) ? 'Loading title…' : it.title)}</div>
        <div class="playlist-sub">${kind === 'music' ? '🎵 Song' : '🎬 Video'}</div>
      </div>
      <span class="playlist-actions">
        <button class="btn btn-secondary btn-sm" data-load="${escapeHtml(it.video_id)}" data-kind="${kind}" type="button">▶ Play</button>
        <button class="icon-btn" data-remove="${escapeHtml(it.id)}" data-kind="${kind}" type="button" title="Remove">🗑</button>
      </span>
    </div>
  `).join('');

  el.querySelectorAll('[data-load]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      YTSync.load(btn.dataset.kind, btn.dataset.load);
      setMode(btn.dataset.kind, true);
    });
  });
  el.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try{ await deleteFavorite(btn.dataset.remove); }
      catch(e){ console.error('Failed to remove favorite:', e); toast("Couldn't remove that item", 'err'); return; }
      renderPlaylistList(btn.dataset.kind, containerId);
    });
  });

  // Old saves that only stored a link: look up the real name and fix them
  items.filter(it => isUrlish(it.title)).forEach(async it=>{
    const t = (await fetchVideoTitle(it.video_id)) || 'YouTube video';
    const node = el.querySelector(`[data-title-for="${it.id}"]`);
    if (node) node.textContent = t;
    if (t !== 'YouTube video') updateFavoriteTitle(it.id, t);
  });
}

function renderTalkGrid(){
  const grid = document.getElementById('talk-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(participants).forEach(id=>{
    const p = participants[id];
    const tile = document.createElement('div'); tile.className = 'talk-tile';
    tile.dataset.id = id;

    const slot = document.createElement('div'); slot.className = 'video-slot';
    tile.appendChild(slot);

    const av = document.createElement('div'); av.className = 'avatar talk-avatar'; av.dataset.peer = id;
    av.style.background = nameColor(p.name || '?'); av.textContent = initials(p.name);
    av.style.cursor = 'pointer';
    av.addEventListener('click', ()=> openProfileForPeer(id));
    if (speakingState[id]) av.classList.add('speaking');
    tile.appendChild(av);

    const nm = document.createElement('div'); nm.className = 'talk-name'; nm.textContent = (id === myId ? 'You' : p.name);
    tile.appendChild(nm);

    const micState = document.createElement('div'); micState.className = 'talk-mic-state';
    micState.textContent = p.muted === false ? '🎤 On' : '🔇 Off';
    tile.appendChild(micState);

    grid.appendChild(tile);
  });
  placeVideos();
}
window.onOrbitRender = (function(prev){ return function(){ if (prev) prev(); renderTalkGrid(); }; })(window.onOrbitRender);
window.onRemoteMode = (mode)=> setMode(mode, false);
document.querySelectorAll('.nav-btn').forEach(b=> b.addEventListener('click', ()=>setMode(b.dataset.mode, true)));

window.onChannelLoading = (function(prev){
  return function(ch, videoId){
    if (prev) prev(ch, videoId);
    if (ch === 'video'){ const ph = document.getElementById('video-placeholder'); if (ph) ph.style.display='none'; }
  };
})(window.onChannelLoading);

document.getElementById('btn-play-video').addEventListener('click', ()=>YTSync.play('video'));
document.getElementById('btn-pause-video').addEventListener('click', ()=>YTSync.pause('video'));
document.getElementById('btn-sync-video').addEventListener('click', ()=>YTSync.syncToMe('video'));
document.getElementById('btn-seek-video').addEventListener('click', ()=>{
  if (!YTSync.seek('video', document.getElementById('input-seek-video').value)) toast('Enter a time like 1:23 or a number of seconds');
});
document.getElementById('input-seek-video').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btn-seek-video').click(); });
document.getElementById('btn-fullscreen').addEventListener('click', async ()=>{
  const frame = document.querySelector('#pane-video .video-frame');
  if (document.fullscreenElement){
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    document.exitFullscreen();
  } else {
    try{
      if (frame.requestFullscreen) await frame.requestFullscreen();
      else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{});
    }catch(err){ console.warn('Fullscreen/rotation error:', err); }
  }
});

document.getElementById('btn-play-music').addEventListener('click', ()=>YTSync.play('music'));
document.getElementById('btn-pause-music').addEventListener('click', ()=>YTSync.pause('music'));
document.getElementById('btn-sync-music').addEventListener('click', ()=>YTSync.syncToMe('music'));
document.getElementById('btn-seek-music').addEventListener('click', ()=>{
  if (!YTSync.seek('music', document.getElementById('input-seek-music').value)) toast('Enter a time like 1:23 or a number of seconds');
});
document.getElementById('input-seek-music').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btn-seek-music').click(); });
document.getElementById('btn-pick-local').addEventListener('click', ()=> document.getElementById('input-local-file').click());
document.getElementById('input-local-file').addEventListener('change', function(){
  if (this.files && this.files[0]) musicPlayLocalFile(this.files[0]);
});

async function toggleMic(){
     if (typeof pushToTalkOn !== 'undefined' && pushToTalkOn) return; // press/hold owns mic state in this mode
     if (!micOn){
         try{
            if (!localStream){ localStream = await acquireMicStream(); attachSpeakingDetector(localStream, myId); }
            localStream.getAudioTracks().forEach(t=> t.enabled = true);
            micOn = true;
            updateMicButtonsUI(true);
            Object.keys(dataConns).forEach(id=> maybeCallPeer(id));
            broadcast({ type:'mic', muted:false });
           }catch(e){
            console.error('Mic access failed:', e);
            const reason = e.name === 'NotAllowedError' ? 'Microphone permission was denied.'
                 : e.name === 'NotFoundError' ? 'No microphone was found on this device.'
                 : `Couldn't access your microphone (${e.message || e.name || 'unknown error'}).`;
            toast(reason, 'err');
           }
       } else {
         micOn = false;
         if (localStream) localStream.getAudioTracks().forEach(t=> t.enabled = false);
         updateMicButtonsUI(false);
         broadcast({ type:'mic', muted:true });
       }
} 

// Label for the Talk page's mic button. Voice now joins muted, so "connected but muted"
// is the normal resting state — hence Mute/Unmute rather than Join/Leave once connected.
function updateMicButtonsUI(on){
  const ptt = (typeof pushToTalkOn !== 'undefined' && pushToTalkOn);
  const talkBtn = document.getElementById('btn-mic-talk');
  if (!talkBtn) return;
  talkBtn.textContent = !localStream ? '🎤 Join voice'
    : ptt ? (on ? '🎤 Talking…' : '🎤 Hold to talk')
    : (on ? '🔇 Mute' : '🎤 Unmute');
  talkBtn.classList.toggle('on', on);
}

async function callAiFunction(payload, attempt){
  attempt = attempt || 1;
  try{
    const res = await fetch(AI_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'apikey':SUPABASE_ANON_KEY },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`AI service responded with HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }catch(e){
    if (attempt === 1){
      console.warn('AI call failed once, retrying:', e.message);
      await new Promise(r=> setTimeout(r, 800));
      return callAiFunction(payload, 2);
    }
    throw e;
  }
}


document.getElementById('btn-mic-talk').addEventListener('click', toggleMic);

const AI_JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my WiFi I loved it. It said the connection isn't stable.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I'm reading a book on anti-gravity. It's impossible to put down.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "I used to be a banker, but I lost interest.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "Why did the video call freeze? It saw the WiFi bill."
];
const AI_FILLERS = [
  "Haha, love the energy in here! 🎉",
  "I'm just a lightweight joke-bot for now — ask me for a joke, a movie, or a song! 🎬🎵",
  "Ha! Okay okay, carry on 😄",
  "That's the spirit! Someone say the word 'joke' if you want one 👀"
];
function buildRoomContext(){
  const recentMessages = recentChatLog.slice(-8).map(m=> `${m.name}: ${m.text}`).join('\n');
  const nowWatching = YTChannels.video.currentId ? (document.getElementById('input-video-url').value.trim() || YTChannels.video.currentId) : null;
  const nowPlaying = YTChannels.music.currentId ? (document.getElementById('input-music-url').value.trim() || YTChannels.music.currentId) : null;
  return { recentMessages, nowWatching, nowPlaying, activeGame: getActiveGameSummary() };
}

// Peeks at whichever .game-panel is currently visible instead of games.js
// having to push its state here — keeps the game files untouched.
function getActiveGameSummary(){
  const panels = document.querySelectorAll('.game-panel');
  for (const panel of panels){
    if (panel.style.display === 'block'){
      const label = panel.id.replace('game-','');
      const prompt = panel.querySelector('.quiz-question, .draft-category');
      return prompt ? `Playing ${label}: "${prompt.textContent.trim()}"` : `Playing ${label}`;
    }
  }
  return null;
}

let lastBuddyCallAt = 0;
const BUDDY_COOLDOWN_MS = 8000;

async function respondAsAI(triggerText){
  const now = Date.now();
  if (now - lastBuddyCallAt < BUDDY_COOLDOWN_MS){
    toast('🤖 Buddy needs a sec before you ask again');
    return;
  }
  lastBuddyCallAt = now;

  let reply = null;
  showBuddyTyping(true);
  try{
    const json = await callAiFunction({ message: triggerText, context: buildRoomContext(), callerId: myId });
    if (json.error === 'RATE_LIMITED'){
      showBuddyTyping(false);
      toast("🤖 Buddy's getting a lot of requests right now — give it a moment");
      return;
    }
    reply = json.reply;
    if (!reply) throw new Error('AI returned an empty reply');
  }catch(e){
    console.error('AI buddy unavailable after retry:', e);
    toast(`🤖 AI is offline right now (${e.message}) — using a scripted reply instead`, 'err');
  }
  showBuddyTyping(false);
  if (!reply) reply = scriptedAIReply(triggerText);
  sendChatMessage('🤖 Buddy', reply, true);
}

function scriptedAIReply(triggerText){
  const lower = triggerText.toLowerCase();
  if (/joke/.test(lower)) return AI_JOKES[Math.floor(Math.random()*AI_JOKES.length)];
  if (/movie|watch/.test(lower)) return `Tonight's pick: 🎬 "${suggestMovie()}" — trust me on this one.`;
  if (/song|music|track/.test(lower)) return `Try this: 🎵 "${suggestSong()}" — put it on and thank me later.`;
  return AI_FILLERS[Math.floor(Math.random()*AI_FILLERS.length)];
}

// ---------- Reactions ----------
function spawnFloatingReaction(pane, emoji){
  const layer = document.getElementById('reaction-layer-' + pane);
  if (!layer) return;
  const bubble = document.createElement('div');
  bubble.className = 'reaction-bubble';
  bubble.textContent = emoji;
  bubble.style.left = (20 + Math.random()*60) + '%';
  layer.appendChild(bubble);
  setTimeout(()=> bubble.remove(), 2600);
}
function sendReaction(emoji){
  const pane = (currentMode === 'music') ? 'music' : 'video';
  spawnFloatingReaction(pane, emoji);
  broadcast({ type:'reaction', emoji });
}
registerHandler('reaction', (fromId, data)=>{
  // Shows wherever the receiver is currently looking, if that's Watch or Music —
  // otherwise there's no visible spot for it right now, so it's just skipped.
  if (currentMode === 'video' || currentMode === 'music'){
    spawnFloatingReaction(currentMode, data.emoji);
  }
});
document.querySelectorAll('.reaction-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> sendReaction(btn.dataset.emoji));
});


window.onChatReceived = function(){ playChime(); };
function playChime(){
  if (!window.soundOn) return;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='sine'; o.frequency.value=740;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.28);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.3);
  }catch(e){}
}

function openSettings(){
  document.getElementById('settings-overlay').style.display='flex';
  document.getElementById('settings-account-desc').textContent = `${myProfile.first_name} ${myProfile.last_name} · @${myProfile.username}`;
  populateMicSelect();
}
document.getElementById('btn-settings-close').addEventListener('click', ()=>{ document.getElementById('settings-overlay').style.display='none'; });
document.getElementById('settings-overlay').addEventListener('click', e=>{ if (e.target.id==='settings-overlay') e.currentTarget.style.display='none'; });

document.getElementById('btn-rename-save').addEventListener('click', ()=>{
  const newName = document.getElementById('input-rename').value.trim();
  if (!newName || newName===myName) return;
  myName = newName;
  participants[myId].name = myName;
  renderOrbit();
  broadcast({type:'rename', name:myName});
  addSystemMessage(`You are now known as "${myName}"`);
});
document.getElementById('toggle-sound').addEventListener('click', function(){ window.soundOn=!window.soundOn; this.classList.toggle('on',window.soundOn); });
document.getElementById('toggle-autosync').addEventListener('click', function(){ window.autoSyncOn=!window.autoSyncOn; this.classList.toggle('on',window.autoSyncOn); });

async function populateMicSelect(){
  try{
    const sel = document.getElementById('select-mic');
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d=>d.kind==='audioinput');
    sel.innerHTML = '';
    mics.forEach((d, i) => {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || ('Microphone ' + (i + 1));
      sel.appendChild(option);
    });
  }catch(e){ console.error('Failed to populate microphone list:', e); }
}
document.getElementById('select-mic').addEventListener('change', async function(){
  const deviceId = this.value; if (!deviceId) return;
  try{
    const newStream = await acquireMicStream(deviceId);
    if (localStream) localStream.getTracks().forEach(t=>t.stop());
    localStream = newStream;
    localStream.getAudioTracks().forEach(t=>t.enabled=micOn);
    attachSpeakingDetector(localStream, myId);
    const newTrack = localStream.getAudioTracks()[0];
    Object.values(mediaConns).forEach(call=>{
      const pc = call.peerConnection;
      if (!pc) return;
      const sender = pc.getSenders().find(s=>s.track && s.track.kind==='audio');
      if (sender) sender.replaceTrack(newTrack);
    });
  }catch(e){ alert("Couldn't switch microphone."); console.error('Microphone switch error:', e); }
});

// ---------- Account (Supabase Auth) ----------
document.getElementById('btn-settings-logout').addEventListener('click', async ()=>{
  await signOutUser();
  location.reload();
});
window.onAuthChange = function(user){
  if (window.__recoveryPending) return;   // mid password-reset: don't drop them into the app yet
  if (user){
    if (document.getElementById('screen-auth').style.display !== 'none') enterAppAsUser();
  } else if (document.getElementById('screen-room').style.display !== 'none'){
    location.reload();
  }
};
//--------------App boot ----------------
(async function bootApp(){
        try{
          const user = await
restoreAuthSession();
           if (user && myProfile){
                  enterAppAsUser();
           } else {
                 showAuthScreen();
           }
        }catch(err){
               console.error('Failed to restore auth session:', err);
               showAuthScreen();
        }
})();

// ---------- Auth: sign up / log in ----------
function setAuthTab(tab){
  const panels = { login:'auth-login', signup:'auth-signup', forgot:'auth-forgot', reset:'auth-reset' };
  Object.entries(panels).forEach(([name, id])=>{
    const el = document.getElementById(id);
    if (el) el.style.display = (name === tab) ? 'block' : 'none';
  });
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const tabs = document.querySelector('.auth-tabs');          // the Log in / Sign up switch only belongs on those two
  if (tabs) tabs.style.display = (tab === 'login' || tab === 'signup') ? '' : 'none';
  const status = document.getElementById('auth-status');
  if (status) status.textContent = '';
}
document.querySelectorAll('.auth-tab').forEach(btn => btn.addEventListener('click', ()=> setAuthTab(btn.dataset.tab)));

// link = { label, tab, email? } adds a tappable shortcut, e.g. "Log in instead"
function showAuthStatus(msg, isErr, link){
  const el = document.getElementById('auth-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? 'var(--coral-ink)' : 'var(--teal)';
  el.style.fontWeight = isErr ? 'normal' : 'bold';
  if (link){
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'auth-link'; b.textContent = link.label;
    b.addEventListener('click', ()=>{
      setAuthTab(link.tab);
      const target = document.getElementById({ login:'login-email', signup:'signup-email', forgot:'forgot-email' }[link.tab]);
      if (link.email && target) target.value = link.email;
    });
    el.appendChild(document.createTextNode(' '));
    el.appendChild(b);
  }
}

// Live "is this nickname free?" hint while typing (quietly does nothing if the check isn't set up)
const USERNAME_HINT = 'This is your display name everywhere in the app — like a username, and it must be unique.';
function setUsernameStatus(text, tone){
  const el = document.getElementById('username-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = tone === 'ok' ? 'var(--teal)' : (tone === 'bad' ? 'var(--coral-ink)' : '');
}
let usernameCheckTimer = null, usernameCheckSeq = 0;
document.getElementById('signup-username').addEventListener('input', e=>{
  clearTimeout(usernameCheckTimer);
  const name = e.target.value.trim();
  if (name.length < 2){ usernameCheckSeq++; setUsernameStatus(USERNAME_HINT); return; }
  usernameCheckTimer = setTimeout(async ()=>{
    const seq = ++usernameCheckSeq;
    const free = await checkUsernameAvailable(name);
    if (seq !== usernameCheckSeq) return;            // they kept typing — ignore the stale answer
    if (free === true) setUsernameStatus('✓ That nickname is free', 'ok');
    else if (free === false) setUsernameStatus('That nickname is taken — try another.', 'bad');
    else setUsernameStatus(USERNAME_HINT);
  }, 450);
});

function friendlySignupError(error, email){
  const msg = String(error && error.message || '');
  if (/already (been )?registered|already exists/i.test(msg)) showAuthStatus('That email already has an account.', true, { label:'Log in instead', tab:'login', email });
  else if (/database error saving new user|duplicate key|unique|username/i.test(msg)) showAuthStatus('That nickname is already taken — try another.', true);
  else if (/password/i.test(msg)) showAuthStatus(msg, true);
  else if (/rate limit|too many/i.test(msg)) showAuthStatus('Too many attempts — please wait a minute and try again.', true);
  else { console.error('Sign-up error:', error); showAuthStatus("Couldn't create your account. Please check your details and try again.", true); }
}

async function handleSignup(){
  const btn = document.getElementById('btn-signup');
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const firstName = document.getElementById('signup-first').value.trim();
  const lastName = document.getElementById('signup-last').value.trim();
  const username = document.getElementById('signup-username').value.trim();

  if (!email || !password || !firstName || !lastName || !username){ showAuthStatus('Please fill in every field.', true); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)){ showAuthStatus("That email address doesn't look right.", true); return; }
  if (password.length < 6){ showAuthStatus('Choose a password with at least 6 characters.', true); return; }
  if (username.length < 2){ showAuthStatus('Your nickname needs at least 2 characters.', true); return; }

  btn.disabled = true;
  try{
    showAuthStatus('Creating your account…');
    if (await checkUsernameAvailable(username) === false){ showAuthStatus('That nickname is already taken — try another.', true); return; }

    const { data, error } = await withTimeout(
      signUpWithProfile({ firstName, lastName, username, email, password }), 20000,
      "That's taking too long — check your connection and try again.");
    if (error){ friendlySignupError(error, email); return; }

    // With email confirmation on, Supabase answers "already registered" with a fake success and no identities.
    if (data && data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0){
      showAuthStatus('That email already has an account.', true, { label:'Log in instead', tab:'login', email });
      return;
    }

    // Signed in straight away (email confirmation off) — go in without making them log in again.
    let signedIn = !!(data && data.session);
    // No session yet: try signing in with the same details. This works when confirmation is off
    // but the sign-up call didn't return a session; it fails with "not confirmed" when it's on.
    if (!signedIn){
      const attempt = await signInWithEmail(email, password);
      signedIn = !attempt.error;
    }
    if (signedIn){
      if (!myProfile) await loadMyProfile();
      if (myProfile){ showAuthStatus('Welcome to Together!'); await enterAppAsUser(); return; }
      setAuthTab('login');
      document.getElementById('login-email').value = email;
      showAuthStatus("Your account was created, but we couldn't load it yet. Please log in.", true);
      return;
    }
    setAuthTab('login');
    document.getElementById('login-email').value = email;
    showAuthStatus('Account created! Check your email to confirm it, then log in.', false);
  }catch(err){
    console.error('Sign-up failed:', err);
    showAuthStatus(err.message || 'Something went wrong creating your account. Please try again.', true);
  }finally{
    btn.disabled = false;
  }
}

function friendlyLoginError(error){
  const msg = String(error && error.message || '');
  if (/invalid login credentials/i.test(msg)) showAuthStatus("That email or password isn't right.", true, { label:'Forgot password?', tab:'forgot', email: document.getElementById('login-email').value.trim() });
  else if (/not confirmed/i.test(msg)) showAuthStatus('Please confirm your email first — check your inbox for the link.', true);
  else if (/rate limit|too many/i.test(msg)) showAuthStatus('Too many attempts — please wait a minute and try again.', true);
  else { console.error('Login error:', error); showAuthStatus("Couldn't log you in right now. Please try again.", true); }
}

async function handleLogin(){
  const btn = document.getElementById('btn-login');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password){ showAuthStatus('Enter your email and password.', true); return; }
  btn.disabled = true;
  try{
    showAuthStatus('Logging in…');
    const { error } = await withTimeout(signInWithEmail(email, password), 15000, "That's taking too long — check your connection and try again.");
    if (error){ friendlyLoginError(error); return; }
    // success: window.onAuthChange fires and calls enterAppAsUser() itself
  }catch(err){
    showAuthStatus(err.message || 'Something went wrong logging in.', true);
  }finally{
    btn.disabled = false;
  }
}

// ---------- Forgot / reset password ----------
// Flow: "Forgot password?" -> email with a link -> the link opens the app on the "choose a new
// password" screen (supabase-client.js flags it) -> save -> straight into the app.
let resetCooldownTimer = null;
function startResetCooldown(btn, seconds){
  clearInterval(resetCooldownTimer);
  let left = seconds;
  const tick = ()=>{
    if (left <= 0){ clearInterval(resetCooldownTimer); btn.disabled = false; btn.textContent = 'Send reset link'; return; }
    btn.disabled = true; btn.textContent = `Send again in ${left}s`; left--;
  };
  tick();
  resetCooldownTimer = setInterval(tick, 1000);
}

async function handleForgot(){
  const btn = document.getElementById('btn-forgot-send');
  const email = document.getElementById('forgot-email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)){ showAuthStatus('Enter the email you signed up with.', true); return; }
  btn.disabled = true;
  showAuthStatus('Sending…');
  const { error } = await requestPasswordReset(email);
  if (error){
    btn.disabled = false;
    if (/rate limit|too many|seconds/i.test(String(error.message || ''))) showAuthStatus('Please wait a minute before asking for another email.', true);
    else { console.error('Password reset error:', error); showAuthStatus("Couldn't send the email right now. Please try again.", true); }
    return;
  }
  // Same message whether or not the email has an account, on purpose.
  showAuthStatus('If an account exists for that email, a reset link is on its way. Check your inbox (and spam).', false);
  startResetCooldown(btn, 60);
}

function showResetScreen(){
  appEntered = false;
  showOnly('screen-auth', 'flex');
  setAuthTab('reset');
}
window.onPasswordRecovery = showResetScreen;

async function handleResetSave(){
  const btn = document.getElementById('btn-reset-save');
  const pw = document.getElementById('reset-password').value;
  const pw2 = document.getElementById('reset-password2').value;
  if (pw.length < 6){ showAuthStatus('Choose a password with at least 6 characters.', true); return; }
  if (pw !== pw2){ showAuthStatus("The two passwords don't match.", true); return; }
  btn.disabled = true;
  try{
    showAuthStatus('Saving…');
    const { error } = await withTimeout(setNewPassword(pw), 15000, "That's taking too long — check your connection and try again.");
    if (error){
      const msg = String(error.message || '');
      if (/different from the old/i.test(msg)) showAuthStatus('Choose a password you are not already using.', true);
      else if (/session|not authenticated|missing/i.test(msg)) showAuthStatus('This reset link has expired.', true, { label:'Get a new one', tab:'forgot' });
      else { console.error('Update password error:', error); showAuthStatus("Couldn't save your new password. Please try again.", true); }
      return;
    }
    window.__recoveryPending = false;
    if (!myProfile) await loadMyProfile();
    if (myProfile){ showAuthStatus('Password updated — welcome back!'); await enterAppAsUser(); return; }
    setAuthTab('login');
    showAuthStatus('Password updated. Please log in.', false);
  }catch(err){
    showAuthStatus(err.message || 'Something went wrong. Please try again.', true);
  }finally{
    btn.disabled = false;
  }
}

document.getElementById('btn-forgot-link').addEventListener('click', ()=>{
  const typed = document.getElementById('login-email').value.trim();
  setAuthTab('forgot');
  if (typed) document.getElementById('forgot-email').value = typed;
});
document.getElementById('btn-forgot-back').addEventListener('click', ()=> setAuthTab('login'));
document.getElementById('btn-forgot-send').addEventListener('click', handleForgot);
document.getElementById('btn-reset-save').addEventListener('click', handleResetSave);

document.getElementById('btn-signup').addEventListener('click', e=>{ e.preventDefault(); handleSignup(); });
document.getElementById('btn-login').addEventListener('click', e=>{ e.preventDefault(); handleLogin(); });
// Enter submits (these aren't <form>s)
[['login-email','btn-login'],['login-password','btn-login'],
 ['signup-first','btn-signup'],['signup-last','btn-signup'],['signup-username','btn-signup'],
 ['signup-email','btn-signup'],['signup-password','btn-signup'],
 ['forgot-email','btn-forgot-send'],['reset-password','btn-reset-save'],['reset-password2','btn-reset-save']].forEach(([input, button])=>{
  document.getElementById(input).addEventListener('keydown', e=>{ if (e.key === 'Enter'){ e.preventDefault(); document.getElementById(button).click(); } });
});

// ---------- Save to playlist ----------
document.getElementById('btn-save-video').addEventListener('click', ()=>{
  const c = YTChannels.video;
  if (!c.currentId){ toast('Load a video first'); return; }
  const title = document.getElementById('input-video-url').value.trim() || c.currentId;
  saveFavorite('video', title, c.currentId);
});
document.getElementById('btn-save-music').addEventListener('click', ()=>{
  const c = YTChannels.music;
  if (!c.currentId){ toast('Load a track first'); return; }
  const title = document.getElementById('input-music-url').value.trim() || c.currentId;
  saveFavorite('music', title, c.currentId);
});

// Log out from the landing and saved-rooms screens. Reloading resets everything tied to the
// old account (presence, rooms, profile) so the next person to log in starts clean.
async function logoutAndReload(){
  await signOutUser();
  clearSession();
  location.reload();
}
['btn-landing-logout', 'btn-saved-rooms-logout'].forEach(id=>{
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', logoutAndReload);
});

document.getElementById('btn-stop-video').addEventListener('click', ()=> YTSync.stop('video'));
document.getElementById('btn-stop-music').addEventListener('click', ()=>{
  YTSync.stop('music');
  const a = document.getElementById('local-audio-player'); // also stops a file playing just for you
  if (a && a.style.display !== 'none'){ a.pause(); a.currentTime = 0; }
});


// ---------- Entry hub: 3-line menu ----------
const entryMenu = document.getElementById('entry-menu');
const entryMenuToggle = document.getElementById('entry-menu-toggle');
function setEntryMenu(open){
  entryMenu.style.display = open ? 'flex' : 'none';
  entryMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
entryMenuToggle.addEventListener('click', e=>{
  e.stopPropagation();
  setEntryMenu(entryMenu.style.display === 'none');
});
// any item closes the menu (their own click handlers still run)
entryMenu.querySelectorAll('.menu-item').forEach(b=> b.addEventListener('click', ()=> setEntryMenu(false)));
// tap anywhere else to close
document.addEventListener('click', e=>{
  if (!e.target.closest('.entry-menu-wrap')) setEntryMenu(false);
});

document.getElementById('entry-btn-settings').addEventListener('click', openSettings);



// ---------- Installable app / offline shell ----------
if ('serviceWorker' in navigator && window.isSecureContext){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=> console.warn('Service worker not registered:', err));
  });
}
