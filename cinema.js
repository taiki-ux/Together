/* ============================================================
   CINEMA.JS — full-height video ("full screen") with a slim control rail

   The old full-screen button only enlarged the video; the reactions and next/previous were
   left behind outside it. This is a full-screen mode that works on every phone:

     - The player fills the whole screen; a narrow rail runs down the LEFT edge, full height:
       reactions, ＋ for all emojis, previous / next, play-pause, and ✕ to leave.
     - If the phone is held upright (auto-rotate off, or iPhone, which can't lock orientation),
       the video is ROTATED to fill the screen as a landscape picture — turn the phone sideways
       and it lines up. ⟲ (in ＋) flips which way it's rotated. If the phone is already sideways,
       no rotation is applied.
     - It uses the browser's real full screen too where allowed (hides the address bar and,
       on Android, locks landscape), and falls back to a plain full-window overlay where it
       isn't (iPhone). Back button / Esc leave it.
     - Turn a touch device sideways on the Watch page with something loaded and it opens by itself.
   ============================================================ */

const REACTION_EMOJIS = ['😂','❤️','😭','😱','🔥','👏','😍','🎉','👍','😮','🤣','💀','🥹','🙌','😴','🤯'];

const Cinema = (function(){
  const frame = document.querySelector('#pane-video .video-frame');
  if (!frame) return { enter(){}, exit(){}, toggle(){}, get active(){ return false; } };

  const $ = id => document.getElementById(id);
  const picker = $('fs-picker');
  const moreBtn = $('fs-more');
  const st = { active:false, flipped:false, pushed:false, nativeFs:false, autoDismissed:false };

  const portrait = ()=> window.innerHeight > window.innerWidth;
  const inNativeFs = ()=> !!(document.fullscreenElement || document.webkitFullscreenElement);
  const coarsePointer = ()=> !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // ---------- reactions / transport ----------
  function react(emoji){
    if (REACTION_EMOJIS.includes(emoji) && typeof sendReaction === 'function') sendReaction(emoji);
  }
  function togglePlay(){
    const c = YTChannels.video;
    if (!c.currentId) return;
    if (c.playing) YTSync.pause('video'); else YTSync.play('video');
  }
  function updatePlayIcon(){
    const c = YTChannels.video;
    ['fs-play', 'fs-play2'].forEach(id=>{ const b = $(id); if (b) b.textContent = c.playing ? '⏸' : '▶'; });
  }

  // ---------- the ＋ emoji picker ----------
  function buildPicker(){
    picker.innerHTML = REACTION_EMOJIS.map(e =>
      `<button class="fs-btn fs-pick" type="button" role="menuitem" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('') +
      `<div class="fs-tools">
         <button class="fs-btn" id="fs-play2" type="button" role="menuitem" aria-label="Play or pause" title="Play / pause">⏸</button>
         <button class="fs-btn" id="fs-flip" type="button" role="menuitem" aria-label="Rotate the other way" title="Rotate the other way">⟲</button>
       </div>`;
  }
  function openPicker(){ picker.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); updatePlayIcon(); }
  function closePicker(){ picker.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
  function togglePicker(){ if (picker.hidden) openPicker(); else closePicker(); }

  // ---------- orientation ----------
  function applyOrientation(){
    const rotated = st.active && portrait();
    frame.classList.toggle('cinema-rotated', rotated);
    frame.classList.toggle('cinema-flipped', rotated && st.flipped);
  }

  // ---------- enter / exit ----------
  async function enter(fromTap){
    if (st.active) return;
    st.active = true;
    st.autoDismissed = false;
    frame.classList.add('cinema');
    document.documentElement.classList.add('cinema-open');
    applyOrientation();
    updatePlayIcon();
    try{ history.pushState({ together:'cinema' }, ''); st.pushed = true; }catch(e){}   // so the back button leaves full screen

    // Real full screen too, where the browser allows it (needs a tap; iPhone doesn't offer it)
    const request = frame.requestFullscreen || frame.webkitRequestFullscreen;
    if (request && fromTap !== false){
      try{
        await request.call(frame);
        st.nativeFs = true;
        if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{});
      }catch(e){ st.nativeFs = false; }
    }
    applyOrientation();
    const exitBtn = $('fs-exit');
    if (exitBtn) exitBtn.focus({ preventScroll:true });
  }

  function exit(fromPopState){
    if (!st.active) return;
    st.active = false;
    frame.classList.remove('cinema', 'cinema-rotated', 'cinema-flipped');
    document.documentElement.classList.remove('cinema-open');
    closePicker();
    if (inNativeFs()){
      try{ Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(()=>{}); }catch(e){}
    }
    st.nativeFs = false;
    try{ if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); }catch(e){}
    if (!portrait()) st.autoDismissed = true;       // still sideways: don't pop straight back in
    if (st.pushed){
      st.pushed = false;
      if (!fromPopState){ try{ history.back(); }catch(e){} }
    }
    const btn = $('btn-fullscreen');
    if (btn) btn.focus({ preventScroll:true });
  }
  function toggle(){ if (st.active) exit(); else enter(true); }

  // Sideways on the Watch page with something loaded -> open automatically (touch devices only)
  function maybeAutoEnter(){
    const sideways = !portrait() && window.innerHeight <= 520;
    if (!sideways){ st.autoDismissed = false; return; }
    if (st.active || st.autoDismissed || !coarsePointer()) return;
    const pane = $('pane-video'), shell = $('activity-shell');
    if (!pane || !pane.classList.contains('active') || !shell || shell.style.display !== 'flex') return;
    if (!YTChannels.video.currentId) return;
    enter(false);
  }

  // ---------- wiring ----------
  buildPicker();
  picker.hidden = true;            // always start closed, whatever the HTML says
  $('fs-exit').addEventListener('click', ()=> exit());
  document.querySelectorAll('.fs-emoji').forEach(b => b.addEventListener('click', ()=> react(b.dataset.emoji)));
  moreBtn.addEventListener('click', e=>{ e.stopPropagation(); togglePicker(); });
  picker.addEventListener('click', e=>{
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.emoji){ react(b.dataset.emoji); closePicker(); }
    else if (b.id === 'fs-play2') togglePlay();
    else if (b.id === 'fs-flip'){ st.flipped = !st.flipped; applyOrientation(); }
  });
  $('fs-play').addEventListener('click', togglePlay);
  $('fs-prev').addEventListener('click', ()=>{ if (typeof previousTrack === 'function') previousTrack('video'); });
  $('fs-next').addEventListener('click', ()=>{ if (typeof nextTrack === 'function') nextTrack('video'); });

  document.addEventListener('click', e=>{
    if (!picker.hidden && !picker.contains(e.target) && e.target !== moreBtn) closePicker();
  });
  document.addEventListener('keydown', e=>{
    if (e.key !== 'Escape' || !st.active) return;
    if (!picker.hidden) closePicker(); else exit();
  });
  const onFullscreenChange = ()=>{ if (st.active && st.nativeFs && !inNativeFs()){ st.nativeFs = false; exit(); } };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  window.addEventListener('popstate', ()=>{ if (st.active) exit(true); });
  const onResize = ()=>{ applyOrientation(); maybeAutoEnter(); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  window.onChannelStateChange = (function(prev){
    return function(ch, ytState){ if (prev) prev(ch, ytState); if (ch === 'video') updatePlayIcon(); };
  })(window.onChannelStateChange);

  return { enter, exit, toggle, get active(){ return st.active; } };
})();
