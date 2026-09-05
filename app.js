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

function toastSuccess(msg) {

const container = document.getElementById('toast-container');

if (!container) return;

const el = document.createElement('div');

el.className = 'toast toast-success';

el.textContent = msg;

el.style.color = '#2ecc71';

el.style.fontWeight = 'bold';

container.appendChild(el);

setTimeout(()=> el.remove(), 3000);

}

// ---------- Splash: fixed 5s, no skip ----------

(function(){

const colors = ['#ff6f91','#ffd166','#5ee6d0','#a78bfa'];

const splash = document.getElementById('screen-splash');

for (let i=0;i<10;i++){

const p = document.createElement('div');

p.className='splash-particle';

const size = 3+Math.random()*5;

p.style.width=size+'px'; p.style.height=size+'px';

p.style.left = (Math.random()*100)+'%';

p.style.top = (Math.random()*100)+'%';

p.style.background = colors[i%colors.length];

p.style.animationDuration = (6+Math.random()*6)+'s';

p.style.animationDelay = (Math.random()*4)+'s';

splash.appendChild(p);

}

setTimeout(async ()=>{

splash.style.transition = 'opacity .5s ease';

splash.style.opacity = '0';

setTimeout(async ()=>{

  splash.style.display='none';

  const user = await restoreAuthSession();

  if (user && myProfile){

    enterAppAsUser();

  } else {

    showAuthScreen();

  }

}, 500);

}, 5000);

})();

// ---------- Auth screen flow ----------

function switchScreen(activeId) {
  const screens = ['screen-splash', 'screen-auth', 'screen-saved-rooms', 'screen-landing', 'screen-room'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === activeId) ? 'flex' : 'none';
  });
}

// ---------- Post-login entry point ----------

function enterAppAsUser(){

if (!myProfile) { console.error('myProfile is null, cannot enter app'); showAuthScreen(); return; }

myName = myProfile.username;

document.getElementById('screen-auth').style.display='none';

const saved = getSavedSession();

if (saved){

document.getElementById('screen-landing').style.display='flex';

  roomCode = saved.room; isHost = saved.isHost; requireApproval = false;

  showLandingStatus('Restoring your session…');

  initPeer();

  return;

}

const params = new URLSearchParams(location.search);

const invited = params.get('room');

if (invited){

document.getElementById('screen-landing').style.display='flex';

   roomInput.value = invited;

   cameFromInviteLink = true;

   return;

}

document.getElementById('screen-saved-rooms').style.display='flex';

renderSavedRoomsScreen();

}

document.getElementById('btn-saved-rooms-logout').addEventListener('click', async ()=>{

await signOutUser();

location.reload();

});

// ---------- Global toggles used by other modules ----------

window.autoSyncOn = true;

window.soundOn = true;

// ---------- Landing ----------

const roomInput = document.getElementById('input-roomcode');

function showLandingStatus(msg,isErr){ const el=document.getElementById('landing-status'); if(el){ el.textContent=msg; el.classList.toggle('err',!!isErr);} }

// Tracks whether the current room code in the input came from a trusted

// invite link (skips the knock) vs. being typed/edited by hand (requires it).

let cameFromInviteLink = false;

roomInput.addEventListener('input', ()=>{ cameFromInviteLink = false; });

document.getElementById('btn-join').addEventListener('click', ()=>{

const code = roomInput.value.trim().toLowerCase();

if (!code){ showLandingStatus("Enter the room code your friend sent you.", true); return; }

roomCode = code; isHost = false;

requireApproval = !cameFromInviteLink;

setLandingLoading(true);

showLandingStatus('Joining…');

initPeer();

});

function setLandingLoading(loading){

document.getElementById('btn-create').disabled = loading;

document.getElementById('btn-join').disabled = loading;

}

window.onPeerError = (msg)=>{ setLandingLoading(false); showLandingStatus(msg, true); };

// ---------- Entry gate (choice-only) ----------

window.onPeerReady = function(){

document.getElementById('screen-landing').style.display='none';

document.getElementById('screen-room').style.display='block';

document.getElementById('entry-hub').style.display='flex';

document.getElementById('entry-room-code').textContent = roomCode;

document.getElementById('input-rename').value = myName;

addSystemMessage(isHost ? 'Room created. Share the code "${roomCode}" with your friends. : You joined "${roomCode}".');

};

document.getElementById('entry-btn-copy').addEventListener('click', copyRoomCode);

document.getElementById('btn-copy').addEventListener('click', copyRoomCode);

document.getElementById('entry-btn-invite').addEventListener('click', copyInviteLink);

document.getElementById('btn-invite').addEventListener('click', copyInviteLink);

const buttonStates = {};

