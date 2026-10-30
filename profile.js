/* ============================================================
   PROFILE.JS
   The profile screen (yours and other people's) and the friend system.

   A profile is a card, Discord-style: a cover colour, a round picture, your name and @nickname,
   a status, a bio and when you joined. Below it: ❤ Favourites, and — on your own profile —
   the songs and videos you saved in rooms (📌) and your friends.

   Your email is shown ONLY on your own profile. It lives in your account, never in the profile
   row other people can read, so it can't leak.

   You edit everything from "Edit profile": picture, cover colour, names, nickname, status, bio,
   email and password.

   Opened by: ☰ → Profile (your own), or tapping anyone's picture in a room.
   Needs supabase/schema-profile-v2.sql for pictures and cover colours.
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
function openProfileScreen(userId, fallbackName, isOwn){
  document.getElementById('screen-room').style.display = 'none';
  document.getElementById('screen-profile').style.display = 'flex';
  window.scrollTo(0,0);
  renderProfile(userId, fallbackName, isOwn);
}
function openProfileForPeer(peerId){
  const isOwn = (peerId === myId);
  const userId = isOwn ? (currentUser ? currentUser.id : null) : (participants[peerId] ? participants[peerId].userId : null);
  const fallbackName = isOwn ? myName : (participants[peerId] ? participants[peerId].name : 'Someone');
  openProfileScreen(userId, fallbackName, isOwn);
}
function closeProfileScreen(){
  document.getElementById('screen-profile').style.display = 'none';
  document.getElementById('screen-room').style.display = 'block';
  window.scrollTo(0,0);
  saveView({ profile: null });
}
document.getElementById('btn-profile-back')?.addEventListener('click', closeProfileScreen);

// ---------- Rendering ----------
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
    if (isGuest()){ requireAccount('add friends'); return; }
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

// ---------- My playlist (everything I saved with 📌, across rooms) ----------
let myPlaylistItems = [];
async function renderMyPlaylistHTML(){
  myPlaylistItems = await rpFetchMine(60);
  let html = `<div class="profile-taste-section"><h4>📌 My playlist</h4>`;
  if (!myPlaylistItems.length){
    return html + `<p class="hint">Songs and videos you save with 📌 in a room show up here. Only you see them on your profile.</p></div>`;
  }
  html += `<div class="playlist-list">` + myPlaylistItems.map(it=>`
    <div class="playlist-item">
      <img class="playlist-thumb" src="${escapeHtml(thumbUrl(it.videoId))}" alt="" loading="lazy">
      <div class="playlist-info">
        <div class="playlist-title">${escapeHtml(it.title)}</div>
        <div class="playlist-sub">${it.kind === 'music' ? '🎵 Song' : '🎬 Video'} · saved in ${escapeHtml(it.roomName || 'a room')}</div>
      </div>
      <span class="playlist-actions">
        <button class="btn btn-secondary btn-sm" data-my-play="${escapeHtml(it.id)}" type="button">▶ Play</button>
        <button class="icon-btn" data-my-remove="${escapeHtml(it.id)}" type="button" title="Remove" aria-label="Remove from my playlist">🗑</button>
      </span>
    </div>`).join('') + `</div></div>`;
  return html;
}
function wireMyPlaylistButtons(){
  document.querySelectorAll('[data-my-play]').forEach(btn=> btn.addEventListener('click', ()=>{
    const it = myPlaylistItems.find(i => i.id === btn.dataset.myPlay); if (!it) return;
    closeProfileScreen();
    playNow(it.kind, it.videoId, it.title);     // plays it in the room you're in right now
    setMode(it.kind, true);
  }));
  document.querySelectorAll('[data-my-remove]').forEach(btn=> btn.addEventListener('click', async ()=>{
    if (await rpRemoveMine(btn.dataset.myRemove)){ toast('Removed from your playlist'); renderProfile(currentUser.id, myName, true); }
  }));
}

// ---------- ❤ Favourites (hearted in the queue) ----------
function renderFavouritesHTML(items, isOwn){
  if (!items.length && !isOwn) return '';
  let html = `<div class="profile-taste-section"><h4>❤️ Favourites</h4>`;
  if (!items.length) return html + `<p class="hint">Tap the 🤍 under any video or song in the queue and it lands here.</p></div>`;
  html += `<div class="playlist-list">` + items.map(it=>`
    <div class="playlist-item">
      <img class="playlist-thumb" src="${escapeHtml(thumbUrl(it.video_id))}" alt="" loading="lazy">
      <div class="playlist-info">
        <div class="playlist-title" data-fav-title-for="${escapeHtml(it.id)}">${escapeHtml(isUrlish(it.title) ? 'Loading title…' : it.title)}</div>
        <div class="playlist-sub">${it.kind === 'music' ? '🎵 Song' : '🎬 Video'}</div>
      </div>
      <span class="playlist-actions">
        <button class="btn btn-secondary btn-sm" data-fav-play="${escapeHtml(it.id)}" type="button">▶ Play</button>
        ${isOwn ? `<button class="icon-btn" data-fav-remove="${escapeHtml(it.id)}" type="button" title="Remove" aria-label="Remove from favourites">🗑</button>` : ''}
      </span>
    </div>`).join('') + `</div></div>`;
  return html;
}
function wireFavouriteButtons(items, isOwn){
  document.querySelectorAll('[data-fav-play]').forEach(btn=> btn.addEventListener('click', ()=>{
    const it = items.find(i => i.id === btn.dataset.favPlay); if (!it) return;
    closeProfileScreen();
    playNow(it.kind, it.video_id, it.title);       // plays it in the room you're in right now
    setMode(it.kind, true);
  }));
  if (!isOwn) return;
  document.querySelectorAll('[data-fav-remove]').forEach(btn=> btn.addEventListener('click', async ()=>{
    if (await removeFavouriteById(btn.dataset.favRemove)){ toast('Removed from your favourites'); renderProfile(currentUser.id, myName, true); }
  }));
  // Older saves may only have a link as their title — look up the real name and tidy it
  items.filter(it => isUrlish(it.title)).forEach(async it=>{
    const real = (await fetchVideoTitle(it.video_id)) || 'YouTube video';
    const node = document.querySelector(`[data-fav-title-for="${it.id}"]`);
    if (node) node.textContent = real;
    if (real !== 'YouTube video') updateFavouriteTitle(it.id, real);
  });
}

// ---------- Profile card ----------
function profileMemberSince(profile){
  if (!profile || !profile.created_at) return '';
  const d = new Date(profile.created_at);
  return isNaN(d) ? '' : d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}
function profileDisplayName(profile, fallback){
  const full = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  return full || (profile && profile.username) || fallback || 'Someone';
}
function profileCoverHex(profile, seed){
  return safeCoverColor(profile && profile.cover_color) || defaultCover(seed);
}

// The card is also used (without the extras) as the live preview inside the editor
function profileCardHTML(o){
  const { profile, isOwn, online, friendInfo } = o;
  const name = profileDisplayName(profile, o.fallbackName);
  const username = profile && profile.username ? profile.username : '';
  const photo = safeAvatarUrl(profile && profile.avatar_url);
  const cover = profileCoverHex(profile, username || name);
  const since = profileMemberSince(profile);
  const status = (profile && profile.status) || '';
  const bio = (profile && profile.bio) || '';
  const avatarStyle = photo ? `background-image:url(${escapeHtml(photo)})` : `background:${nameColor(username || name)}`;
  return `
    <section class="pf-card" aria-label="Profile">
      <div class="pf-cover" style="background:${coverGradient(cover)}">
        ${isOwn ? '<button class="pf-edit-btn" id="btn-edit-profile" type="button">✎ Edit profile</button>' : ''}
      </div>
      <div class="pf-head">
        <div class="pf-avatar-wrap">
          <div class="pf-avatar ${photo ? 'has-photo' : ''}" style="${avatarStyle}" role="img" aria-label="${escapeHtml(name)}'s picture">${photo ? '' : escapeHtml(initials(name))}</div>
          <span class="online-dot pf-online ${online ? 'on' : ''}" title="${online ? 'Online' : 'Offline'}"></span>
        </div>
        ${isOwn ? '' : `<div class="pf-actions">${renderFriendButtonHTML(friendInfo)}</div>`}
      </div>
      <div class="pf-body">
        <h2 class="pf-name">${escapeHtml(name)}</h2>
        ${username ? `<div class="pf-username">@${escapeHtml(username)}</div>` : ''}
        ${status ? `<div class="pf-status">🎙️ ${escapeHtml(status)}</div>` : ''}
        ${bio ? `<div class="pf-block"><h4>About me</h4><p class="pf-bio">${escapeHtml(bio)}</p></div>`
               : (isOwn ? '<div class="pf-block"><h4>About me</h4><p class="hint">Add a short bio so people know a bit about you.</p></div>' : '')}
        <div class="pf-meta">
          ${since ? `<span>🗓 Member since ${escapeHtml(since)}</span>` : ''}
          ${isOwn && currentUser && currentUser.email ? `<span class="pf-email">✉ ${escapeHtml(currentUser.email)} <em>🔒 only you can see this</em></span>` : ''}
        </div>
      </div>
    </section>`;
}

let profileRenderSeq = 0;
async function renderProfile(userId, fallbackName, isOwn){
  const container = document.getElementById('profile-view');
  if (!container) return;
  const seq = ++profileRenderSeq;                    // if they tap around quickly, only the newest render wins
  container.innerHTML = '<p class="hint">Loading profile…</p>';
  saveView({ profile: { userId, name: fallbackName || '', isOwn: !!isOwn } });   // so a reload reopens this profile

  if (!userId){
    if (isOwn){
      // A guest looking at their own profile: nothing to show yet, just the way in
      container.innerHTML = `
        <div class="profile-header">
          <div class="profile-avatar" style="background:${nameColor(fallbackName||'?')}">${initials(fallbackName)}</div>
          <div class="profile-name">${escapeHtml(fallbackName||'Guest')}</div>
          <div class="profile-username">Guest</div>
          <p class="profile-bio">You're using Together as a guest. Create a free account to get your own profile, save playlists and favourites, keep your chat history and save rooms.</p>
        </div>
        <div class="guest-cards">
          <div class="guest-card">
            <div class="guest-card-icon">✨</div>
            <h4>New here?</h4>
            <p>Create a free account in a minute.</p>
            <button class="btn btn-primary btn-block" id="btn-profile-signup" type="button">Sign up</button>
          </div>
          <div class="guest-card">
            <div class="guest-card-icon">👋</div>
            <h4>Already a member?</h4>
            <p>Log in to pick up where you left off.</p>
            <button class="btn btn-secondary btn-block" id="btn-profile-login" type="button">Log in</button>
          </div>
        </div>`;
      document.getElementById('btn-profile-signup').addEventListener('click', ()=> upgradeFromGuest('signup'));
      document.getElementById('btn-profile-login').addEventListener('click', ()=> upgradeFromGuest('login'));
      return;
    }
    container.innerHTML = `
      <div class="profile-header">
        <div class="profile-avatar" style="background:${nameColor(fallbackName||'?')}">${initials(fallbackName)}</div>
        <div class="profile-name">${escapeHtml(fallbackName||'Guest')}</div>
        <p class="hint">${escapeHtml(fallbackName||'This person')} is a guest — no profile to show.</p>
      </div>`;
    return;
  }

  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', userId).maybeSingle();
  const friendInfo = isOwn ? null : await fetchFriendshipStatus(userId);
  const online = isOwn ? true : isUserOnline(userId);
  const [favourites, friendsHTML, playlistHTML] = await Promise.all([
    fetchFavouritesFor(userId, 40),
    isOwn ? renderOwnFriendsHTML() : '',
    isOwn ? renderMyPlaylistHTML() : ''
  ]);
  if (seq !== profileRenderSeq) return;
  if (profile){ Avatars.set(userId, { url: profile.avatar_url, cover: profile.cover_color }); refreshAvatars(); }

  container.innerHTML = `
    ${profileCardHTML({ profile, fallbackName, isOwn, online, friendInfo })}
    ${renderFavouritesHTML(favourites, isOwn)}
    ${playlistHTML}
    ${friendsHTML}
  `;

  wireFavouriteButtons(favourites, isOwn);
  if (isOwn){
    const editBtn = document.getElementById('btn-edit-profile');
    if (editBtn) editBtn.addEventListener('click', ()=> showProfileEditor(profile));
    wireOwnFriendsSectionButtons();
    wireMyPlaylistButtons();
  } else {
    wireFriendButton(userId, friendInfo);
  }
}

// ---------- Editing ----------
const COVER_PRESETS = ['#ff6f91','#ff8a4c','#ffd166','#3ddc97','#2dd4bf','#4f8cff','#7c6cf0','#a78bfa','#e66bd8','#f43f5e','#64748b','#1f2a44'];

// Checks the form and tidies the text. Returns { errors: [...], fields: {...} }
function validateProfileForm(v){
  const errors = [];
  const first = (v.first || '').trim(), last = (v.last || '').trim(), username = (v.username || '').trim();
  const status = (v.status || '').trim(), bio = (v.bio || '').trim();
  if (!first) errors.push('Enter your first name.');
  if (first.length > 30 || last.length > 30) errors.push('Names can be up to 30 characters.');
  if (username.length < 2 || username.length > 20) errors.push('Your nickname needs 2 to 20 characters.');
  if (status.length > 60) errors.push('Status can be up to 60 characters.');
  if (bio.length > 160) errors.push('Bio can be up to 160 characters.');
  if (v.cover && !safeCoverColor(v.cover)) errors.push('Pick a valid cover colour.');
  const email = (v.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.push("That email address doesn't look right.");
  if (v.password){
    if (v.password.length < 6) errors.push('Choose a new password with at least 6 characters.');
    else if (v.password !== v.password2) errors.push("The two new passwords don't match.");
  }
  return { errors, fields: { first_name: first, last_name: last, username, status, bio } };
}

// Saves everything. Never throws; returns { ok, error?, warnings[], notes[], changedUsername }.
// The text details are saved even if the picture or colour can't be (e.g. the database update hasn't been run yet).
async function saveProfileChanges(profile, values, draft){
  const { errors, fields } = validateProfileForm(values);
  if (errors.length) return { ok: false, error: errors[0] };
  if (!currentUser || !supabaseClient) return { ok: false, error: 'Log in to edit your profile.' };
  const warnings = [], notes = [];
  const current = (profile && profile.username) || '';
  const changedUsername = fields.username.toLowerCase() !== current.toLowerCase() || fields.username !== current;

  if (fields.username.toLowerCase() !== current.toLowerCase() && await checkUsernameAvailable(fields.username) === false){
    return { ok: false, error: 'That nickname is taken. Try another.' };
  }

  let avatarUrl;                                    // undefined = leave the picture as it is
  if (draft.avatarBlob){
    try{ avatarUrl = await uploadAvatar(draft.avatarBlob); }catch(e){ warnings.push(e.message); }
  } else if (draft.removeAvatar){
    await deleteAvatarFile();
    avatarUrl = null;
  }

  const extras = { cover_color: draft.cover };
  if (avatarUrl !== undefined) extras.avatar_url = avatarUrl;
  let { error } = await supabaseClient.from('profiles').update({ ...fields, ...extras }).eq('id', currentUser.id);
  if (error && /cover_color|avatar_url|column/i.test(error.message || '')){
    warnings.push('Picture and cover colour need a one-time database update (schema-profile-v2.sql). Everything else was saved.');
    ({ error } = await supabaseClient.from('profiles').update(fields).eq('id', currentUser.id));
  }
  if (error){
    if (error.code === '23505') return { ok: false, error: 'That nickname is taken. Try another.' };
    console.error('Profile save failed:', error);
    return { ok: false, error: "Couldn't save your profile. Please try again." };
  }

  const newEmail = (values.email || '').trim();
  if (newEmail && newEmail.toLowerCase() !== (currentUser.email || '').toLowerCase()){
    const { error: e } = await supabaseClient.auth.updateUser({ email: newEmail });
    if (e){ console.warn('Email change failed:', e.message); warnings.push("Couldn't change your email: " + (/rate|too many/i.test(e.message || '') ? 'please wait a minute and try again.' : 'please check it and try again.')); }
    else notes.push(`We sent a confirmation to ${newEmail}. Your email changes once you confirm it.`);
  }
  if (values.password){
    const { error: e } = await setNewPassword(values.password);
    if (e){ console.warn('Password change failed:', e.message); warnings.push(/different from the old/i.test(e.message || '') ? 'Choose a password you are not already using.' : "Couldn't change your password. Please try again."); }
    else notes.push('Your password was changed.');
  }

  await loadMyProfile();
  return { ok: true, warnings, notes, changedUsername };
}

function showProfileEditor(profile){
  const container = document.getElementById('profile-view');
  if (!container || !currentUser) return;
  const p = profile || {};
  const seedName = p.username || myName;
  const draft = { cover: safeCoverColor(p.cover_color) || defaultCover(seedName), avatarBlob: null, avatarPreview: null, removeAvatar: false };
  const currentPhoto = safeAvatarUrl(p.avatar_url);
  const $ = id => document.getElementById(id);

  container.innerHTML = `
    <div class="pf-editor">
      <section class="pf-card pf-preview" aria-label="Preview">
        <div class="pf-cover" id="pe-cover"></div>
        <div class="pf-head"><div class="pf-avatar-wrap"><div class="pf-avatar" id="pe-avatar"></div></div></div>
        <div class="pf-body"><h2 class="pf-name" id="pe-preview-name"></h2><div class="pf-username" id="pe-preview-username"></div></div>
      </section>

      <div class="pe-group">
        <h4>Picture</h4>
        <div class="pe-row">
          <button class="btn btn-secondary btn-sm" id="pe-upload" type="button">📷 Upload a photo</button>
          <button class="btn btn-ghost btn-sm" id="pe-remove" type="button">Remove</button>
          <input type="file" id="pe-file" accept="image/*" hidden>
        </div>
        <p class="hint">It's cropped to a square. Smaller is fine; we shrink it for you.</p>
      </div>

      <div class="pe-group">
        <h4>Cover colour</h4>
        <div class="pe-swatches" id="pe-swatches" role="radiogroup" aria-label="Cover colour">
          ${COVER_PRESETS.map(c => `<button class="pe-swatch" type="button" role="radio" aria-checked="false" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}
          <label class="pe-swatch pe-custom" title="Pick any colour">🎨<input type="color" id="pe-color" value="${draft.cover}"></label>
        </div>
      </div>

      <div class="pe-group">
        <h4>About you</h4>
        <div class="split pe-split">
          <div class="field"><label for="pe-first">First name</label><input type="text" id="pe-first" maxlength="30" autocomplete="given-name" value="${escapeHtml(p.first_name || '')}"></div>
          <div class="field"><label for="pe-last">Last name</label><input type="text" id="pe-last" maxlength="30" autocomplete="family-name" value="${escapeHtml(p.last_name || '')}"></div>
        </div>
        <div class="field"><label for="pe-username">Nickname</label><input type="text" id="pe-username" maxlength="20" autocomplete="nickname" autocapitalize="none" spellcheck="false" value="${escapeHtml(p.username || '')}"><p class="hint" id="pe-username-hint">Shown in chat and rooms. Must be unique.</p></div>
        <div class="field"><label for="pe-status">Status</label><input type="text" id="pe-status" maxlength="60" placeholder="What are you up to?" value="${escapeHtml(p.status || '')}"></div>
        <div class="field"><label for="pe-bio">Bio</label><input type="text" id="pe-bio" maxlength="160" placeholder="A short bio" value="${escapeHtml(p.bio || '')}"><p class="hint" id="pe-bio-count"></p></div>
      </div>

      <div class="pe-group">
        <h4>Account</h4>
        <div class="field"><label for="pe-email">Email</label><input type="text" id="pe-email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${escapeHtml(currentUser.email || '')}"><p class="hint">🔒 Only you can see your email. Changing it needs a confirmation from the new address.</p></div>
        <div class="split pe-split">
          <div class="field"><label for="pe-pass">New password</label><input type="password" id="pe-pass" autocomplete="new-password" placeholder="Leave blank to keep"></div>
          <div class="field"><label for="pe-pass2">Confirm</label><input type="password" id="pe-pass2" autocomplete="new-password" placeholder="Type it again"></div>
        </div>
      </div>

      <p class="pe-msg" id="pe-msg" role="status" aria-live="polite"></p>
      <div class="pe-actions">
        <button class="btn btn-primary" id="pe-save" type="button">Save changes</button>
        <button class="btn btn-ghost" id="pe-cancel" type="button">Cancel</button>
      </div>
    </div>`;

  const val = id => $(id).value;
  const say = (text, isErr) => { const m = $('pe-msg'); m.textContent = text; m.style.color = isErr ? 'var(--coral-ink)' : 'var(--text-muted)'; };
  const cleanupPreview = ()=>{ if (draft.avatarPreview){ URL.revokeObjectURL(draft.avatarPreview); draft.avatarPreview = null; } };

  function updatePreview(){
    $('pe-cover').style.background = coverGradient(draft.cover);
    const first = val('pe-first').trim(), last = val('pe-last').trim(), uname = val('pe-username').trim();
    const name = `${first} ${last}`.trim() || uname || 'You';
    $('pe-preview-name').textContent = name;
    $('pe-preview-username').textContent = uname ? '@' + uname : '';
    const av = $('pe-avatar');
    const photo = draft.removeAvatar ? null : (draft.avatarPreview || currentPhoto);
    if (photo){ av.style.backgroundImage = `url(${photo})`; av.textContent = ''; av.classList.add('has-photo'); }
    else { av.style.backgroundImage = ''; av.style.background = nameColor(uname || name); av.textContent = initials(name); av.classList.remove('has-photo'); }
    document.querySelectorAll('#pe-swatches .pe-swatch[data-color]').forEach(s => s.setAttribute('aria-checked', s.dataset.color === draft.cover ? 'true' : 'false'));
    $('pe-bio-count').textContent = `${val('pe-bio').length} / 160`;
  }

  $('pe-upload').addEventListener('click', ()=> $('pe-file').click());
  $('pe-file').addEventListener('change', async ()=>{
    const file = $('pe-file').files && $('pe-file').files[0];
    if (!file) return;
    say('Preparing your picture…');
    try{
      const blob = await processAvatarFile(file);
      cleanupPreview();
      draft.avatarBlob = blob; draft.removeAvatar = false; draft.avatarPreview = URL.createObjectURL(blob);
      say('');
      updatePreview();
    }catch(e){ say(e.message || "Couldn't use that picture.", true); }
    $('pe-file').value = '';
  });
  $('pe-remove').addEventListener('click', ()=>{ cleanupPreview(); draft.avatarBlob = null; draft.removeAvatar = true; updatePreview(); });
  document.querySelectorAll('#pe-swatches .pe-swatch[data-color]').forEach(s => s.addEventListener('click', ()=>{ draft.cover = s.dataset.color; $('pe-color').value = draft.cover; updatePreview(); }));
  $('pe-color').addEventListener('input', ()=>{ draft.cover = safeCoverColor($('pe-color').value) || draft.cover; updatePreview(); });
  ['pe-first', 'pe-last', 'pe-bio'].forEach(id => $(id).addEventListener('input', updatePreview));

  let unameTimer = null, unameSeq = 0;
  $('pe-username').addEventListener('input', ()=>{
    updatePreview();
    clearTimeout(unameTimer);
    const hint = $('pe-username-hint'), name = val('pe-username').trim();
    hint.style.color = '';
    if (name.length < 2 || name.toLowerCase() === (p.username || '').toLowerCase()){ unameSeq++; hint.textContent = 'Shown in chat and rooms. Must be unique.'; return; }
    unameTimer = setTimeout(async ()=>{
      const seq = ++unameSeq;
      const free = await checkUsernameAvailable(name);
      if (seq !== unameSeq) return;
      if (free === true){ hint.textContent = '✓ That nickname is free'; hint.style.color = 'var(--teal)'; }
      else if (free === false){ hint.textContent = 'That nickname is taken. Try another.'; hint.style.color = 'var(--coral-ink)'; }
      else hint.textContent = 'Shown in chat and rooms. Must be unique.';
    }, 450);
  });

  $('pe-cancel').addEventListener('click', ()=>{ cleanupPreview(); renderProfile(currentUser.id, myName, true); });
  $('pe-save').addEventListener('click', async ()=>{
    const btn = $('pe-save');
    btn.disabled = true;
    say('Saving…');
    const values = { first: val('pe-first'), last: val('pe-last'), username: val('pe-username'), status: val('pe-status'), bio: val('pe-bio'),
      cover: draft.cover, email: val('pe-email'), password: val('pe-pass'), password2: val('pe-pass2') };
    const result = await saveProfileChanges(p, values, draft);
    btn.disabled = false;
    if (!result.ok){ say(result.error, true); return; }
    cleanupPreview();
    Avatars.set(currentUser.id, { url: myProfile && myProfile.avatar_url, cover: myProfile && myProfile.cover_color });
    refreshAvatars();
    if (typeof refreshMyPresence === 'function') refreshMyPresence();
    if (result.changedUsername && myProfile && typeof applyNewDisplayName === 'function') applyNewDisplayName(myProfile.username);
    toast('Profile updated ✨');
    [...result.notes, ...result.warnings].forEach((m, i) => setTimeout(()=> toast(m), 600 + i * 3200));
    renderProfile(currentUser.id, myName, true);
  });

  updatePreview();
}

// ---------- Entry-hub wiring ----------
// Profile lives on the entry-hub ("What are we doing tonight?") screen, and
// is also reachable by tapping anyone's avatar from inside a room.
const entryProfileBtn = document.getElementById('entry-btn-profile');
if (entryProfileBtn) entryProfileBtn.addEventListener('click', ()=> openProfileForPeer(myId));
