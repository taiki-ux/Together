/* ============================================================
   CHAT.JS
   Everything chat: message transport + rendering, typing
   indicator, reactions, reply/quote, edit/delete (own messages,
   WhatsApp-style — long-press/right-click for the action sheet,
   deletes leave a placeholder rather than vanishing), timestamps,
   and unread badges on the Chat nav tab + sidebar toggle.

   Buddy-specific logic (the AI reply itself, rate limiting,
   room context) stays in app.js — this file only knows that
   @ai/@Buddy triggers a call into respondAsAI(), not what that
   does.

   Message history is NOT synced to new joiners (same as before
   this phase) — only what happens while you're actually in the
   room.
   ============================================================ */

// ---------- State ----------
const chatMessages = {};        // id -> message object (this session only)
let recentChatLog = [];         // rolling window the AI buddy uses for room context
let replyingTo = null;          // { id, name, text } | null
let editingId = null;           // message id currently being edited, or null
let unreadCount = 0;

let typingUsers = {};           // peerId -> name
let typingTimeouts = {};
let buddyTyping = false;

function makeMessageId(){ return 'm' + Date.now() + Math.random().toString(36).slice(2,7); }
function formatTime(ts){
  return new Date(ts).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
}

// ---------- Sending ----------
function sendChatMessage(name, text, isAI, replyTo){
  const id = makeMessageId();
  const timestamp = Date.now();
  addChatMessage({ id, fromId:myId, name, text, mine:true, isAI:!!isAI, timestamp,
    replyTo: replyTo || null, reactions:{}, edited:false, deleted:false });
  broadcast({ type:'chat', action:'send', id, name, text, isAI:!!isAI, timestamp, replyTo: replyTo || null });
}

function sendChatFromInput(){
  const input = document.getElementById('input-chat');
  const text = input.value.trim();
  if (!text) return;
  clearTimeout(myTypingTimeout);
  if (myTypingActive){ myTypingActive = false; broadcast({ type:'typing', name: myName, state:'stop' }); }

  if (editingId){
    const id = editingId;
    applyEdit(id, text);
    broadcast({ type:'chat', action:'edit', id, text });
    cancelComposeContext();
    return;
  }

  const replySnapshot = replyingTo;
  sendChatMessage(myName, text, false, replySnapshot);
  cancelComposeContext();
  input.value = '';
  if (/(?:^|\s)@(ai|buddy)(?:\s|$)/i.test(text) && typeof respondAsAI === 'function') respondAsAI(text);
}

// ---------- Rendering ----------
function addChatMessage(msg){
  chatMessages[msg.id] = msg;
  const log = document.getElementById('chat-log');
  if (log){
    const div = document.createElement('div');
    div.className = 'msg' + (msg.isAI ? ' ai' : '');
    div.dataset.messageId = msg.id;
    const color = msg.isAI ? 'var(--violet)' : (msg.mine ? 'var(--gold)' : nameColor(msg.name));
    div.innerHTML = `
      ${msg.replyTo ? `<div class="msg-reply-preview"><b>${escapeHtml(msg.replyTo.name)}</b><span>${escapeHtml(msg.replyTo.text.slice(0,80))}</span></div>` : ''}
      <div class="who" style="color:${color}">${escapeHtml(msg.name)}</div>
      <div class="txt">${escapeHtml(msg.text)}</div>
      <div class="msg-meta">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        <span class="msg-reactions" id="reactions-${msg.id}"></span>
      </div>
    `;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    attachMessageInteractions(div, msg.id);
  }

  recentChatLog.push({ name: msg.name, text: msg.text });
  if (recentChatLog.length > 15) recentChatLog.shift();

  if (!msg.mine && !isChatVisible()) bumpUnread();
}

function addSystemMessage(text){
  const log = document.getElementById('chat-log');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ---------- Remote sync ----------
registerHandler('chat', (fromId, data)=>{
  if (data.action === 'send'){
    addChatMessage({ id:data.id, fromId, name:data.name, text:data.text, mine:false,
      isAI:!!data.isAI, timestamp:data.timestamp || Date.now(), replyTo:data.replyTo || null,
      reactions:{}, edited:false, deleted:false });
    if (window.onChatReceived) window.onChatReceived();
  } else if (data.action === 'edit'){
    applyEdit(data.id, data.text);
  } else if (data.action === 'delete'){
    const msg = chatMessages[data.id];
    if (msg){ msg.deleted = true; renderDeletedMessage(data.id); }
  } else if (data.action === 'react'){
    const msg = chatMessages[data.id]; if (!msg) return;
    if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];
    const idx = msg.reactions[data.emoji].indexOf(data.peerId);
    if (data.add && idx === -1) msg.reactions[data.emoji].push(data.peerId);
    if (!data.add && idx !== -1) msg.reactions[data.emoji].splice(idx,1);
    if (msg.reactions[data.emoji].length === 0) delete msg.reactions[data.emoji];
    renderMessageReactions(data.id);
  }
});

