/* ============================================================
   AVATARS.JS — profile pictures and cover colours

   - A picture is a small square image kept in the public `avatars` storage bucket
     (see supabase/schema-profile-v2.sql); the profile row only stores its address.
   - Everyone in a room announces their picture address in presence, so friends see it
     straight away; anything missing is fetched in one batch and remembered.
   - Where a picture exists it replaces the coloured initials (profile, who's-here list,
     Talk tiles, chat). Where it doesn't, nothing changes.
   - Addresses coming from other people are only trusted if they point at OUR storage
     bucket, and colours only if they're plain #rrggbb, so nobody can slip a tracking
     image or styling into someone else's screen.
   ============================================================ */

const AVATAR_BUCKET = 'avatars';
const AVATAR_SIZE = 256;                       // pictures are cropped square and shrunk to this
const Avatars = { cache: Object.create(null), pending: new Set() };

function avatarUrlPrefix(){ return `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/`; }
function safeAvatarUrl(u){
  if (typeof u !== 'string' || u.length > 400 || !u.startsWith(avatarUrlPrefix())) return null;
  return /^[A-Za-z0-9\-._~:\/?#@!$&*+,;=%]+$/.test(u) ? u : null;      // nothing that could break out of url(...)
}
function safeCoverColor(c){ return (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c.toLowerCase() : null; }

// ---------- Colours ----------
function hslToHex(h, s, l){
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Everyone gets a pleasant default cover of their own, derived from their name
function defaultCover(seed){
  let hash = 0;
  const str = String(seed || '?');
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return hslToHex(Math.abs(hash) % 360, 62, 52);
}
function shadeColor(hex, percent){            // percent -100..100: negative darkens, positive lightens
  const n = parseInt(hex.slice(1), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + (percent / 100) * (percent < 0 ? c : 255 - c))));
  const r = adj((n >> 16) & 255), g = adj((n >> 8) & 255), b = adj(n & 255);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
function coverGradient(hex){ return `linear-gradient(135deg, ${hex}, ${shadeColor(hex, -35)})`; }

// ---------- The cache ----------
Avatars.set = function(userId, info){
  if (!userId) return;
  const prev = this.cache[userId] || {};
  this.cache[userId] = {
    url: info.url !== undefined ? safeAvatarUrl(info.url) : (prev.url || null),
    cover: info.cover !== undefined ? safeCoverColor(info.cover) : (prev.cover || null)
  };
};
Avatars.get = function(userId){ return userId ? (this.cache[userId] || null) : null; };

// Show the picture on an element if there is one, otherwise the coloured initials
function paintAvatar(el, userId, name){
  if (!el) return;
  if (userId) el.dataset.avatarUser = userId;
  el.dataset.avatarName = name || '';
  const info = Avatars.get(userId);
  if (info && info.url){
    el.style.backgroundImage = `url(${info.url})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
    el.classList.add('has-photo');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-photo');
    if (!el.textContent) el.textContent = initials(name || '?');
  }
}
function refreshAvatars(){
  document.querySelectorAll('[data-avatar-user]').forEach(el => paintAvatar(el, el.dataset.avatarUser, el.dataset.avatarName));
}

// Fetch pictures for people we only know by id (e.g. senders in old chat history) in one go
async function ensureAvatars(userIds){
  if (!supabaseClient) return;
  const want = [...new Set((userIds || []).filter(id => id && !Avatars.cache[id] && !Avatars.pending.has(id)))].slice(0, 100);
  if (!want.length) return;
  want.forEach(id => Avatars.pending.add(id));
  try{
    const { data, error } = await supabaseClient.from('profiles').select('id, avatar_url, cover_color').in('id', want);
    if (!error) (data || []).forEach(r => Avatars.set(r.id, { url: r.avatar_url, cover: r.cover_color }));
    want.forEach(id => { if (!Avatars.cache[id]) Avatars.cache[id] = { url: null, cover: null }; });   // remember "no picture" too
  }catch(e){ console.warn('Could not load pictures:', e); }
  want.forEach(id => Avatars.pending.delete(id));
  refreshAvatars();
}

// My own picture address, for presence
function myAvatarUrl(){ return (typeof myProfile !== 'undefined' && myProfile) ? safeAvatarUrl(myProfile.avatar_url) : null; }
// Who is this peer? (their account id, or mine if it's me)
function userIdOf(peerId){
  if (peerId === myId) return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  return participants[peerId] ? participants[peerId].userId : null;
}

// ---------- Choosing and uploading a picture ----------
// The largest square that fits in the middle of the photo
function squareCrop(width, height){
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

async function loadPhoto(file){
  if (window.createImageBitmap){
    try{ return await createImageBitmap(file, { imageOrientation: 'from-image' }); }catch(e){ /* fall through to <img> */ }
  }
  return await new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as a picture.")); };
    img.src = url;
  });
}
function canvasToBlob(canvas, type, quality){
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

// Photo from the camera roll -> small square picture (a few KB instead of several MB)
async function processAvatarFile(file){
  if (!file || !/^image\//.test(file.type)) throw new Error('Please choose a picture.');
  if (file.size > 12 * 1024 * 1024) throw new Error('That picture is too big (12 MB max).');
  const photo = await loadPhoto(file);
  const w = photo.width || photo.naturalWidth, h = photo.height || photo.naturalHeight;
  if (!w || !h) throw new Error("That file couldn't be read as a picture.");
  const { sx, sy, size } = squareCrop(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AVATAR_SIZE;
  canvas.getContext('2d').drawImage(photo, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);   // older Safari has no WebP
  if (blob && blob.size > 300 * 1024) blob = await canvasToBlob(canvas, blob.type, 0.6);
  if (!blob) throw new Error("Couldn't prepare that picture.");
  return blob;
}

// Uploads to <my id>/avatar and returns the public address (with a version so everyone refreshes it)
async function uploadAvatar(blob){
  if (!currentUser || !supabaseClient) throw new Error('Log in to change your picture.');
  const path = `${currentUser.id}/avatar`;
  const { error } = await supabaseClient.storage.from(AVATAR_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
  if (error){
    console.warn('Avatar upload failed:', error.message);
    if (/bucket|not found|404/i.test(error.message || '')) throw new Error("Picture uploads aren't switched on yet. Run schema-profile-v2.sql in Supabase.");
    throw new Error("Couldn't upload your picture. Please try again.");
  }
  const { data } = supabaseClient.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
async function deleteAvatarFile(){
  if (!currentUser || !supabaseClient) return;
  try{ await supabaseClient.storage.from(AVATAR_BUCKET).remove([`${currentUser.id}/avatar`]); }catch(e){}
}
