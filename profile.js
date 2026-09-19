/* ============================================================
   PROFILE.JS
   Profile pane (self and others') + the friend system.

   Opened by: the new "👤 Profile" nav tab (own profile), or
   tapping any avatar in the orbit / talk grid (their profile —
   resolved via the Supabase user id each peer now shares over
   presence, see peer-manager.js's joinRoomPresence).

   Taste sections (favorites/recently played/games) are read-only,
   fed automatically by activity-log.js — nothing here writes to
   activity_log directly. Bio/status are the only fields a user
   sets themselves.

   Needs the `friendships` table and the `bio`/`status` columns on
   `profiles` — see supabase/schema-profile-friends.sql.
   ============================================================ */

// ---------- Global online presence ----------
// Distinct from the per-room presence channel in peer-manager.js — this one
// tracks who's signed in and using the app ANYWHERE, not just this room, so
// Profile can show online/offline for a friend you're not currently with.
let globalPresenceChannel = null;
const onlineUserIds = new Set();

function startGlobalPresence(userId){
  if (!supabaseClient || globalPresenceChannel || !userId) return;
  globalPresenceChannel = supabaseClient.channel('presence:global', { config:{ presence:{ key:userId } } });
  globalPresenceChannel
    .on('presence', { event:'sync' }, ()=>{
      onlineUserIds.clear();
      Object.keys(globalPresenceChannel.presenceState()).forEach(uid=> onlineUserIds.add(uid));
    })
    .subscribe(async (status)=>{
      if (status === 'SUBSCRIBED') await globalPresenceChannel.track({ online:true });
    });
}
function isUserOnline(userId){ return onlineUserIds.has(userId); }