function copyRoomCode(){

if (buttonStates['copy-in-progress']) return;

buttonStates['copy-in-progress'] = true;

navigator.clipboard.writeText(roomCode).then(()=>{

['entry-btn-copy','btn-copy'].forEach(id=>{

  const btn=document.getElementById(id);

  if (!btn) return;

  const old=btn.textContent;

  btn.textContent='✓';

  const timeout = setTimeout(()=>{

    btn.textContent=old;

    if (id === 'btn-copy') buttonStates['copy-in-progress'] = false;

  }, 1200);

});

toast('Room code copied');

}).catch(err => {

console.error('Failed to copy room code:', err);

buttonStates['copy-in-progress'] = false;

});

}

function copyInviteLink(){

const link = '${location.origin}${location.pathname}?room=${roomCode}';

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

document.getElementById('btn-leave').addEventListener('click', leaveRoom);

document.querySelectorAll('.hub-card').forEach(c=> c.addEventListener('click', ()=> enterActivity(c.dataset.mode, true)));

let isEnteringActivity = false;

function enterActivity(mode, broadcastIt){

if (isEnteringActivity) return;

isEnteringActivity = true;

document.getElementById('entry-hub').style.display='none';

document.getElementById('activity-shell').style.display='flex';

document.getElementById('room-code-display').textContent = roomCode;

setMode(mode, broadcastIt);

isEnteringActivity = false;

}

function setMode(mode, broadcastIt){

currentMode = mode;

const shell = document.getElementById('activity-shell');

if (shell && shell.style.display !== 'flex' && !isEnteringActivity) {

enterActivity(mode, false);

return;

}

document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));

document.getElementById('pane-'+mode).classList.add('active');

document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));

const chatToggleWrap = document.getElementById('chat-toggle-wrap');

const chatCol = document.getElementById('chat-col');

if (mode === 'music'){

chatToggleWrap.classList.add('visible');

} else {

chatToggleWrap.classList.remove('visible');

chatCol.classList.remove('open');

setChatToggleLabel(false);

}

if (broadcastIt) broadcast({type:'mode', mode});

}

window.onRemoteMode = (mode)=> setMode(mode, false);

document.querySelectorAll('.nav-btn').forEach(b=> b.addEventListener('click', ()=>setMode(b.dataset.mode, true)));

function setChatToggleLabel(open){

const btn = document.getElementById('btn-chat-toggle');

if (btn) btn.textContent = open ? '✕ Close chat' : '💬 Open chat';

}

document.getElementById('btn-chat-toggle').addEventListener('click', ()=>{

const chatCol = document.getElementById('chat-col');

const open = !chatCol.classList.contains('open');

chatCol.classList.toggle('open', open);

setChatToggleLabel(open);

});

window.onChannelLoading = (function(prev){

return function(ch, videoId){

if (prev) prev(ch, videoId);

if (ch === 'video'){ const ph = document.getElementById('video-placeholder'); if (ph) ph.style.display='none'; }

};

})(window.onChannelLoading);

document.getElementById('btn-load-video').addEventListener('click', ()=>{

const id = extractVideoId(document.getElementById('input-video-url').value);

if (!id){ toast("Couldn't find a video in that link — paste a full YouTube URL or ID"); return; }

YTSync.load('video', id);

});

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

document.getElementById('btn-load-music').addEventListener('click', ()=>{

const res = musicLoadFromInput(document.getElementById('input-music-url').value);

if (!res.ok) toast(res.message);

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

document.getElementById('btn-mic').addEventListener('click', async ()=>{

const btn = document.getElementById('btn-mic');

if (!micOn){

try{

  if (!localStream){ localStream = await acquireMicStream(); attachSpeakingDetector(localStream, myId); }

  localStream.getAudioTracks().forEach(t=>t.enabled=true);

  micOn = true;

  btn.textContent = '🔇 Leave voice'; btn.classList.remove('btn-secondary'); btn.classList.add('btn-ghost');

  const peerIds = Object.keys(dataConns);

  for (const id of peerIds) maybeCallPeer(id);

  broadcast({type:'mic', muted:false});

}catch(e){ alert("Couldn't access your microphone. Check your browser's permission settings."); }

} else {

micOn = false;

if (localStream) localStream.getAudioTracks().forEach(t=>t.enabled=false);

btn.textContent = '🎤 Join voice'; btn.classList.add('btn-secondary'); btn.classList.remove('btn-ghost');

broadcast({type:'mic', muted:true});

}

});

document.getElementById('btn-send').addEventListener('click', sendChatFromInput);

document.getElementById('input-chat').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatFromInput(); });

function sendChatFromInput(){

const input = document.getElementById('input-chat');

const text = input.value.trim(); if (!text) return;

sendChatMessage(myName, text, false);

input.value = '';

if (/(?:^|\s)@ai(?:\s|$)/i.test(text)) respondAsAI(text);

}

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