registerHandler('typing', (fromId, data)=>{
  clearTimeout(typingTimeouts[fromId]);
  if (data.state === 'start'){
    typingUsers[fromId] = data.name;
    typingTimeouts[fromId] = setTimeout(()=>{ delete typingUsers[fromId]; renderTypingIndicator(); }, 4000);
  } else {
    delete typingUsers[fromId];
  }
  renderTypingIndicator();
});

function renderTypingIndicator(){
  const el = document.getElementById('typing-indicator');
  if (!el) return;
  if (buddyTyping){ el.textContent = '🤖 Buddy is typing…'; return; }
  const names = Object.values(typingUsers);
  if (names.length === 0){ el.textContent = ''; return; }
  el.textContent = names.length === 1 ? `${names[0]} is typing…` : `${names.join(', ')} are typing…`;
}
function showBuddyTyping(on){ buddyTyping = on; renderTypingIndicator(); }

// ---------- Reactions ----------
function toggleReaction(id, emoji){
  const msg = chatMessages[id]; if (!msg) return;
  if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
  const idx = msg.reactions[emoji].indexOf(myId);
  const adding = idx === -1;
  if (adding) msg.reactions[emoji].push(myId);
  else msg.reactions[emoji].splice(idx,1);
  if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
  renderMessageReactions(id);
  broadcast({ type:'chat', action:'react', id, emoji, peerId:myId, add:adding });
}
function renderMessageReactions(id){
  const el = document.getElementById('reactions-' + id);
  if (!el) return;
  const msg = chatMessages[id];
  el.innerHTML = Object.entries(msg.reactions || {}).map(([emoji, peerIds])=>{
    const mine = peerIds.includes(myId);
    return `<button class="reaction-pill ${mine?'mine':''}" data-toggle-emoji="${emoji}">${emoji} ${peerIds.length}</button>`;
  }).join('');
  el.querySelectorAll('[data-toggle-emoji]').forEach(btn=>{
    btn.addEventListener('click', ()=> toggleReaction(id, btn.dataset.toggleEmoji));
  });
}

// ---------- Edit / delete ----------
function applyEdit(id, newText){
  const msg = chatMessages[id]; if (!msg) return;
  msg.text = newText;
  msg.edited = true;
  const txtEl = document.querySelector(`.msg[data-message-id="${id}"] .txt`);
  if (txtEl) txtEl.innerHTML = `${escapeHtml(newText)} <span class="edited-tag">(edited)</span>`;
}
function deleteMessage(id){
  const msg = chatMessages[id]; if (!msg || !msg.mine) return;
  msg.deleted = true;
  broadcast({ type:'chat', action:'delete', id });
  renderDeletedMessage(id);
}
function renderDeletedMessage(id){
  const txtEl = document.querySelector(`.msg[data-message-id="${id}"] .txt`);
  if (txtEl) txtEl.innerHTML = '<em class="deleted-text">This message was deleted</em>';
  const reactionsEl = document.getElementById('reactions-' + id);
  if (reactionsEl) reactionsEl.innerHTML = '';
}

// ---------- Reply / edit compose bar ----------
function startReply(id){
  const msg = chatMessages[id]; if (!msg || msg.deleted) return;
  editingId = null;
  replyingTo = { id, name: msg.name, text: msg.text };
  showComposeContext(`Replying to ${msg.name}`, msg.text);
  document.getElementById('input-chat').focus();
}
function startEdit(id){
  const msg = chatMessages[id]; if (!msg || !msg.mine || msg.isAI || msg.deleted) return;
  replyingTo = null;
  editingId = id;
  showComposeContext('Editing message', msg.text);
  const input = document.getElementById('input-chat');
  input.value = msg.text;
  input.focus();
  const sendBtn = document.getElementById('btn-send');
  if (sendBtn) sendBtn.textContent = 'Save';
}
function cancelComposeContext(){
  replyingTo = null;
  editingId = null;
  hideComposeContext();
  const sendBtn = document.getElementById('btn-send');
  if (sendBtn) sendBtn.textContent = 'Send';
}
function showComposeContext(label, preview){
  const bar = document.getElementById('compose-context-bar');
  const labelEl = document.getElementById('compose-context-label');
  if (!bar || !labelEl) return;
  labelEl.innerHTML = `${escapeHtml(label)}<span class="compose-context-preview">${escapeHtml(preview.slice(0,60))}</span>`;
  bar.style.display = 'flex';
}
function hideComposeContext(){
  const bar = document.getElementById('compose-context-bar');
  if (bar) bar.style.display = 'none';
}
const cancelComposeBtn = document.getElementById('btn-cancel-compose-context');
if (cancelComposeBtn) cancelComposeBtn.addEventListener('click', ()=>{
  cancelComposeContext();
  document.getElementById('input-chat').value = '';
});

