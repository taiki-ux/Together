/* ============================================================
   ROOMS.JS
   Saved-rooms list (Supabase `rooms` table) — the screen between
   login and Create/Join — plus the knock-to-enter flow: someone
   typing in a room code broadcasts a request that current members
   can accept or deny.

   Phase 8: rooms can now be private (knock required) or open (join
   straight in, the original behavior). Privacy only applies to
   SAVED rooms — an ephemeral, never-saved room has no owner_id on
   record to check against, so it stays open. Once a signed-in
   person is approved into a private room, they're remembered in
   `room_members` and won't need to knock again next time.
   ============================================================ */

// ---------- Saved rooms CRUD ----------
async function fetchMySavedRooms(){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('rooms').select('*').eq('owner_id', currentUser.id)
    .order('created_at', { ascending:false });
  if (error){ console.error(error); return []; }
  return data || [];
}
async function saveCurrentRoom(name, icon, privacy){
  if (!currentUser || !supabaseClient){ toast('Log in to save rooms'); return false; }
  const { error } = await supabaseClient.from('rooms').insert({
    code: roomCode, name, owner_id: currentUser.id,
    icon: icon || '🎬', privacy: privacy === 'private' ? 'private' : 'open'
  });
  if (error){
    console.error(error);
    toast(error.code === '23505' ? 'You already saved this room' : "Couldn't save this room — try again");
    return false;
  }
  toast('Room saved ⭐ — find it under "Your rooms" next time');
  return true;
}
async function deleteSavedRoom(id){
  if (!supabaseClient) return;
  await supabaseClient.from('rooms').delete().eq('id', id);
}

// Decides whether joining `code` needs a knock. Only ever true for a SAVED
// private room, joined by someone who isn't its owner and isn't already a
// remembered member.
async function resolveRequireApproval(code){
  if (!supabaseClient) return false;
  const { data: room } = await supabaseClient.from('rooms').select('privacy, owner_id').eq('code', code).maybeSingle();
  if (!room || room.privacy !== 'private') return false;
  if (currentUser && room.owner_id === currentUser.id) return false;
  if (currentUser){
    const { data: membership } = await supabaseClient.from('room_members')
      .select('user_id').eq('room_code', code).eq('user_id', currentUser.id).maybeSingle();
    if (membership) return false; // a known member skips the knock
  }
  return true;
}
async function addRoomMember(code, userId){
  if (!supabaseClient || !userId) return;
  const { error } = await supabaseClient.from('room_members').insert({ room_code: code, user_id: userId });
  if (error && error.code !== '23505') console.error('Failed to remember room member:', error); // 23505 = already remembered, fine
}

// ---------- Saved-rooms screen ----------
async function renderSavedRoomsScreen(){
  const listEl = document.getElementById('saved-rooms-list');
  const emptyEl = document.getElementById('saved-rooms-empty');
  listEl.innerHTML = '<p class="hint">Loading your rooms…</p>';
  const rooms = await fetchMySavedRooms();
  if (rooms.length === 0){
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = rooms.map(r => `
    <div class="saved-room-card">
      <div class="saved-room-info">
        <div class="saved-room-icon">${escapeHtml(r.icon || '🎬')}</div>
        <div>
          <h4>${escapeHtml(r.name)}</h4>
          <p class="hint mono">${escapeHtml(r.code.slice(0,10))}… ${r.privacy === 'private' ? '· 🔒 Private' : ''}</p>
        </div>
      </div>
      <div class="saved-room-actions">
        <button class="btn btn-secondary btn-sm" data-join="${r.code}" data-name="${escapeHtml(r.name)}">Join</button>
        <button class="icon-btn" data-delete="${r.id}" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
  listEl.querySelectorAll('[data-join]').forEach(btn=>{
    btn.addEventListener('click', ()=> joinSavedRoom(btn.dataset.join, btn.dataset.name));
  });
  listEl.querySelectorAll('[data-delete]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if (!confirm("Delete this saved room? This only removes it from your list — it won't kick anyone currently in it.")) return;
      await deleteSavedRoom(btn.dataset.delete);
      renderSavedRoomsScreen();
    });
  });
}
function joinSavedRoom(code, name){
  roomCode = code; isHost = false; requireApproval = false; // your own saved room — no knock needed
  document.getElementById('screen-saved-rooms').style.display='none';
  document.getElementById('screen-landing').style.display='flex';
  setLandingLoading(true);
  showLandingStatus(`Joining "${name}"…`);
  initPeer();
}

document.getElementById('btn-new-room').addEventListener('click', ()=>{
  document.getElementById('screen-saved-rooms').style.display='none';
  document.getElementById('screen-landing').style.display='flex';
  showLandingStatus('');
});
document.getElementById('btn-back-to-rooms').addEventListener('click', ()=>{
  document.getElementById('screen-landing').style.display='none';
  document.getElementById('screen-saved-rooms').style.display='flex';
  renderSavedRoomsScreen();
});

// ---------- Save-this-room inline bar (shown once inside a room) ----------
let selectedRoomIcon = '🎬';
document.getElementById('entry-btn-save-room').addEventListener('click', ()=>{
  const bar = document.getElementById('save-room-bar');
  bar.style.display = bar.style.display==='flex' ? 'none' : 'flex';
  if (bar.style.display==='flex') document.getElementById('save-room-name').focus();
});
document.querySelectorAll('.icon-choice').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    selectedRoomIcon = btn.dataset.icon;
    document.querySelectorAll('.icon-choice').forEach(b=> b.classList.toggle('selected', b===btn));
  });
});
document.getElementById('btn-save-room-confirm').addEventListener('click', async ()=>{
  const name = document.getElementById('save-room-name').value.trim();
  if (!name){ toast('Give the room a name first'); return; }
  const privacy = document.getElementById('toggle-room-private').classList.contains('on') ? 'private' : 'open';
  const ok = await saveCurrentRoom(name, selectedRoomIcon, privacy);
  if (ok){ document.getElementById('save-room-bar').style.display='none'; document.getElementById('save-room-name').value=''; }
});
document.getElementById('btn-save-room-cancel').addEventListener('click', ()=>{
  document.getElementById('save-room-bar').style.display='none';
});
document.getElementById('toggle-room-private')?.addEventListener('click', function(){
  this.classList.toggle('on');
});

// ---------- Knock-to-enter UI ----------
window.onKnockWaiting = function(){
  setLandingLoading(true);
  showLandingStatus('Asking the room to let you in…');
};
window.onKnockDenied = function(){
  setLandingLoading(false);
  showLandingStatus("The room said no this time.", true);
};
window.onKnockTimeout = function(){
  setLandingLoading(false);
  showLandingStatus("No one answered — try again in a bit.", true);
};
window.onKnockReceived = function(payload){
  const banner = document.createElement('div');
  banner.className = 'knock-banner';
  banner.innerHTML = `
    <span>🚪 <b>${escapeHtml(payload.name)}</b> wants to join</span>
    <span class="knock-actions">
      <button class="btn btn-secondary btn-sm">Let them in</button>
      <button class="btn btn-ghost btn-sm">Deny</button>
    </span>`;
  document.body.appendChild(banner);
  const [acceptBtn, denyBtn] = banner.querySelectorAll('button');
  acceptBtn.addEventListener('click', async ()=>{
    respondToKnock(payload.peerId, true);
    if (payload.userId) await addRoomMember(roomCode, payload.userId);
    banner.remove();
  });
  denyBtn.addEventListener('click', ()=>{ respondToKnock(payload.peerId, false); banner.remove(); });
  setTimeout(()=> banner.remove(), 30000); // matches the knocker's own timeout
};