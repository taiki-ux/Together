/* ============================================================
   BACKGROUND.JS
   Keeps Together healthy when you switch apps, lock the phone or lose signal.

   A website can't truly run when the phone suspends it — that is the browser/OS's
   decision — so this does the things that are possible:
     - Keep screen on while you're in a room (Settings toggle), so the phone doesn't
       sleep in the middle of a call or a movie.
     - The moment you come back (or the network returns), reconnect anyone whose link
       dropped while you were away and re-sync, instead of waiting for them to notice.
   Page state itself survives a reload — see saveView() in peer-manager.js.
   ============================================================ */

window.keepAwakeOn = true;
let wakeLock = null;

async function requestWakeLock(){
  if (!window.keepAwakeOn || wakeLock || document.hidden) return;
  if (!('wakeLock' in navigator) || !peer || peer.destroyed || !roomCode) return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', ()=>{ wakeLock = null; });
  }catch(e){
    wakeLock = null;       // refused (e.g. battery saver) — nice-to-have, not essential
  }
}
function releaseWakeLock(){
  if (!wakeLock) return;
  try{ wakeLock.release(); }catch(e){}
  wakeLock = null;
}

// Back in the foreground / back online: repair whatever dropped while we were away.
function resumeAfterBackground(){
  if (!peer || peer.destroyed || !myId) return;          // not in a room — nothing to repair
  if (peer.disconnected){
    try{ peer.reconnect(); }catch(e){ console.warn('Reconnect failed:', e); }
  }
  Object.keys(participants).forEach(id=>{
    if (id === myId) return;
    if (dataConns[id] && !dataConns[id].open) delete dataConns[id];   // stale link
    if (!dataConns[id]) connectToPeer(id, true);
  });
  requestWakeLock();
}

document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) resumeAfterBackground(); });
window.addEventListener('online', resumeAfterBackground);
window.addEventListener('pageshow', e=>{ if (e.persisted) resumeAfterBackground(); });   // restored from the back/forward cache

const keepAwakeToggle = document.getElementById('toggle-keep-awake');
if (keepAwakeToggle){
  const flip = ()=>{
    window.keepAwakeOn = !window.keepAwakeOn;
    keepAwakeToggle.classList.toggle('on', window.keepAwakeOn);
    keepAwakeToggle.setAttribute('aria-checked', window.keepAwakeOn ? 'true' : 'false');
    if (window.keepAwakeOn) requestWakeLock(); else releaseWakeLock();
  };
  keepAwakeToggle.addEventListener('click', flip);
  keepAwakeToggle.addEventListener('keydown', e=>{ if (e.key === ' ' || e.key === 'Enter'){ e.preventDefault(); flip(); } });
}