// ---------- Long-press / right-click action sheet ----------
function attachMessageInteractions(msgEl, id){
  let pressTimer = null;
  const start = ()=>{ pressTimer = setTimeout(()=> openMessageActions(id), 500); };
  const cancel = ()=> clearTimeout(pressTimer);
  msgEl.addEventListener('touchstart', start, { passive:true });
  msgEl.addEventListener('touchend', cancel);
  msgEl.addEventListener('touchmove', cancel);
  msgEl.addEventListener('mousedown', start);
  msgEl.addEventListener('mouseup', cancel);
  msgEl.addEventListener('mouseleave', cancel);
  msgEl.addEventListener('contextmenu', e=>{ e.preventDefault(); openMessageActions(id); });
}

function openMessageActions(id){
  const msg = chatMessages[id];
  if (!msg || msg.deleted) return;
  closeMessageActions();

  const canEdit = msg.mine && !msg.isAI;
  const sheet = document.createElement('div');
  sheet.className = 'msg-action-sheet';
  sheet.id = 'msg-action-sheet';
  sheet.innerHTML = `
    <div class="msg-action-emojis">
      ${['👍','❤️','😂','😭','😱','🔥'].map(e=>`<button class="msg-emoji-btn" data-emoji="${e}" type="button">${e}</button>`).join('')}
    </div>
    <button class="msg-action-row" data-do="reply" type="button">↩ Reply</button>
    ${canEdit ? '<button class="msg-action-row" data-do="edit" type="button">✏️ Edit</button>' : ''}
    ${canEdit ? '<button class="msg-action-row danger" data-do="delete" type="button">🗑 Delete</button>' : ''}
    <button class="msg-action-row" data-do="cancel" type="button">Cancel</button>
  `;
  const backdrop = document.createElement('div');
  backdrop.className = 'msg-action-backdrop';
  backdrop.id = 'msg-action-backdrop';
  backdrop.addEventListener('click', closeMessageActions);

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);

  sheet.querySelectorAll('.msg-emoji-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ toggleReaction(id, btn.dataset.emoji); closeMessageActions(); });
  });
  sheet.querySelector('[data-do="reply"]').addEventListener('click', ()=>{ startReply(id); closeMessageActions(); });
  if (canEdit){
    sheet.querySelector('[data-do="edit"]').addEventListener('click', ()=>{ startEdit(id); closeMessageActions(); });
    sheet.querySelector('[data-do="delete"]').addEventListener('click', ()=>{ deleteMessage(id); closeMessageActions(); });
  }
  sheet.querySelector('[data-do="cancel"]').addEventListener('click', closeMessageActions);
}
function closeMessageActions(){
  const sheet = document.getElementById('msg-action-sheet');
  const backdrop = document.getElementById('msg-action-backdrop');
  if (sheet) sheet.remove();
  if (backdrop) backdrop.remove();
}

// ---------- Unread badges ----------
function isChatVisible(){
  const chatCol = document.getElementById('chat-col');
  return !!(chatCol && chatCol.classList.contains('open')) && !document.hidden;
}
function bumpUnread(){ unreadCount++; renderUnreadBadges(); }
function clearUnread(){
  if (unreadCount === 0) return;
  unreadCount = 0;
  renderUnreadBadges();
}
function renderUnreadBadges(){
  document.querySelectorAll('.unread-badge').forEach(el=>{
    if (unreadCount > 0){ el.textContent = unreadCount > 9 ? '9+' : String(unreadCount); el.style.display='flex'; }
    else { el.style.display='none'; }
  });
}
(function initUnreadBadges(){
  const navChatBtn = document.querySelector('.nav-btn[data-mode="chat"]');
  if (navChatBtn) navChatBtn.insertAdjacentHTML('beforeend', '<span class="unread-badge" style="display:none;"></span>');
  const toggleWrap = document.getElementById('chat-toggle-wrap');
  if (toggleWrap) toggleWrap.insertAdjacentHTML('beforeend', '<span class="unread-badge" style="display:none;"></span>');
})();
document.querySelectorAll('.nav-btn[data-mode="chat"]').forEach(b=> b.addEventListener('click', clearUnread));
const chatToggleBtnForUnread = document.getElementById('btn-chat-toggle');
if (chatToggleBtnForUnread) chatToggleBtnForUnread.addEventListener('click', ()=>{
  setTimeout(()=>{ if (isChatVisible()) clearUnread(); }, 0);
});
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden && isChatVisible()) clearUnread(); });

// ---------- Input wiring (send button, Enter key, typing broadcast) ----------
document.getElementById('btn-send').addEventListener('click', sendChatFromInput);
document.getElementById('input-chat').addEventListener('keydown', e=>{ if (e.key==='Enter') sendChatFromInput(); });

let myTypingActive = false;
let myTypingTimeout = null;
document.getElementById('input-chat').addEventListener('input', ()=>{
  if (!myTypingActive){
    myTypingActive = true;
    broadcast({ type:'typing', name: myName, state:'start' });
  }
  clearTimeout(myTypingTimeout);
  myTypingTimeout = setTimeout(()=>{
    myTypingActive = false;
    broadcast({ type:'typing', name: myName, state:'stop' });
  }, 2000);
});