// ---------- Friend system ----------
async function sendFriendRequest(toUserId){
  if (!currentUser || !supabaseClient) return { error:'Not signed in' };
  // If they already sent YOU a request, accept theirs instead of creating
  // a second, reverse-direction row for the same pair.
  const existing = await fetchFriendshipStatus(toUserId);
  if (existing.status === 'pending-received') return respondToFriendRequest(existing.row.id, true);
  if (existing.status === 'friends' || existing.status === 'pending-sent') return { error:null };
  const { error } = await supabaseClient.from('friendships')
    .insert({ requester_id: currentUser.id, addressee_id: toUserId, status:'pending' });
  return { error };
}
async function respondToFriendRequest(rowId, accept){
  if (!supabaseClient) return { error:'Not connected' };
  if (accept){
    const { error } = await supabaseClient.from('friendships').update({ status:'accepted' }).eq('id', rowId);
    return { error };
  }
  const { error } = await supabaseClient.from('friendships').delete().eq('id', rowId);
  return { error };
}
async function removeFriend(otherUserId){
  if (!currentUser || !supabaseClient) return { error:'Not signed in' };
  const { error } = await supabaseClient.from('friendships').delete()
    .or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${currentUser.id})`);
  return { error };
}
async function fetchFriendshipStatus(otherUserId){
  if (!currentUser || !supabaseClient || !otherUserId) return { status:'none', row:null };
  const { data, error } = await supabaseClient
    .from('friendships').select('*')
    .or(`and(requester_id.eq.${currentUser.id},addressee_id.eq.${otherUserId}),and(requester_id.eq.${otherUserId},addressee_id.eq.${currentUser.id})`)
    .limit(1);
  if (error || !data || data.length===0) return { status:'none', row:null };
  const row = data[0];
  if (row.status === 'accepted') return { status:'friends', row };
  return { status: (row.requester_id === currentUser.id ? 'pending-sent' : 'pending-received'), row };
}
async function fetchIncomingRequests(){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('friendships').select('*').eq('addressee_id', currentUser.id).eq('status','pending');
  if (error || !data || data.length===0) return [];
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, first_name, last_name, username').in('id', data.map(r=>r.requester_id));
  return data.map(r=> ({ ...r, profile: (profiles||[]).find(p=>p.id===r.requester_id) }));
}
async function fetchFriends(){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('friendships').select('*')
    .or(`requester_id.eq.${currentUser.id},addressee_id.eq.${currentUser.id}`)
    .eq('status','accepted');
  if (error || !data || data.length===0) return [];
  const friendIds = data.map(f=> f.requester_id === currentUser.id ? f.addressee_id : f.requester_id);
  const { data: profiles } = await supabaseClient
    .from('profiles').select('id, first_name, last_name, username').in('id', friendIds);
  return profiles || [];
}

// ---------- Entry / exit ----------
// Profile is its own top-level screen now, not a tab inside the room —
// opening it just swaps screen-room out for screen-profile; closing it
// swaps back, and whatever screen-room had showing (entry-hub or
// activity-shell, and whichever pane) is untouched underneath, so it's
// exactly where you left it.
function openProfileForPeer(peerId){
  const isOwn = (peerId === myId);
  const userId = isOwn ? (currentUser ? currentUser.id : null) : (participants[peerId] ? participants[peerId].userId : null);
  const fallbackName = isOwn ? myName : (participants[peerId] ? participants[peerId].name : 'Someone');

  document.getElementById('screen-room').style.display = 'none';
  document.getElementById('screen-profile').style.display = 'flex';
  window.scrollTo(0,0);
  renderProfile(userId, fallbackName, isOwn);
}
function closeProfileScreen(){
  document.getElementById('screen-profile').style.display = 'none';
  document.getElementById('screen-room').style.display = 'block';
  window.scrollTo(0,0);
}
document.getElementById('btn-profile-back')?.addEventListener('click', closeProfileScreen);

// ---------- Rendering ----------
function dedupeConsecutive(items){
  const out = [];
  for (const it of items){
    if (out.length && out[out.length-1].video_id === it.video_id) continue;
    out.push(it);
  }
  return out;
}
function renderTasteSection(title, items, isRecentList){
  const list = isRecentList ? dedupeConsecutive(items) : items;
  if (!list.length) return '';
  return `
    <div class="profile-taste-section">
      <h4>${title}</h4>
      <div class="taste-list">
        ${list.map(it=> `<div class="taste-item"><span>${escapeHtml(it.title)}</span>${it.count>1?`<span class="taste-count">×${it.count}</span>`:''}</div>`).join('')}
      </div>
    </div>`;
}
function renderFriendButtonHTML(friendInfo){
  if (!friendInfo) return '';
  if (friendInfo.status === 'friends') return `<button class="btn btn-secondary btn-sm" id="btn-friend-action" data-status="friends" type="button">✓ Friends</button>`;
  if (friendInfo.status === 'pending-sent') return `<button class="btn btn-ghost btn-sm" id="btn-friend-action" data-status="pending-sent" disabled type="button">Request sent</button>`;
  if (friendInfo.status === 'pending-received') return `<button class="btn btn-primary btn-sm" id="btn-friend-action" data-status="pending-received" type="button">Accept friend request</button>`;
  return `<button class="btn btn-primary btn-sm" id="btn-friend-action" data-status="none" type="button">+ Add friend</button>`;
}
function wireFriendButton(userId, friendInfo){
  const btn = document.getElementById('btn-friend-action');
  if (!btn) return;
  btn.addEventListener('click', async ()=>{
    if (btn.dataset.status === 'none'){
      await sendFriendRequest(userId);
      toast('Friend request sent 👋');
    } else if (btn.dataset.status === 'pending-received'){
      await respondToFriendRequest(friendInfo.row.id, true);
      toast("You're now friends 🎉");
    } else if (btn.dataset.status === 'friends'){
      if (!confirm('Remove this friend?')) return;
      await removeFriend(userId);
      toast('Friend removed');
    }
    renderProfile(userId, '', false);
  });
}
async function renderOwnFriendsHTML(){
  const [requests, friends] = await Promise.all([fetchIncomingRequests(), fetchFriends()]);
  let html = '';
  if (requests.length){
    html += `<div class="profile-taste-section"><h4>👋 Friend requests</h4>`;
    html += requests.map(r=>{
      const name = r.profile ? (`${r.profile.first_name||''} ${r.profile.last_name||''}`.trim() || r.profile.username) : 'Someone';
      return `<div class="friend-request-row">
        <span>${escapeHtml(name)}</span>
        <span class="friend-request-actions">
          <button class="btn btn-secondary btn-sm" data-accept-req="${r.id}" type="button">Accept</button>
          <button class="btn btn-ghost btn-sm" data-decline-req="${r.id}" type="button">Decline</button>
        </span>
      </div>`;
    }).join('');
    html += `</div>`;
  }
  html += `<div class="profile-taste-section"><h4>👫 Friends (${friends.length})</h4>`;
  html += friends.length
    ? friends.map(f=>{
        const name = `${f.first_name||''} ${f.last_name||''}`.trim() || f.username;
        return `<div class="friend-row" data-view-friend="${f.id}">${escapeHtml(name)}</div>`;
      }).join('')
    : `<p class="hint">No friends yet — accept a request, or tap someone's avatar in a room to add them.</p>`;
  html += `</div>`;
  return html;
}
function wireOwnFriendsSectionButtons(){
  document.querySelectorAll('[data-accept-req]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{ await respondToFriendRequest(btn.dataset.acceptReq, true); toast("You're now friends 🎉"); openProfileForPeer(myId); });
  });
  document.querySelectorAll('[data-decline-req]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{ await respondToFriendRequest(btn.dataset.declineReq, false); toast('Request declined'); openProfileForPeer(myId); });
  });
  document.querySelectorAll('[data-view-friend]').forEach(row=>{
    row.addEventListener('click', ()=> renderProfile(row.dataset.viewFriend, '', false));
  });
}
function showProfileEditForm(profile){
  const formEl = document.getElementById('profile-edit-form');
  if (!formEl) return;
  formEl.style.display = 'block';
  formEl.innerHTML = `
    <div class="field"><label>Status</label>
      <input type="text" id="profile-edit-status" maxlength="60" placeholder="What are you up to?" value="${escapeHtml(profile?.status||'')}">
    </div>
    <div class="field"><label>Bio</label>
      <input type="text" id="profile-edit-bio" maxlength="160" placeholder="A short bio" value="${escapeHtml(profile?.bio||'')}">
    </div>
    <button class="btn btn-primary btn-sm" id="btn-save-profile-edit" type="button">Save</button>
    <button class="btn btn-ghost btn-sm" id="btn-cancel-profile-edit" type="button">Cancel</button>
  `;
  document.getElementById('btn-save-profile-edit').addEventListener('click', async ()=>{
    const status = document.getElementById('profile-edit-status').value.trim();
    const bio = document.getElementById('profile-edit-bio').value.trim();
    const { error } = await supabaseClient.from('profiles').update({ status, bio }).eq('id', currentUser.id);
    if (error){ toast("Couldn't save your profile", 'err'); return; }
    toast('Profile updated ✨');
    openProfileForPeer(myId);
  });
  document.getElementById('btn-cancel-profile-edit').addEventListener('click', ()=>{ formEl.style.display='none'; formEl.innerHTML=''; });
}

