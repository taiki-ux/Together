/* ============================================================

ROOMS.JS

Saved-rooms list (Supabase rooms table) — the screen between

login and Create/Join — plus the knock-to-enter flow: someone

typing in a room code broadcasts a request that current members

can accept or deny. Invite links and your own saved rooms skip

this entirely (see requireApproval in peer-manager.js).

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

async function saveCurrentRoom(name){

if (!currentUser || !supabaseClient){ toast('Log in to save rooms'); return false; }

const { error } = await supabaseClient.from('rooms').insert({ code: roomCode, name, owner_id: currentUser.id });

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

    <h4>${escapeHtml(r.name)}</h4>

    <p class="hint mono">${escapeHtml(r.code.slice(0,10))}…</p>

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

showLandingStatus(Joining "${name}"…);

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

document.getElementById('entry-btn-save-room').addEventListener('click', ()=>{

const bar = document.getElementById('save-room-bar');

bar.style.display = bar.style.display==='flex' ? 'none' : 'flex';

if (bar.style.display==='flex') document.getElementById('save-room-name').focus();

});

document.getElementById('btn-save-room-confirm').addEventListener('click', async ()=>{

const name = document.getElementById('save-room-name').value.trim();

if (!name){ toast('Give the room a name first'); return; }

const ok = await saveCurrentRoom(name);

if (ok){ document.getElementById('save-room-bar').style.display='none'; document.getElementById('save-room-name').value=''; }

});

document.getElementById('btn-save-room-cancel').addEventListener('click', ()=>{

document.getElementById('save-room-bar').style.display='none';

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

acceptBtn.addEventListener('click', ()=>{ respondToKnock(payload.peerId, true); banner.remove(); });

denyBtn.addEventListener('click', ()=>{ respondToKnock(payload.peerId, false); banner.remove(); });

setTimeout(()=> banner.remove(), 30000); // matches the knocker's own timeout

};