async function respondAsAI(triggerText){

let reply = null;

try{

const res = await fetch(AI_FUNCTION_URL, {

  method:'POST',

  headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'apikey':SUPABASE_ANON_KEY },

  body: JSON.stringify({ message: triggerText })

});

if (res.ok){ const json = await res.json(); reply = json.reply; }

}catch(e){

console.warn('AI function call failed:', e);

}

if (!reply) reply = scriptedAIReply(triggerText);

sendChatMessage('🤖 Buddy', reply, true);

}

function scriptedAIReply(triggerText){

const lower = triggerText.toLowerCase();

if (/joke/.test(lower)) return AI_JOKES[Math.floor(Math.random()*AI_JOKES.length)];

if (/movie|watch/.test(lower)) return "Tonight's pick: 🎬 "${suggestMovie()}" — trust me on this one.";

if (/song|music|track/.test(lower)) return Try this: 🎵 "${suggestSong()}" — put it on and thank me later.;

return AI_FILLERS[Math.floor(Math.random()*AI_FILLERS.length)];

}

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

document.getElementById('btn-settings').addEventListener('click', ()=>{

document.getElementById('settings-overlay').style.display='flex';

document.getElementById('settings-account-desc').textContent = '${myProfile.first_name} ${myProfile.last_name} · @${myProfile.username}';

populateMicSelect();

});

document.getElementById('btn-settings-close').addEventListener('click', ()=>{ document.getElementById('settings-overlay').style.display='none'; });

document.getElementById('settings-overlay').addEventListener('click', e=>{ if (e.target.id==='settings-overlay') e.currentTarget.style.display='none'; });

document.getElementById('btn-rename-save').addEventListener('click', ()=>{

const newName = document.getElementById('input-rename').value.trim();

if (!newName || newName===myName) return;

myName = newName;

participants[myId].name = myName;

renderOrbit();

broadcast({type:'rename', name:myName});

addSystemMessage('You are now known as "${myName}"');

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

if (!user && document.getElementById('screen-room').style.display !== 'none') location.reload();

};

function refreshAccountPanel(user){

const out = document.getElementById('account-signed-out');

const inn = document.getElementById('account-signed-in');

if (user){

out.style.display='none'; inn.style.display='block';

document.getElementById('account-email').textContent = user.email;

} else {

out.style.display='block'; inn.style.display='none';

}

}

// Auth screen - Sign up with full profile

document.getElementById('btn-signup').addEventListener('click', async function(e){

e.preventDefault();

const email = document.getElementById('signup-email').value.trim();

const password = document.getElementById('signup-password').value;

const firstName = document.getElementById('signup-first').value.trim();

const lastName = document.getElementById('signup-last').value.trim();

const username = document.getElementById('signup-username').value.trim();

if (!email || !password || !firstName || !lastName || !username) {

showAuthStatus('Fill in all fields.', true);

return;

}

showAuthStatus('Creating account…');

const { error } = await signUpWithProfile({ firstName, lastName, username, email, password });

if (error) {

showAuthStatus(error.message || 'Sign-up failed', true);

} else {

showAuthStatus('✓ Registration successful! Welcome to Together!', false);

setTimeout(() => {

  document.getElementById('signup-first').value = '';

  document.getElementById('signup-last').value = '';

  document.getElementById('signup-username').value = '';

  document.getElementById('signup-email').value = '';

  document.getElementById('signup-password').value = '';

}, 1500);

}

});

// Auth screen - Log in

document.getElementById('btn-login').addEventListener('click', async function(e){

e.preventDefault();

const email = document.getElementById('login-email').value.trim();

const password = document.getElementById('login-password').value;

if (!email || !password){ showAuthStatus('Enter an email and password.', true); return; }

showAuthStatus('Logging in…');

const { error } = await signInWithEmail(email, password);

if (error) showAuthStatus(error.message, true);

});

function showAuthStatus(msg, isErr){

const el = document.getElementById('auth-status');

if (el) {

el.textContent = msg; 

el.style.color = isErr ? 'var(--coral)' : '#2ecc71';

el.style.fontWeight = isErr ? 'normal' : 'bold';

}

}

// Auth tab switching

document.querySelectorAll('.auth-tab').forEach(btn => {

btn.addEventListener('click', function() {

const tab = this.dataset.tab;

document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));

this.classList.add('active');

document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';

document.getElementById('auth-signup').style.display = tab === 'signup' ? 'block' : 'none';

document.getElementById('auth-status').textContent = '';

});

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

// Logout from landing page

const landingLogout = document.getElementById('btn-landing-logout');

if (landingLogout) {

landingLogout.addEventListener('click', async ()=>{

await signOutUser();

showAuthScreen();

toast('Logged out');

});

}