async function renderProfile(userId, fallbackName, isOwn){
  const container = document.getElementById('profile-view');
  if (!container) return;
  container.innerHTML = '<p class="hint">Loading profile…</p>';

  if (!userId){
    container.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar" style="background:${nameColor(fallbackName||'?')}">${initials(fallbackName)}</div>
        <div class="profile-name">${escapeHtml(fallbackName||'Guest')}</div>
        <p class="hint">Hasn't signed in — no profile to show yet.</p>
      </div>`;
    return;
  }

  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', userId).maybeSingle();
  const friendInfo = isOwn ? null : await fetchFriendshipStatus(userId);
  const online = isUserOnline(userId);

  const [recentVideo, recentMusic, topVideo, topMusic, topGames] = await Promise.all([
    fetchRecentActivityFor(userId, 'video', 6),
    fetchRecentActivityFor(userId, 'music', 6),
    fetchTopPlayedFor(userId, 'video', 5),
    fetchTopPlayedFor(userId, 'music', 5),
    fetchTopPlayedFor(userId, 'game', 5)
  ]);
  const friendsHTML = isOwn ? await renderOwnFriendsHTML() : '';

  const displayName = (profile ? `${profile.first_name||''} ${profile.last_name||''}`.trim() : '') || fallbackName || 'Someone';
  const username = profile ? profile.username : null;
  const bio = profile?.bio || '';
  const status = profile?.status || '';

  container.innerHTML = `
    <div class="profile-header">
      <div class="profile-avatar" style="background:${nameColor(displayName)}">${initials(displayName)}</div>
      <div class="profile-name">${escapeHtml(displayName)}</div>
      ${username ? `<div class="profile-username">@${escapeHtml(username)}</div>` : ''}
      <div class="profile-online-row"><span class="online-dot ${online?'on':''}"></span>${online?'Online':'Offline'}</div>
      ${status ? `<div class="profile-status">🎙️ ${escapeHtml(status)}</div>` : ''}
      ${bio ? `<p class="profile-bio">${escapeHtml(bio)}</p>` : (isOwn ? '<p class="hint">Add a bio so people know a bit about you.</p>' : '')}
      ${isOwn ? '<button class="btn btn-ghost btn-sm" id="btn-edit-profile" type="button">✏️ Edit profile</button>' : renderFriendButtonHTML(friendInfo)}
    </div>
    <div id="profile-edit-form" style="display:none;"></div>

    ${renderTasteSection('🎬 Favorite videos', topVideo)}
    ${renderTasteSection('🕓 Recently watched', recentVideo, true)}
    ${renderTasteSection('🎵 Favorite tracks', topMusic)}
    ${renderTasteSection('🕓 Recently played', recentMusic, true)}
    ${renderTasteSection('🎮 Favorite games', topGames)}

    ${friendsHTML}
  `;

  if (isOwn){
    const editBtn = document.getElementById('btn-edit-profile');
    if (editBtn) editBtn.addEventListener('click', ()=> showProfileEditForm(profile));
    wireOwnFriendsSectionButtons();
  } else {
    wireFriendButton(userId, friendInfo);
  }
}

// ---------- Entry-hub wiring ----------
// Profile lives on the entry-hub ("What are we doing tonight?") screen, and
// is also reachable by tapping anyone's avatar from inside a room.
const entryProfileBtn = document.getElementById('entry-btn-profile');
if (entryProfileBtn) entryProfileBtn.addEventListener('click', ()=> openProfileForPeer(myId));
