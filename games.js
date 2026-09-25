/* ============================================================
   GAMES.JS
   Trivia Night, Would You Rather, This or That, Wrong Answers
   Only, and a 1-on-1 Tic-Tac-Toe duel are fully playable. The
   rest of the catalog below is organized into categories per
   the product's roadmap, shown as "coming soon" until built.
   ============================================================ */

const MOVIE_SUGGESTIONS = [
  "The Grand Budapest Hotel", "Spirited Away", "Inception", "Knives Out",
  "The Princess Bride", "Everything Everywhere All at Once", "Coco",
  "Whiplash", "La La Land", "Parasite", "The Nice Guys", "Paddington 2"
];
function suggestMovie(){ return MOVIE_SUGGESTIONS[Math.floor(Math.random()*MOVIE_SUGGESTIONS.length)]; }

function shuffledOrder(len){ const arr=[...Array(len).keys()]; for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

// ---------- Category catalog ----------
// status 'ready' -> panelId points at a real game-panel in index.html
// status 'soon'  -> shows a locked card, taps produce a toast
const GAME_CATALOG = [
  {key:'romance', emoji:'❤️', name:'Romance', games:[
    {name:'Couples Quiz', status:'soon'}, {name:'Love Questions', status:'soon'}, {name:'Truth or Dare: Couples', status:'ready', panelId:'tod'}]},
  {key:'chill', emoji:'😌', name:'Chill', games:[
    {name:'Would You Rather', status:'ready', panelId:'wyr'}, {name:'Two Truths & a Lie', status:'ready', panelId:'ttl'}, {name:'20 Questions', status:'soon'}]},
  {key:'funny', emoji:'😂', name:'Funny & Jokes', games:[
    {name:'Wrong Answers Only', status:'ready', panelId:'woa'}, {name:'Finish the Sentence', status:'soon'}, {name:'Most Likely To', status:'ready', panelId:'mlt'}]},
  {key:'puzzles', emoji:'🧩', name:'Puzzles', games:[
    {name:'Riddles', status:'soon'}, {name:'Word Scramble', status:'soon'}, {name:'Memory Match', status:'soon'}]},
  {key:'mindgames', emoji:'🧠', name:'Mind Games', games:[
    {name:'Imposter', status:'ready', panelId:'imposter'}, {name:'Mafia', status:'ready', panelId:'mafia'}, {name:'Detective', status:'ready', panelId:'detective'}]},
  {key:'reaction', emoji:'⚡', name:'Reaction & Speed', games:[
    {name:'Reaction Battle', status:'soon'}, {name:'Quick Draw', status:'soon'}, {name:'Fastest Typist', status:'soon'}]},
  {key:'competitive', emoji:'🏆', name:'Competitive', games:[
    {name:'Tic-Tac-Toe', status:'ready', panelId:'ttt'}, {name:'Connect 4', status:'ready', panelId:'connect4'}, {name:'Battleship', status:'soon'}]},
  {key:'creative', emoji:'🎨', name:'Creative', games:[
    {name:'Draw & Guess', status:'soon'}, {name:'Build Battle', status:'soon'}, {name:'Story Builder', status:'soon'}]},
  {key:'word', emoji:'🔤', name:'Word Games', games:[
    {name:'Word Bomb', status:'soon'}, {name:'Word Chain', status:'soon'}, {name:'Hangman', status:'soon'}]},
  {key:'trivia', emoji:'🤓', name:'Trivia & Knowledge', games:[
    {name:'General Trivia', status:'ready', panelId:'trivia'}, {name:'Science Quiz', status:'soon'}, {name:'Anime Quiz', status:'soon'}]},
  {key:'cards', emoji:'🃏', name:'Cards & Board', games:[
    {name:'UNO-style', status:'soon'}, {name:'Ludo', status:'soon'}, {name:'Checkers', status:'soon'}]},
  {key:'action', emoji:'⚔️', name:'Action & Battle', games:[
    {name:'Arena Battle', status:'soon'}, {name:'Robot Battle', status:'soon'}, {name:'Space Battle', status:'soon'}]},
  {key:'mystery', emoji:'👻', name:'Mystery & Horror', games:[
    {name:'Murder Mystery', status:'soon'}, {name:'Escape Room', status:'soon'}, {name:'Haunted House', status:'soon'}]},
  {key:'adventure', emoji:'🗺️', name:'Adventure', games:[
    {name:'Treasure Hunt', status:'soon'}, {name:'Dungeon Crawler', status:'soon'}, {name:'Island Survival', status:'soon'}]},
  {key:'party', emoji:'🎉', name:'Party', games:[
    {name:'Charades', status:'soon'}, {name:'Guess the Song', status:'soon'}, {name:'Guess the Movie', status:'soon'}]},
  {key:'social', emoji:'👫', name:'Social', games:[
    {name:'Who Knows Me Best?', status:'soon'}, {name:'Deep Questions', status:'soon'}, {name:'This or That', status:'ready', panelId:'tot'}]},
  {key:'challenge', emoji:'💀', name:'Challenge', games:[
    {name: 'Draft', status:'ready', panelId:'draft'}, {name:'30-Second Challenge', status:'soon'}, {name:'Last Player Standing', status:'soon'}, {name:'Survival Challenge', status:'soon'}]},
  {key:'music', emoji:'🎵', name:'Music', games:[
    {name:'Guess the Song', status:'ready', guessCategory:'song'}, {name:'Finish the Lyrics', status:'soon'}, {name:'Music Trivia', status:'soon'}]},
  {key:'movies', emoji:'🎬', name:'Movies & Anime', games:[
    {name:'Guess the Movie', status:'ready', guessCategory:'movie'}, {name:'Anime Quiz', status:'soon'}, {name:'Guess the Character', status:'ready', guessCategory:'character'}]}
];

function readyCount(cat){ return cat.games.filter(g=>g.status==='ready').length; }

function renderCategoryGrid(){
  const grid = document.getElementById('category-grid');
  grid.innerHTML = GAME_CATALOG.map(cat=>`
    <div class="category-card" data-cat="${cat.key}">
      ${readyCount(cat)>0 ? `<span class="ready-badge">${readyCount(cat)} ready</span>` : ''}
      <div class="emoji">${cat.emoji}</div>
      <h4>${escapeHtml(cat.name)}</h4>
    </div>
  `).join('');
  grid.querySelectorAll('.category-card').forEach(card=>{
    card.addEventListener('click', ()=> openCategory(card.dataset.cat));
  });
}
function openCategory(key){
  const cat = GAME_CATALOG.find(c=>c.key===key);
  document.getElementById('games-picker').style.display='none';
  document.getElementById('category-detail').style.display='block';
  document.getElementById('category-detail-title').textContent = `${cat.emoji} ${cat.name}`;
  const grid = document.getElementById('category-game-grid');
  grid.innerHTML = cat.games.map(g=>`
    <div class="game-card ${g.status==='soon'?'locked':''}" data-panel="${g.panelId||''}" data-guess-category="${g.guessCategory||''}" data-name="${escapeHtml(g.name)}">
      ${g.status==='soon' ? '<span class="lock-badge">🔒</span>' : ''}
      <div class="emoji">${g.status==='ready'?'▶️':'🎮'}</div>
      <h3>${escapeHtml(g.name)}</h3>
      <p>${g.status==='ready' ? 'Ready to play' : 'Coming in a future update'}</p>
    </div>
  `).join('');
  grid.querySelectorAll('.game-card').forEach(card=>{
    card.addEventListener('click', ()=>{
      if (card.classList.contains('locked')){ toast(`${card.dataset.name} is coming in a future update 🚧`); return; }
      if (card.dataset.guessCategory) openGuessGame(card.dataset.guessCategory);
      else openGame(card.dataset.panel);
    });
  });
}
document.getElementById('btn-back-categories').addEventListener('click', ()=>{
  document.getElementById('category-detail').style.display='none';
  document.getElementById('games-picker').style.display='block';
});
renderCategoryGrid();

// Script tags load at the end of <body>, so the DOM is already parsed —
// wire listeners directly rather than waiting on DOMContentLoaded (which
// would already have fired by the time this file runs).
document.querySelectorAll('[data-back-game]').forEach(b=> b.addEventListener('click', closeGame));
document.getElementById('btn-trivia-start').addEventListener('click', ()=> triviaNext(true));
document.getElementById('btn-wyr-start').addEventListener('click', ()=> wyrNext(true));
document.getElementById('btn-tot-start').addEventListener('click', ()=> totNext(true));
document.getElementById('btn-woa-start').addEventListener('click', ()=> woaNext(true));
function gameNameForPanel(id){
  for (const cat of GAME_CATALOG){
    const g = cat.games.find(g=> g.panelId === id);
    if (g) return g.name;
  }
  return id;
}
function openGame(id){
  document.getElementById('category-detail').style.display='none';
  document.getElementById('game-'+id).style.display='block';
  if (typeof logActivity === 'function') logActivity('game', id, gameNameForPanel(id));
}
function closeGame(){
  document.getElementById('category-detail').style.display='block';
  ['trivia','wyr','ttt','tot','woa','ttl','tod','mlt','draft','connect4','guess','imposter','mafia','detective'].forEach(g=> document.getElementById('game-'+g).style.display='none');
}

/* ---------------- Trivia ---------------- */
const TRIVIA_BANK = [
  {q:"Which planet has the most moons?", choices:["Earth","Saturn","Mars","Mercury"], correct:1},
  {q:"What's the fastest land animal?", choices:["Lion","Cheetah","Horse","Ostrich"], correct:1},
  {q:"How many strings does a standard guitar have?", choices:["4","5","6","7"], correct:2},
  {q:"Which country invented pizza (modern form)?", choices:["France","Greece","Italy","Spain"], correct:2},
  {q:"What's the largest ocean on Earth?", choices:["Atlantic","Indian","Arctic","Pacific"], correct:3},
  {q:"Which gas do plants absorb from the air?", choices:["Oxygen","Carbon dioxide","Nitrogen","Helium"], correct:1},
  {q:"How many hearts does an octopus have?", choices:["1","2","3","9"], correct:2},
  {q:"What year did the first iPhone release?", choices:["2005","2007","2009","2011"], correct:1},
  {q:"Which element has the chemical symbol 'Au'?", choices:["Silver","Aluminum","Gold","Argon"], correct:2},
  {q:"What's the tallest mountain on Earth?", choices:["K2","Kilimanjaro","Everest","Denali"], correct:2},
  {q:"How many hours are in a week?", choices:["148","156","168","172"], correct:2},
  {q:"Which country gifted the Statue of Liberty to the US?", choices:["UK","France","Spain","Italy"], correct:1}
];
let triviaOrder = [];
let triviaState = { qIndex:-1, answers:{}, scores:{}, revealed:true, timerHandle:null };

let triviaRoundCounter = 0;
let askedTriviaQuestions = [];

async function fetchAiTriviaQuestion(){
  try{
    const json = await callAiFunction({ mode:'trivia', askedQuestions: askedTriviaQuestions.slice(-15), callerId: myId });
    const t = json.trivia;
    if (t && typeof t.question === 'string' && Array.isArray(t.choices) && t.choices.length === 4 && typeof t.correctIndex === 'number'){
      return { q: t.question, choices: t.choices, correct: t.correctIndex };
    }
    throw new Error('AI returned an unexpected question format');
  }catch(e){
    console.warn('AI trivia unavailable after retry:', e.message);
    toast(`🤖 AI trivia unavailable (${e.message}) — using an offline question`, 'err');
    return null;
  }
}

async function triviaNext(broadcastIt){
  if (broadcastIt){
    const body = document.getElementById('trivia-body');
    if (body) body.innerHTML = '<p class="hint">🤖 Cooking up a question…</p>';
  }
  let q = await fetchAiTriviaQuestion();
  if (!q){
    if (triviaOrder.length===0) triviaOrder = shuffledOrder(TRIVIA_BANK.length);
    const idx = triviaOrder.shift();
    q = TRIVIA_BANK[idx];
    if (broadcastIt) toast('AI trivia is briefly unavailable — using an offline question', 'err');
  }
  askedTriviaQuestions.push(q.q);
  const roundId = 'r' + (triviaRoundCounter++) + '-' + Date.now();
  startTriviaQuestion(roundId, q, broadcastIt);
}
function startTriviaQuestion(roundId, bankQ, broadcastIt){
  clearTimeout(triviaState.timerHandle);
  triviaState = { qIndex: roundId, answers:{}, scores: triviaState.scores||{}, revealed:false, timerHandle:null, _correct: bankQ.correct };
  renderTriviaQuestion(bankQ);
  triviaState.timerHandle = setTimeout(revealTrivia, 10000);
  if (broadcastIt) broadcast({type:'trivia', action:'question', idx:roundId, q:bankQ.q, choices:bankQ.choices, correct:bankQ.correct});
}
function renderTriviaQuestion(bankQ){
  const body = document.getElementById('trivia-body');
  body.innerHTML = `
    <p class="quiz-question">${escapeHtml(bankQ.q)}</p>
    <div class="quiz-choices">${bankQ.choices.map((c,i)=>`<button class="choice-btn" data-i="${i}"><span>${escapeHtml(c)}</span></button>`).join('')}</div>
    <p class="hint" style="margin-top:10px;" id="trivia-wait">10 seconds to answer…</p>
    <div class="scoreboard" id="trivia-scoreboard"></div>
  `;
  body.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (triviaState.revealed || triviaState.answers[myId]!==undefined) return;
      const i = parseInt(btn.dataset.i,10);
      triviaState.answers[myId] = i;
      btn.classList.add('selected');
      document.getElementById('trivia-wait').textContent = 'Answer locked in — waiting for reveal…';
      broadcast({type:'trivia', action:'answer', idx:triviaState.qIndex, peerId:myId, choice:i});
    });
  });
  renderTriviaScoreboard();
}
registerHandler('trivia', (fromId, data)=>{
  if (data.action==='question'){
    clearTimeout(triviaState.timerHandle);
    triviaState = { qIndex:data.idx, answers:{}, scores: triviaState.scores||{}, revealed:false, timerHandle:null, _correct:data.correct };
    renderTriviaQuestion({q:data.q, choices:data.choices, correct:data.correct});
    triviaState.timerHandle = setTimeout(revealTrivia, 10000);
  } else if (data.action==='answer'){
    if (data.idx===triviaState.qIndex && triviaState.answers[data.peerId]===undefined){
      triviaState.answers[data.peerId] = data.choice;
    }
  }
});
function revealTrivia(){
  if (triviaState.revealed) return;
  triviaState.revealed = true;
  const correct = triviaState._correct;
  document.querySelectorAll('#trivia-body .choice-btn').forEach(btn=>{
    const i = parseInt(btn.dataset.i,10);
    if (i===correct) btn.classList.add('correct');
    else if (triviaState.answers[myId]===i) btn.classList.add('wrong');
  });
  const waitEl = document.getElementById('trivia-wait');
  if (waitEl) waitEl.textContent = 'Revealed!';
  Object.entries(triviaState.answers).forEach(([pid,choice])=>{
    if (choice===correct) triviaState.scores[pid] = (triviaState.scores[pid]||0)+1;
  });
  renderTriviaScoreboard();
  const body = document.getElementById('trivia-body');
  if (!document.getElementById('btn-trivia-next')){
    const div = document.createElement('div'); div.className='quiz-actions';
    div.innerHTML = `<button class="btn btn-primary" id="btn-trivia-next">Next question</button>`;
    body.appendChild(div);
    document.getElementById('btn-trivia-next').addEventListener('click', ()=>triviaNext(true));
  }
}
function renderTriviaScoreboard(){
  const el = document.getElementById('trivia-scoreboard'); if (!el) return;
  const rows = Object.entries(triviaState.scores||{}).sort((a,b)=>b[1]-a[1]);
  el.innerHTML = rows.map(([pid,score])=>{
    const name = pid===myId ? 'You' : (participants[pid]?.name || '…');
    return `<div class="score-row"><span>${escapeHtml(name)}</span><b>${score}</b></div>`;
  }).join('');
}

/* ---------------- Would You Rather ---------------- */
const WYR_BANK = [
  {a:"Always have to sing instead of speak", b:"Always have to dance instead of walk"},
  {a:"Never watch another movie", b:"Never listen to music again"},
  {a:"Have unlimited pizza for life", b:"Have unlimited tacos for life"},
  {a:"Be able to fly", b:"Be able to turn invisible"},
  {a:"Live without your phone", b:"Live without hot showers"},
  {a:"Always be 10 minutes late", b:"Always be an hour early"},
  {a:"Explore space", b:"Explore the ocean"},
  {a:"Have a rewind button on life", b:"Have a pause button on life"},
  {a:"Only text in emojis forever", b:"Only talk in movie quotes forever"},
  {a:"Win the lottery but lose your closest friend", b:"Stay broke but keep every friend you have"}
];
let wyrOrder = [];
let wyrState = { qIndex:-1, votes:{} };
function wyrNext(broadcastIt){
  if (wyrOrder.length===0) wyrOrder = shuffledOrder(WYR_BANK.length);
  const idx = wyrOrder.shift();
  startWyrQuestion(idx, WYR_BANK[idx], broadcastIt);
}
function startWyrQuestion(idx, q, broadcastIt){
  wyrState = { qIndex: idx, votes:{} };
  renderWyr(q);
  if (broadcastIt) broadcast({type:'wyr', action:'question', idx, a:q.a, b:q.b});
}
function renderWyr(q){
  const body = document.getElementById('wyr-body');
  body.innerHTML = `
    <p class="quiz-question">Would you rather…</p>
    <div class="quiz-choices">
      <button class="choice-btn" data-c="A"><div class="choice-fill" id="wyr-fill-a" style="width:0%"></div><span>${escapeHtml(q.a)}</span></button>
      <button class="choice-btn" data-c="B"><div class="choice-fill" id="wyr-fill-b" style="width:0%"></div><span>${escapeHtml(q.b)}</span></button>
    </div>
    <p class="hint" id="wyr-tally" style="margin-top:10px;">0 votes so far</p>
    <div class="quiz-actions"><button class="btn btn-violet" id="btn-wyr-next">Next question</button></div>
  `;
  body.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      wyrState.votes[myId] = btn.dataset.c;
      renderWyrTally();
      btn.parentElement.querySelectorAll('.choice-btn').forEach(b=>b.classList.toggle('selected', b===btn));
      broadcast({type:'wyr', action:'vote', idx:wyrState.qIndex, peerId:myId, choice:btn.dataset.c});
    });
  });
  document.getElementById('btn-wyr-next').addEventListener('click', ()=>wyrNext(true));
  renderWyrTally();
}
registerHandler('wyr', (fromId, data)=>{
  if (data.action==='question'){
    wyrState = { qIndex:data.idx, votes:{} };
    renderWyr({a:data.a, b:data.b});
  } else if (data.action==='vote'){
    if (data.idx===wyrState.qIndex){ wyrState.votes[data.peerId]=data.choice; renderWyrTally(); }
  }
});
function renderWyrTally(){
  const total = Object.keys(wyrState.votes).length;
  const aCount = Object.values(wyrState.votes).filter(v=>v==='A').length;
  const bCount = total-aCount;
  const fillA = document.getElementById('wyr-fill-a');
  const fillB = document.getElementById('wyr-fill-b');
  if (fillA) fillA.style.width = (total? Math.round(aCount/total*100):0) + '%';
  if (fillB) fillB.style.width = (total? Math.round(bCount/total*100):0) + '%';
  const tally = document.getElementById('wyr-tally');
  if (tally) tally.textContent = `${total} vote${total===1?'':'s'} so far · ${aCount} vs ${bCount}`;
}

/* ---------------- Tic Tac Toe ---------------- */
let tttState = { opponentId:null, opponentName:'', mySymbol:null, board:Array(9).fill(null), myTurn:false, active:false, pendingInvite:null, waitingFor:null };
const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function renderTttOpponents(){
  const list = document.getElementById('ttt-opponent-list');
  if (!list || tttState.active) return;
  const others = Object.keys(participants).filter(id=>id!==myId);
  if (others.length===0){ list.innerHTML = `<p class="hint">No one else is here yet — invite a friend into the room first.</p>`; return; }
  list.innerHTML = others.map(id=>`
    <div class="opp-row"><span>${escapeHtml(participants[id].name)}</span><button class="btn btn-ghost btn-sm" data-challenge="${id}">Challenge</button></div>
  `).join('');
  list.querySelectorAll('[data-challenge]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const to = btn.dataset.challenge;
      tttState.waitingFor = to;
      sendData(dataConns[to], {type:'ttt', action:'invite', to, from:myId, name:myName});
      renderTtt();
    });
  });
}
window.onOrbitRender = (function(prev){ return function(){ if(prev) prev(); renderTttOpponents(); }; })(window.onOrbitRender);

registerHandler('ttt', (fromId, data)=>{
  if (data.to !== myId) return;
  if (data.action==='invite'){
    tttState.pendingInvite = {from:data.from, name:data.name};
    renderTtt();
  } else if (data.action==='accept'){
    tttState = { opponentId:data.from, opponentName:participants[data.from]?.name||'Opponent', mySymbol:'X', board:Array(9).fill(null), myTurn:true, active:true, pendingInvite:null, waitingFor:null };
    renderTtt();
  } else if (data.action==='decline'){
    addSystemMessage(`${participants[data.from]?.name||'They'} declined your Tic-Tac-Toe challenge`);
    tttState.waitingFor = null;
    renderTtt();
  } else if (data.action==='move'){
    if (data.from !== tttState.opponentId) return;
    tttState.board[data.cell] = data.symbol;
    tttState.myTurn = true;
    renderTtt();
  } else if (data.action==='reset'){
    if (data.from !== tttState.opponentId) return;
    tttState.board = Array(9).fill(null);
    tttState.myTurn = (tttState.mySymbol==='X');
    renderTtt();
  }
});
window.onPeerRemoved = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (tttState.opponentId===peerId){ tttState.active=false; renderTtt(); }
  };
})(window.onPeerRemoved);

function tttAccept(){
  const inv = tttState.pendingInvite;
  tttState = { opponentId:inv.from, opponentName:inv.name, mySymbol:'O', board:Array(9).fill(null), myTurn:false, active:true, pendingInvite:null, waitingFor:null };
  sendData(dataConns[inv.from], {type:'ttt', action:'accept', to:inv.from, from:myId});
  renderTtt();
}
function tttDecline(){
  const inv = tttState.pendingInvite;
  sendData(dataConns[inv.from], {type:'ttt', action:'decline', to:inv.from, from:myId});
  tttState.pendingInvite = null;
  renderTtt();
}
function tttCheckResult(){
  const b = tttState.board;
  for (const [a,c,d] of TTT_LINES){ if (b[a] && b[a]===b[c] && b[a]===b[d]) return b[a]; }
  if (b.every(x=>x)) return 'draw';
  return null;
}
function tttMove(i){
  if (!tttState.active || !tttState.myTurn || tttState.board[i]) return;
  tttState.board[i] = tttState.mySymbol;
  tttState.myTurn = false;
  sendData(dataConns[tttState.opponentId], {type:'ttt', action:'move', to:tttState.opponentId, from:myId, cell:i, symbol:tttState.mySymbol});
  renderTtt();
}
function tttReset(){
  tttState.board = Array(9).fill(null);
  tttState.myTurn = (tttState.mySymbol==='X');
  sendData(dataConns[tttState.opponentId], {type:'ttt', action:'reset', to:tttState.opponentId, from:myId});
  renderTtt();
}
function renderTtt(){
  const body = document.getElementById('ttt-body');
  if (!body) return;
  if (tttState.pendingInvite && !tttState.active){
    body.innerHTML = `<div class="invite-banner"><span>🎮 <b>${escapeHtml(tttState.pendingInvite.name)}</b> challenged you to Tic-Tac-Toe</span>
      <span style="display:flex; gap:8px;"><button class="btn btn-secondary btn-sm" id="ttt-accept">Accept</button><button class="btn btn-ghost btn-sm" id="ttt-decline">Decline</button></span></div>`;
    document.getElementById('ttt-accept').addEventListener('click', tttAccept);
    document.getElementById('ttt-decline').addEventListener('click', tttDecline);
    return;
  }
  if (tttState.waitingFor && !tttState.active){
    body.innerHTML = `<p class="hint">Waiting for ${escapeHtml(participants[tttState.waitingFor]?.name||'them')} to accept…</p>`;
    return;
  }
  if (!tttState.active){
    body.innerHTML = `<p class="hint">Pick someone in the room to challenge.</p><div class="ttt-opponents" id="ttt-opponent-list"></div>`;
    renderTttOpponents();
    return;
  }
  const result = tttCheckResult();
  let status;
  if (result==='draw') status = "🤝 It's a draw!";
  else if (result) status = (result===tttState.mySymbol) ? "🎉 You won!" : `${escapeHtml(tttState.opponentName)} won this round`;
  else status = tttState.myTurn ? "Your move" : `Waiting on ${escapeHtml(tttState.opponentName)}…`;

  body.innerHTML = `
    <div class="ttt-status">You are <b style="color:${tttState.mySymbol==='X'?'var(--coral)':'var(--teal)'}">${tttState.mySymbol}</b> · vs ${escapeHtml(tttState.opponentName)} · ${status}</div>
    <div class="ttt-board" id="ttt-board"></div>
    <div class="quiz-actions">
      ${result ? '<button class="btn btn-primary btn-sm" id="ttt-again">Play again</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="ttt-leave">Leave game</button>
    </div>
  `;
  const boardEl = document.getElementById('ttt-board');
  tttState.board.forEach((val,i)=>{
    const cell = document.createElement('button');
    cell.className = 'ttt-cell' + (val==='X'?' x':'') + (val==='O'?' o':'');
    cell.textContent = val||'';
    cell.disabled = !!result || !!val || !tttState.myTurn;
    cell.addEventListener('click', ()=>tttMove(i));
    boardEl.appendChild(cell);
  });
  if (result) document.getElementById('ttt-again').addEventListener('click', tttReset);
  document.getElementById('ttt-leave').addEventListener('click', ()=>{
    tttState = { opponentId:null, opponentName:'', mySymbol:null, board:Array(9).fill(null), myTurn:false, active:false, pendingInvite:null, waitingFor:null };
    renderTtt();
  });
}

/* ---------------- Connect Four (Competitive) ---------------- */
const C4_ROWS = 6, C4_COLS = 7;
function buildConnect4Lines(){
  const lines = []; const idx = (r,c)=> r*C4_COLS+c;
  for (let r=0;r<C4_ROWS;r++) for (let c=0;c<=C4_COLS-4;c++) lines.push([idx(r,c),idx(r,c+1),idx(r,c+2),idx(r,c+3)]);           // horizontal
  for (let c=0;c<C4_COLS;c++) for (let r=0;r<=C4_ROWS-4;r++) lines.push([idx(r,c),idx(r+1,c),idx(r+2,c),idx(r+3,c)]);           // vertical
  for (let r=0;r<=C4_ROWS-4;r++) for (let c=0;c<=C4_COLS-4;c++) lines.push([idx(r,c),idx(r+1,c+1),idx(r+2,c+2),idx(r+3,c+3)]);  // diagonal ↘
  for (let r=3;r<C4_ROWS;r++) for (let c=0;c<=C4_COLS-4;c++) lines.push([idx(r,c),idx(r-1,c+1),idx(r-2,c+2),idx(r-3,c+3)]);     // diagonal ↗
  return lines;
}
const C4_LINES = buildConnect4Lines();
let c4State = { opponentId:null, opponentName:'', mySymbol:null, board:Array(C4_ROWS*C4_COLS).fill(null), myTurn:false, active:false, pendingInvite:null, waitingFor:null };

function renderC4Opponents(){
  const list = document.getElementById('connect4-opponent-list');
  if (!list || c4State.active) return;
  const others = Object.keys(participants).filter(id=>id!==myId);
  if (others.length===0){ list.innerHTML = `<p class="hint">No one else is here yet — invite a friend into the room first.</p>`; return; }
  list.innerHTML = others.map(id=>`
    <div class="opp-row"><span>${escapeHtml(participants[id].name)}</span><button class="btn btn-ghost btn-sm" data-c4-challenge="${id}">Challenge</button></div>
  `).join('');
  list.querySelectorAll('[data-c4-challenge]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const to = btn.dataset.c4Challenge;
      c4State.waitingFor = to;
      sendData(dataConns[to], {type:'connect4', action:'invite', to, from:myId, name:myName});
      renderC4();
    });
  });
}
window.onOrbitRender = (function(prev){ return function(){ if(prev) prev(); renderC4Opponents(); }; })(window.onOrbitRender);

registerHandler('connect4', (fromId, data)=>{
  if (data.to !== myId) return;
  if (data.action==='invite'){
    c4State.pendingInvite = {from:data.from, name:data.name};
    renderC4();
  } else if (data.action==='accept'){
    c4State = { opponentId:data.from, opponentName:participants[data.from]?.name||'Opponent', mySymbol:'R', board:Array(C4_ROWS*C4_COLS).fill(null), myTurn:true, active:true, pendingInvite:null, waitingFor:null };
    renderC4();
  } else if (data.action==='decline'){
    addSystemMessage(`${participants[data.from]?.name||'They'} declined your Connect 4 challenge`);
    c4State.waitingFor = null;
    renderC4();
  } else if (data.action==='move'){
    if (data.from !== c4State.opponentId) return;
    c4State.board[data.cell] = data.symbol;
    c4State.myTurn = true;
    renderC4();
  } else if (data.action==='reset'){
    if (data.from !== c4State.opponentId) return;
    c4State.board = Array(C4_ROWS*C4_COLS).fill(null);
    c4State.myTurn = (c4State.mySymbol==='R');
    renderC4();
  }
});
window.onPeerRemoved = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (c4State.opponentId===peerId){ c4State.active=false; renderC4(); }
  };
})(window.onPeerRemoved);

function c4Accept(){
  const inv = c4State.pendingInvite;
  c4State = { opponentId:inv.from, opponentName:inv.name, mySymbol:'Y', board:Array(C4_ROWS*C4_COLS).fill(null), myTurn:false, active:true, pendingInvite:null, waitingFor:null };
  sendData(dataConns[inv.from], {type:'connect4', action:'accept', to:inv.from, from:myId});
  renderC4();
}
function c4Decline(){
  const inv = c4State.pendingInvite;
  sendData(dataConns[inv.from], {type:'connect4', action:'decline', to:inv.from, from:myId});
  c4State.pendingInvite = null;
  renderC4();
}
function c4CheckResult(){
  const b = c4State.board;
  for (const [a,c,d,e] of C4_LINES){ if (b[a] && b[a]===b[c] && b[a]===b[d] && b[a]===b[e]) return b[a]; }
  if (b.every(x=>x)) return 'draw';
  return null;
}
function c4Drop(col){
  if (!c4State.active || !c4State.myTurn) return;
  let row = -1;
  for (let r=C4_ROWS-1;r>=0;r--){ if (!c4State.board[r*C4_COLS+col]){ row = r; break; } }
  if (row === -1) return; // column full
  const cell = row*C4_COLS+col;
  c4State.board[cell] = c4State.mySymbol;
  c4State.myTurn = false;
  sendData(dataConns[c4State.opponentId], {type:'connect4', action:'move', to:c4State.opponentId, from:myId, cell, symbol:c4State.mySymbol});
  renderC4();
}
function c4Reset(){
  c4State.board = Array(C4_ROWS*C4_COLS).fill(null);
  c4State.myTurn = (c4State.mySymbol==='R');
  sendData(dataConns[c4State.opponentId], {type:'connect4', action:'reset', to:c4State.opponentId, from:myId});
  renderC4();
}
function renderC4(){
  const body = document.getElementById('connect4-body');
  if (!body) return;
  if (c4State.pendingInvite && !c4State.active){
    body.innerHTML = `<div class="invite-banner"><span>🎮 <b>${escapeHtml(c4State.pendingInvite.name)}</b> challenged you to Connect 4</span>
      <span style="display:flex; gap:8px;"><button class="btn btn-secondary btn-sm" id="c4-accept">Accept</button><button class="btn btn-ghost btn-sm" id="c4-decline">Decline</button></span></div>`;
    document.getElementById('c4-accept').addEventListener('click', c4Accept);
    document.getElementById('c4-decline').addEventListener('click', c4Decline);
    return;
  }
  if (c4State.waitingFor && !c4State.active){
    body.innerHTML = `<p class="hint">Waiting for ${escapeHtml(participants[c4State.waitingFor]?.name||'them')} to accept…</p>`;
    return;
  }
  if (!c4State.active){
    body.innerHTML = `<p class="hint">Pick someone in the room to challenge.</p><div class="ttt-opponents" id="connect4-opponent-list"></div>`;
    renderC4Opponents();
    return;
  }
  const result = c4CheckResult();
  let status;
  if (result==='draw') status = "🤝 It's a draw!";
  else if (result) status = (result===c4State.mySymbol) ? "🎉 You won!" : `${escapeHtml(c4State.opponentName)} won this round`;
  else status = c4State.myTurn ? "Your move — tap a column" : `Waiting on ${escapeHtml(c4State.opponentName)}…`;

  body.innerHTML = `
    <div class="ttt-status">You are <b style="color:${c4State.mySymbol==='R'?'var(--coral)':'var(--gold)'}">${c4State.mySymbol==='R'?'🔴 Red':'🟡 Yellow'}</b> · vs ${escapeHtml(c4State.opponentName)} · ${status}</div>
    <div class="c4-board" id="c4-board"></div>
    <div class="quiz-actions">
      ${result ? '<button class="btn btn-primary btn-sm" id="c4-again">Play again</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="c4-leave">Leave game</button>
    </div>
  `;
  const boardEl = document.getElementById('c4-board');
  const columnFull = Array.from({length:C4_COLS}, (_,c)=> !!c4State.board[c]); // top row cell per column
  for (let col=0; col<C4_COLS; col++){
    const colEl = document.createElement('button');
    colEl.className = 'c4-column';
    colEl.disabled = !!result || columnFull[col] || !c4State.myTurn;
    for (let row=0; row<C4_ROWS; row++){
      const val = c4State.board[row*C4_COLS+col];
      const slot = document.createElement('span');
      slot.className = 'c4-slot' + (val==='R'?' red':val==='Y'?' yellow':'');
      colEl.appendChild(slot);
    }
    colEl.addEventListener('click', ()=> c4Drop(col));
    boardEl.appendChild(colEl);
  }
  if (result) document.getElementById('c4-again').addEventListener('click', c4Reset);
  document.getElementById('c4-leave').addEventListener('click', ()=>{
    c4State = { opponentId:null, opponentName:'', mySymbol:null, board:Array(C4_ROWS*C4_COLS).fill(null), myTurn:false, active:false, pendingInvite:null, waitingFor:null };
    renderC4();
  });
}

/* ---------------- This or That (Social) ---------------- */
const TOT_BANK = [
  {a:"Beach vacation", b:"Mountain vacation"},
  {a:"Texting", b:"Calling"},
  {a:"Coffee", b:"Tea"},
  {a:"Early bird", b:"Night owl"},
  {a:"Books", b:"Movies"},
  {a:"Sweet", b:"Savory"},
  {a:"City life", b:"Countryside"},
  {a:"Cats", b:"Dogs"},
  {a:"Summer", b:"Winter"},
  {a:"Planned trips", b:"Spontaneous trips"}
];
let totOrder = [];
let totState = { qIndex:-1, votes:{} };
function totNext(broadcastIt){
  if (totOrder.length===0) totOrder = shuffledOrder(TOT_BANK.length);
  const idx = totOrder.shift();
  startTotQuestion(idx, TOT_BANK[idx], broadcastIt);
}
function startTotQuestion(idx, q, broadcastIt){
  totState = { qIndex: idx, votes:{} };
  renderTot(q);
  if (broadcastIt) broadcast({type:'tot', action:'question', idx, a:q.a, b:q.b});
}
function renderTot(q){
  const body = document.getElementById('tot-body');
  body.innerHTML = `
    <p class="quiz-question">This, or that?</p>
    <div class="quiz-choices">
      <button class="choice-btn" data-c="A"><div class="choice-fill" id="tot-fill-a" style="width:0%"></div><span>${escapeHtml(q.a)}</span></button>
      <button class="choice-btn" data-c="B"><div class="choice-fill" id="tot-fill-b" style="width:0%"></div><span>${escapeHtml(q.b)}</span></button>
    </div>
    <p class="hint" id="tot-tally" style="margin-top:10px;">0 votes so far</p>
    <div class="quiz-actions"><button class="btn btn-violet" id="btn-tot-next">Next question</button></div>
  `;
  body.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      totState.votes[myId] = btn.dataset.c;
      renderTotTally();
      btn.parentElement.querySelectorAll('.choice-btn').forEach(b=>b.classList.toggle('selected', b===btn));
      broadcast({type:'tot', action:'vote', idx:totState.qIndex, peerId:myId, choice:btn.dataset.c});
    });
  });
  document.getElementById('btn-tot-next').addEventListener('click', ()=>totNext(true));
  renderTotTally();
}
registerHandler('tot', (fromId, data)=>{
  if (data.action==='question'){
    totState = { qIndex:data.idx, votes:{} };
    renderTot({a:data.a, b:data.b});
  } else if (data.action==='vote'){
    if (data.idx===totState.qIndex){ totState.votes[data.peerId]=data.choice; renderTotTally(); }
  }
});
function renderTotTally(){
  const total = Object.keys(totState.votes).length;
  const aCount = Object.values(totState.votes).filter(v=>v==='A').length;
  const bCount = total-aCount;
  const fillA = document.getElementById('tot-fill-a');
  const fillB = document.getElementById('tot-fill-b');
  if (fillA) fillA.style.width = (total? Math.round(aCount/total*100):0) + '%';
  if (fillB) fillB.style.width = (total? Math.round(bCount/total*100):0) + '%';
  const tally = document.getElementById('tot-tally');
  if (tally) tally.textContent = `${total} vote${total===1?'':'s'} so far · ${aCount} vs ${bCount}`;
}

/* ---------------- Wrong Answers Only (Funny & Jokes) ---------------- */
const WOA_PROMPTS = [
  "Name a good excuse for missing a meeting.",
  "What's something you should never say on a first date?",
  "Describe your dream vacation in 3 words.",
  "What's a great name for a pet goldfish?",
  "What should you never bring to a job interview?",
  "Finish this: 'The secret to a happy life is ___.'",
  "What's a terrible superhero power to have?",
  "Name something that does NOT belong in a lunchbox."
];
let woaOrder = [];
let woaState = { qIndex:-1, prompt:'', submissions:{} };
function woaNext(broadcastIt){
  if (woaOrder.length===0) woaOrder = shuffledOrder(WOA_PROMPTS.length);
  const idx = woaOrder.shift();
  startWoaRound(idx, WOA_PROMPTS[idx], broadcastIt);
}
function startWoaRound(idx, prompt, broadcastIt){
  woaState = { qIndex: idx, prompt, submissions:{} };
  renderWoa();
  if (broadcastIt) broadcast({type:'woa', action:'prompt', idx, text:prompt});
}
function renderWoa(){
  const body = document.getElementById('woa-body');
  const mySubmission = woaState.submissions[myId];
  body.innerHTML = `
    <p class="quiz-question">${escapeHtml(woaState.prompt)}</p>
    <p class="hint" style="margin-bottom:10px;">Answer on purpose <b>wrong</b> — funniest answer wins the laugh.</p>
    <div class="load-row">
      <input type="text" id="woa-input" placeholder="Type your wrong answer…" maxlength="120" ${mySubmission?'disabled':''} value="${mySubmission?escapeHtml(mySubmission):''}">
      <button class="btn btn-primary btn-sm" id="btn-woa-submit" ${mySubmission?'disabled':''}>Submit</button>
    </div>
    <div class="scoreboard" id="woa-submissions"></div>
    <div class="quiz-actions"><button class="btn btn-primary" id="btn-woa-next">Next round</button></div>
  `;
  const submitFn = ()=>{
    const val = document.getElementById('woa-input').value.trim();
    if (!val || woaState.submissions[myId]) return;
    woaState.submissions[myId] = val;
    renderWoa();
    broadcast({type:'woa', action:'submit', idx:woaState.qIndex, peerId:myId, text:val});
  };
  document.getElementById('btn-woa-submit').addEventListener('click', submitFn);
  document.getElementById('woa-input').addEventListener('keydown', e=>{ if(e.key==='Enter') submitFn(); });
  document.getElementById('btn-woa-next').addEventListener('click', ()=>woaNext(true));
  renderWoaSubmissions();
}
registerHandler('woa', (fromId, data)=>{
  if (data.action==='prompt'){
    woaState = { qIndex:data.idx, prompt:data.text, submissions:{} };
    renderWoa();
  } else if (data.action==='submit'){
    if (data.idx===woaState.qIndex){ woaState.submissions[data.peerId]=data.text; renderWoaSubmissions(); }
  }
});
function renderWoaSubmissions(){
  const el = document.getElementById('woa-submissions'); if (!el) return;
  el.innerHTML = Object.entries(woaState.submissions).map(([pid,text])=>{
    const name = pid===myId ? 'You' : (participants[pid]?.name || '…');
    return `<div class="score-row"><span>${escapeHtml(name)}</span><b>${escapeHtml(text)}</b></div>`;
  }).join('');
}

document.getElementById('btn-ttl-turn').addEventListener('click', ttlStartTurn);
document.getElementById('btn-tod-spin').addEventListener('click', ()=> todSpin(true));
document.getElementById('btn-mlt-start').addEventListener('click', ()=> mltNext(true));
document.getElementById('btn-draft-start').addEventListener('click', draftStart);
document.getElementById('btn-imposter-start').addEventListener('click', imposterStart);
document.getElementById('btn-mafia-start').addEventListener('click', mafiaStart);
document.getElementById('btn-detective-start').addEventListener('click', detectiveStart);

/* ---------------- Two Truths & a Lie (Chill) ---------------- */
let ttlState = { active:false, submitterId:null, statements:[], guesses:{}, revealed:false, correctIndex:null };

function ttlStartTurn(){
  const body = document.getElementById('ttl-body');
  body.innerHTML = `
    <p class="hint">Write two true statements and one lie about yourself.</p>
    <div class="field"><input type="text" id="ttl-input-0" placeholder="Statement 1" maxlength="120"></div>
    <div class="field"><input type="text" id="ttl-input-1" placeholder="Statement 2" maxlength="120"></div>
    <div class="field"><input type="text" id="ttl-input-2" placeholder="Statement 3" maxlength="120"></div>
    <p class="hint">Which one is the lie?</p>
    <div class="quiz-choices">
      <button class="choice-btn" data-lie="0"><span>Statement 1</span></button>
      <button class="choice-btn" data-lie="1"><span>Statement 2</span></button>
      <button class="choice-btn" data-lie="2"><span>Statement 3</span></button>
    </div>
    <div class="quiz-actions"><button class="btn btn-primary" id="btn-ttl-submit" type="button">Submit</button></div>
  `;
  let chosenLie = null;
  body.querySelectorAll('[data-lie]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      chosenLie = parseInt(btn.dataset.lie,10);
      body.querySelectorAll('[data-lie]').forEach(b=> b.classList.toggle('selected', b===btn));
    });
  });
  document.getElementById('btn-ttl-submit').addEventListener('click', ()=>{
    const statements = [0,1,2].map(i=> document.getElementById('ttl-input-'+i).value.trim());
    if (statements.some(s=>!s) || chosenLie===null){ toast('Fill in all three and mark the lie'); return; }
    ttlState = { active:true, submitterId:myId, statements, guesses:{}, revealed:false, correctIndex:chosenLie };
    renderTtl();
    broadcast({ type:'ttl', action:'statements', submitterId:myId, submitterName:myName, statements });
  });
}
registerHandler('ttl', (fromId, data)=>{
  if (data.action==='statements'){
    ttlState = { active:true, submitterId:data.submitterId, submitterName:data.submitterName, statements:data.statements, guesses:{}, revealed:false, correctIndex:null };
    renderTtl();
  } else if (data.action==='guess'){
    if (ttlState.guesses[data.peerId]===undefined) ttlState.guesses[data.peerId] = data.choice;
    renderTtlTally();
  } else if (data.action==='reveal'){
    ttlState.correctIndex = data.correctIndex;
    ttlState.revealed = true;
    renderTtlReveal();
  }
});
function renderTtl(){
  const body = document.getElementById('ttl-body');
  const isSubmitter = ttlState.submitterId === myId;
  const name = isSubmitter ? 'You' : (participants[ttlState.submitterId]?.name || ttlState.submitterName || '…');
  body.innerHTML = `
    <p class="quiz-question">${escapeHtml(name)}'s two truths and a lie — which is the lie?</p>
    <div class="quiz-choices">${ttlState.statements.map((s,i)=>`<button class="choice-btn" data-guess="${i}" ${isSubmitter?'disabled':''}><span>${escapeHtml(s)}</span></button>`).join('')}</div>
    <p class="hint" id="ttl-tally" style="margin-top:10px;"></p>
    ${isSubmitter ? '<div class="quiz-actions"><button class="btn btn-primary" id="btn-ttl-reveal" type="button">Reveal the lie</button></div>' : ''}
  `;
  if (!isSubmitter){
    body.querySelectorAll('[data-guess]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if (ttlState.guesses[myId]!==undefined || ttlState.revealed) return;
        const i = parseInt(btn.dataset.guess,10);
        ttlState.guesses[myId] = i;
        btn.classList.add('selected');
        broadcast({ type:'ttl', action:'guess', peerId:myId, choice:i });
      });
    });
  } else {
    document.getElementById('btn-ttl-reveal').addEventListener('click', ()=>{
      broadcast({ type:'ttl', action:'reveal', correctIndex: ttlState.correctIndex });
      ttlState.revealed = true;
      renderTtlReveal();
    });
  }
  renderTtlTally();
}
function renderTtlTally(){
  const el = document.getElementById('ttl-tally');
  if (!el) return;
  const count = Object.keys(ttlState.guesses).length;
  el.textContent = `${count} guess${count===1?'':'es'} in so far…`;
}
function renderTtlReveal(){
  document.querySelectorAll('#ttl-body .choice-btn').forEach(btn=>{
    const i = parseInt(btn.dataset.guess ?? btn.dataset.lie ?? '-1', 10);
    if (i === ttlState.correctIndex) btn.classList.add('correct');
  });
  const el = document.getElementById('ttl-tally');
  if (el){
    const correctCount = Object.values(ttlState.guesses).filter(g=> g===ttlState.correctIndex).length;
    el.textContent = `The lie was statement ${ttlState.correctIndex+1} — ${correctCount} of ${Object.keys(ttlState.guesses).length} guessed right.`;
  }
  if (!document.getElementById('btn-ttl-again')){
    const div = document.createElement('div'); div.className='quiz-actions';
    div.innerHTML = `<button class="btn btn-secondary" id="btn-ttl-again" type="button">Someone else's turn</button>`;
    document.getElementById('ttl-body').appendChild(div);
    document.getElementById('btn-ttl-again').addEventListener('click', ttlStartTurn);
  }
}

/* ---------------- Truth or Dare (Romance) ---------------- */
const TOD_TRUTHS = [
  "What's the most embarrassing thing you've done for love?",
  "Who was your first celebrity crush?",
  "What's a secret you've never told anyone in this room?",
  "What's the pettiest thing you've ever done?",
  "What's your most irrational fear?",
  "What's a lie you've told that you never got caught for?"
];
const TOD_DARES = [
  "Do your best impression of someone else in the room.",
  "Text the last person you called 'miss you' or similar right now.",
  "Talk in an accent for the next two minutes.",
  "Let the group pick your profile picture for a day.",
  "Sing the chorus of your most-played song.",
  "Do 10 pushups on camera... or just really commit to the bit."
];
function todSpin(broadcastIt){
  const ids = Object.keys(participants);
  if (ids.length === 0) return;
  const targetId = ids[Math.floor(Math.random()*ids.length)];
  const kind = Math.random() < 0.5 ? 'truth' : 'dare';
  const bank = kind === 'truth' ? TOD_TRUTHS : TOD_DARES;
  const prompt = bank[Math.floor(Math.random()*bank.length)];
  renderTod(targetId, kind, prompt);
  if (broadcastIt) broadcast({ type:'tod', action:'assign', targetId, kind, prompt });
}
registerHandler('tod', (fromId, data)=>{
  if (data.action==='assign') renderTod(data.targetId, data.kind, data.prompt);
});
function renderTod(targetId, kind, prompt){
  const name = targetId===myId ? 'You' : (participants[targetId]?.name || '…');
  const body = document.getElementById('tod-body');
  body.innerHTML = `
    <p class="quiz-question">${escapeHtml(name)} got: ${kind==='truth' ? '🗣 Truth' : '🔥 Dare'}</p>
    <p class="hint" style="font-size:15px; color:var(--text);">${escapeHtml(prompt)}</p>
    <div class="quiz-actions"><button class="btn btn-primary" id="btn-tod-again" type="button">Spin again</button></div>
  `;
  document.getElementById('btn-tod-again').addEventListener('click', ()=> todSpin(true));
}

/* ---------------- Most Likely To (Funny & Jokes) ---------------- */
const MLT_PROMPTS = [
  "fall asleep first during a movie night",
  "text back a week late",
  "cry during a Pixar movie",
  "become famous for the weirdest reason",
  "survive a horror movie the longest",
  "forget their own birthday plans",
  "win an argument with pure confidence, no facts",
  "become a reality TV star"
];
let mltOrder = [];
let mltState = { idx:-1, prompt:'', votes:{} };
function mltNext(broadcastIt){
  if (mltOrder.length===0) mltOrder = shuffledOrder(MLT_PROMPTS.length);
  const idx = mltOrder.shift();
  mltState = { idx, prompt: MLT_PROMPTS[idx], votes:{} };
  renderMlt();
  if (broadcastIt) broadcast({ type:'mlt', action:'question', idx, prompt: mltState.prompt });
}
registerHandler('mlt', (fromId, data)=>{
  if (data.action==='question'){
    mltState = { idx:data.idx, prompt:data.prompt, votes:{} };
    renderMlt();
  } else if (data.action==='vote'){
    if (data.idx===mltState.idx) mltState.votes[data.peerId] = data.choice;
    renderMltTally();
  }
});
function renderMlt(){
  const body = document.getElementById('mlt-body');
  const others = Object.keys(participants);
  body.innerHTML = `
    <p class="quiz-question">Most likely to ${escapeHtml(mltState.prompt)}?</p>
    <div class="quiz-choices">${others.map(id=>`<button class="choice-btn" data-vote="${id}"><span>${escapeHtml(id===myId?'You':participants[id].name)}</span></button>`).join('')}</div>
    <p class="hint" id="mlt-tally" style="margin-top:10px;"></p>
    <div class="quiz-actions"><button class="btn btn-primary" id="btn-mlt-next" type="button">Next round</button></div>
  `;
  body.querySelectorAll('[data-vote]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      mltState.votes[myId] = btn.dataset.vote;
      body.querySelectorAll('[data-vote]').forEach(b=> b.classList.toggle('selected', b===btn));
      broadcast({ type:'mlt', action:'vote', idx:mltState.idx, peerId:myId, choice:btn.dataset.vote });
      renderMltTally();
    });
  });
  document.getElementById('btn-mlt-next').addEventListener('click', ()=> mltNext(true));
  renderMltTally();
}
function renderMltTally(){
  const el = document.getElementById('mlt-tally');
  if (!el) return;
  const counts = {};
  Object.values(mltState.votes).forEach(id=> counts[id] = (counts[id]||0)+1);
  const parts = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([id,c])=>{
    const name = id===myId ? 'You' : (participants[id]?.name || '…');
    return `${escapeHtml(name)}: ${c}`;
  });
  el.textContent = parts.length ? parts.join(' · ') : 'No votes yet';
}

/* ---------------- Draft (Challenge) — its own visual identity ---------------- */
const DRAFT_CATEGORIES = [
  { name:"Best comfort foods", items:["Pizza","Mac & cheese","Ramen","Fried chicken","Tacos","Grilled cheese","Mashed potatoes","Dumplings","Ice cream","Burgers","Fries","Curry"] },
  { name:"Dream vacation spots", items:["Tokyo","Santorini","Bali","Iceland","New York","Maldives","Rome","Cape Town","Banff","Kyoto","Barcelona","Patagonia"] },
  { name:"Superpowers", items:["Flight","Invisibility","Telepathy","Time travel","Super strength","Teleportation","Healing","Shape-shifting","Mind control","Immortality","Super speed","X-ray vision"] }
];
let draftState = { active:false, category:null, pool:[], order:[], turnIndex:0, picks:{}, picksPerPlayer:3 };

function draftStart(){
  const category = DRAFT_CATEGORIES[Math.floor(Math.random()*DRAFT_CATEGORIES.length)];
  const order = Object.keys(participants);
  if (order.length < 2){ toast('Need at least 2 people in the room to draft'); return; }
  const picks = {}; order.forEach(id=> picks[id] = []);
  draftState = { active:true, category, pool:[...category.items], order, turnIndex:0, picks, picksPerPlayer:3 };
  renderDraft();
  broadcast({ type:'draft', action:'start', category: category.name, pool: draftState.pool, order });
}
registerHandler('draft', (fromId, data)=>{
  if (data.action==='start'){
    const picks = {}; data.order.forEach(id=> picks[id] = []);
    draftState = { active:true, category:{name:data.category, items:data.pool}, pool:[...data.pool], order:data.order, turnIndex:0, picks, picksPerPlayer:3 };
    renderDraft();
  } else if (data.action==='pick'){
    const idx = draftState.pool.indexOf(data.item);
    if (idx !== -1) draftState.pool.splice(idx,1);
    if (!draftState.picks[data.peerId]) draftState.picks[data.peerId] = [];
    draftState.picks[data.peerId].push(data.item);
    draftState.turnIndex++;
    renderDraft();
  }
});
function draftCurrentPickerId(){
  if (!draftState.active) return null;
  const totalPicks = draftState.order.length * draftState.picksPerPlayer;
  if (draftState.turnIndex >= totalPicks || draftState.pool.length === 0) return null;
  return draftState.order[draftState.turnIndex % draftState.order.length];
}
function draftPick(item){
  const currentPicker = draftCurrentPickerId();
  if (currentPicker !== myId) return;
  draftState.pool = draftState.pool.filter(i=> i!==item);
  draftState.picks[myId].push(item);
  draftState.turnIndex++;
  renderDraft();
  broadcast({ type:'draft', action:'pick', peerId:myId, item });
}
function renderDraft(){
  const body = document.getElementById('draft-body');
  if (!draftState.active){
    body.innerHTML = `<p class="hint">Everyone drafts picks, turn by turn, from a shared category. Build the best lineup.</p><button class="btn draft-start-btn" id="btn-draft-start" type="button">Start the draft</button>`;
    document.getElementById('btn-draft-start').addEventListener('click', draftStart);
    return;
  }
  const currentPicker = draftCurrentPickerId();
  const done = currentPicker === null;
  const currentName = currentPicker ? (currentPicker===myId ? 'YOU' : (participants[currentPicker]?.name || '…').toUpperCase()) : null;

  body.innerHTML = `
    <div class="draft-banner">${done ? '🏁 DRAFT COMPLETE' : `🎯 ON THE CLOCK: ${escapeHtml(currentName)}`}</div>
    <p class="draft-category">${escapeHtml(draftState.category.name)}</p>
    <div class="draft-pool">${draftState.pool.map(item=>`<button class="draft-chip" data-pick="${escapeHtml(item)}" ${currentPicker===myId ? '' : 'disabled'}>${escapeHtml(item)}</button>`).join('') || '<span class="hint">Pool empty</span>'}</div>
    <div class="draft-boards">
      ${draftState.order.map(id=>`
        <div class="draft-board">
          <h4>${id===myId ? 'You' : escapeHtml(participants[id]?.name || '…')}</h4>
          <ol>${draftState.picks[id].map(p=>`<li>${escapeHtml(p)}</li>`).join('') || '<li class="hint">No picks yet</li>'}</ol>
        </div>
      `).join('')}
    </div>
    ${done ? '<div class="quiz-actions"><button class="btn draft-start-btn" id="btn-draft-again" type="button">Draft again</button></div>' : ''}
  `;
  body.querySelectorAll('[data-pick]').forEach(btn=>{
    btn.addEventListener('click', ()=> draftPick(btn.dataset.pick));
  });
  if (done){
    document.getElementById('btn-draft-again').addEventListener('click', draftStart);
  }
}

/* ---------------- Guess It: Movie / Song / Character (Music, Movies & Anime) ----------------
   One shared engine for all three "Guess the ___" catalog entries — same
   AI-generated-clue + offline-fallback + timed-reveal shape as Trivia,
   just parameterized by category instead of three separate games. */
const GUESS_CATEGORY_LABEL = { movie:'🎬 Movie', song:'🎵 Song', character:'🕵️ Character' };
const GUESS_OFFLINE_BANK = {
  movie: [
    {q:"A hobbit and his friends set out to destroy a powerful ring before it falls into the wrong hands.", choices:["The Lord of the Rings","Harry Potter","Narnia","Eragon"], correct:0},
    {q:"A retired assassin returns to the criminal underworld to avenge the death of a dog given to him by his late wife.", choices:["The Equalizer","Taken","John Wick","Nobody"], correct:2},
    {q:"A group of superheroes must set aside their differences to stop an alien invasion of New York.", choices:["Justice League","The Avengers","X-Men","Watchmen"], correct:1},
    {q:"A young lion prince flees his kingdom after his father's death, only to learn his true destiny years later.", choices:["Tarzan","The Lion King","Brother Bear","Ice Age"], correct:1},
    {q:"A shark terrorizes a small beach town, forcing a police chief to hunt it down with a crew of two others.", choices:["Jaws","The Meg","Open Water","Deep Blue Sea"], correct:0},
    {q:"A group of toys come to life when humans aren't around and must work together to get back to their owner.", choices:["The Brave Little Toaster","Toy Story","Small Soldiers","Corpse Bride"], correct:1}
  ],
  song: [
    {q:"An 80s-inspired synth-pop hit about longing for someone, famous for a throwback style music video.", choices:["Blinding Lights","Uptown Funk","Shape of You","Happy"], correct:0},
    {q:"A groovy funk-pop track referencing an emergency phone line, with a music video full of retro dance moves.", choices:["24K Magic","Uptown Funk","Can't Stop the Feeling","Treasure"], correct:1},
    {q:"A breakup anthem about moving on and being fine without someone, built around a driving pop-rock beat.", choices:["Since U Been Gone","Rolling in the Deep","Before He Cheats","Since U Been Gone"], correct:1},
    {q:"A feel-good pop song built around clapping and repeated declarations of joy, from an animated movie soundtrack.", choices:["Happy","Can't Stop the Feeling","Good Time","Roar"], correct:0},
    {q:"A summery pop duet about a laid-back romance, named after a fruit that's also a nickname for someone sweet.", choices:["Peaches","Watermelon Sugar","Cherry","Sunflower"], correct:3}
  ],
  character: [
    {q:"A billionaire vigilante who fights crime in a city plagued by corruption, without any superpowers of his own.", choices:["Batman","Iron Man","Deadpool","The Flash"], correct:0},
    {q:"A wizard with a lightning-bolt scar who discovers he's famous in a hidden magical world.", choices:["Merlin","Harry Potter","Gandalf","Doctor Strange"], correct:1},
    {q:"A green ogre who just wants to be left alone in his swamp, but ends up on a quest to rescue a princess.", choices:["Hagrid","Shrek","The Hulk","Groot"], correct:1},
    {q:"A teenage boy bitten by a radioactive spider who swings through a city fighting crime while balancing school life.", choices:["Spider-Man","Static Shock","The Flash","Nightwing"], correct:0},
    {q:"A fish who suffers from short-term memory loss and helps search for a missing clownfish across the ocean.", choices:["Nemo","Dory","Flounder","Bubbles"], correct:1}
  ]
};
let guessState = { category:'movie', qIndex:-1, answers:{}, scores:{}, revealed:true, timerHandle:null, _correct:null };
let guessRoundCounter = 0;
let askedGuessPrompts = [];
let guessOfflineOrder = {};

function openGuessGame(category){
  document.getElementById('category-detail').style.display='none';
  document.getElementById('game-guess').style.display='block';
  guessState.category = ['movie','song','character'].includes(category) ? category : 'movie';
  renderGuessIntro();
  if (typeof logActivity === 'function') logActivity('game', 'guess-'+guessState.category, 'Guess the '+GUESS_CATEGORY_LABEL[guessState.category].replace(/^\S+\s/,''));
}
function renderGuessIntro(){
  const body = document.getElementById('guess-body');
  if (!body) return;
  body.innerHTML = `
    <p class="hint">Everyone answers, then it reveals after 12 seconds. AI comes up with fresh clues — falls back to an offline bank if it's briefly unavailable.</p>
    <button class="btn btn-primary" id="btn-guess-start" type="button">Start — ${GUESS_CATEGORY_LABEL[guessState.category]}</button>
  `;
  document.getElementById('btn-guess-start').addEventListener('click', ()=> guessNext(true));
}
async function fetchAiGuess(){
  try{
    const json = await callAiFunction({ mode:'guess', category: guessState.category, askedPrompts: askedGuessPrompts.slice(-15), callerId: myId });
    const g = json.guess;
    if (g && typeof g.clue === 'string' && Array.isArray(g.choices) && g.choices.length === 4 && typeof g.correctIndex === 'number'){
      return { q: g.clue, choices: g.choices, correct: g.correctIndex };
    }
    throw new Error('AI returned an unexpected format');
  }catch(e){
    console.warn('AI guess unavailable after retry:', e.message);
    return null;
  }
}
function nextOfflineGuess(category){
  if (!guessOfflineOrder[category] || guessOfflineOrder[category].length===0) guessOfflineOrder[category] = shuffledOrder(GUESS_OFFLINE_BANK[category].length);
  const idx = guessOfflineOrder[category].shift();
  return GUESS_OFFLINE_BANK[category][idx];
}
async function guessNext(broadcastIt){
  const category = guessState.category;
  if (broadcastIt){
    const body = document.getElementById('guess-body');
    if (body) body.innerHTML = '<p class="hint">🤖 Cooking up a clue…</p>';
  }
  let q = await fetchAiGuess();
  if (!q){
    q = nextOfflineGuess(category);
    if (broadcastIt) toast('AI is briefly unavailable — using an offline clue', 'err');
  }
  askedGuessPrompts.push(q.q);
  const roundId = 'gs' + (guessRoundCounter++) + '-' + Date.now();
  startGuessQuestion(roundId, q, category, broadcastIt);
}
function startGuessQuestion(roundId, q, category, broadcastIt){
  clearTimeout(guessState.timerHandle);
  guessState = { category, qIndex:roundId, answers:{}, scores:guessState.scores||{}, revealed:false, timerHandle:null, _correct:q.correct };
  renderGuessQuestion(q);
  guessState.timerHandle = setTimeout(revealGuess, 12000);
  if (broadcastIt) broadcast({type:'guess', action:'question', category, idx:roundId, q:q.q, choices:q.choices, correct:q.correct});
}
function renderGuessQuestion(q){
  const body = document.getElementById('guess-body');
  if (!body) return;
  body.innerHTML = `
    <p class="hint" style="margin-bottom:6px;">${GUESS_CATEGORY_LABEL[guessState.category]}</p>
    <p class="quiz-question">${escapeHtml(q.q)}</p>
    <div class="quiz-choices">${q.choices.map((c,i)=>`<button class="choice-btn" data-i="${i}"><span>${escapeHtml(c)}</span></button>`).join('')}</div>
    <p class="hint" style="margin-top:10px;" id="guess-wait">12 seconds to answer…</p>
    <div class="scoreboard" id="guess-scoreboard"></div>
  `;
  body.querySelectorAll('.choice-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (guessState.revealed || guessState.answers[myId]!==undefined) return;
      const i = parseInt(btn.dataset.i,10);
      guessState.answers[myId] = i;
      btn.classList.add('selected');
      document.getElementById('guess-wait').textContent = 'Answer locked in — waiting for reveal…';
      broadcast({type:'guess', action:'answer', idx:guessState.qIndex, peerId:myId, choice:i});
    });
  });
  renderGuessScoreboard();
}
registerHandler('guess', (fromId, data)=>{
  if (data.action==='question'){
    clearTimeout(guessState.timerHandle);
    guessState = { category:data.category, qIndex:data.idx, answers:{}, scores:guessState.scores||{}, revealed:false, timerHandle:null, _correct:data.correct };
    renderGuessQuestion({q:data.q, choices:data.choices, correct:data.correct});
    guessState.timerHandle = setTimeout(revealGuess, 12000);
  } else if (data.action==='answer'){
    if (data.idx===guessState.qIndex && guessState.answers[data.peerId]===undefined){
      guessState.answers[data.peerId] = data.choice;
    }
  }
});
function revealGuess(){
  if (guessState.revealed) return;
  guessState.revealed = true;
  const correct = guessState._correct;
  document.querySelectorAll('#guess-body .choice-btn').forEach(btn=>{
    const i = parseInt(btn.dataset.i,10);
    if (i===correct) btn.classList.add('correct');
    else if (guessState.answers[myId]===i) btn.classList.add('wrong');
  });
  const waitEl = document.getElementById('guess-wait');
  if (waitEl) waitEl.textContent = 'Revealed!';
  Object.entries(guessState.answers).forEach(([pid,choice])=>{
    if (choice===correct) guessState.scores[pid] = (guessState.scores[pid]||0)+1;
  });
  renderGuessScoreboard();
  const body = document.getElementById('guess-body');
  if (!document.getElementById('btn-guess-next')){
    const div = document.createElement('div'); div.className='quiz-actions';
    div.innerHTML = `<button class="btn btn-primary" id="btn-guess-next">Next round</button>`;
    body.appendChild(div);
    document.getElementById('btn-guess-next').addEventListener('click', ()=> guessNext(true));
  }
}
function renderGuessScoreboard(){
  const el = document.getElementById('guess-scoreboard'); if (!el) return;
  const rows = Object.entries(guessState.scores||{}).sort((a,b)=>b[1]-a[1]);
  el.innerHTML = rows.map(([pid,score])=>{
    const name = pid===myId ? 'You' : (participants[pid]?.name || '…');
    return `<div class="score-row"><span>${escapeHtml(name)}</span><b>${score}</b></div>`;
  }).join('');
}
/* ================================================================
   MIND GAMES — Imposter, Mafia, Detective
   Each one gets its own full background/vibe (see style.css) instead
   of sitting inside the shared .game-panel card like the rest of the
   catalog. Same peer-to-peer patterns as the rest of this file:
   sendData() for a private role reveal, broadcast() for public phase/
   vote messages, and a host (or, for Mafia, the Mafia player itself)
   as the one authoritative source for anything that has to stay secret.
   ================================================================ */

/* ---------------- Imposter ---------------- */
const IMPOSTER_WORDS = [
  "Pizza","Beach vacation","Astronaut","Wedding","Roller coaster","Sushi",
  "Waterfall","Birthday party","Guitar","Smartphone","Campfire","Library",
  "Volcano","Circus","Snowstorm","Coffee shop","Submarine","Treasure map",
  "Magic trick","Road trip","Haunted house","Farmers market"
];
let imposterState = { active:false, roundId:null, hostId:null, myWord:null, isImposter:false, phase:'lobby', order:[], votes:{}, imposterId:null, word:null };
let imposterRoundCounter = 0;

function imposterStart(){
  const order = Object.keys(participants);
  if (order.length < 3){ toast('Need at least 3 people in the room to play Imposter'); return; }
  const word = IMPOSTER_WORDS[Math.floor(Math.random()*IMPOSTER_WORDS.length)];
  const imposterId = order[Math.floor(Math.random()*order.length)];
  const roundId = 'imp' + (imposterRoundCounter++) + '-' + Date.now();
  order.forEach(id=>{
    if (id === myId){
      imposterState = { active:true, roundId, hostId:myId, myWord: id===imposterId?null:word, isImposter:id===imposterId, phase:'reveal', order, votes:{}, imposterId, word };
    } else {
      sendData(dataConns[id], { type:'imposter', action:'assign', roundId, order, hostId:myId, word: id===imposterId ? null : word, isImposter: id===imposterId });
    }
  });
  renderImposter();
}
registerHandler('imposter', (fromId, data)=>{
  if (data.action==='assign'){
    imposterState = { active:true, roundId:data.roundId, hostId:data.hostId, myWord:data.word, isImposter:data.isImposter, phase:'reveal', order:data.order, votes:{}, imposterId:null, word:null };
    renderImposter();
  } else if (data.action==='phase'){
    if (data.roundId !== imposterState.roundId) return;
    imposterState.phase = data.phase;
    renderImposter();
  } else if (data.action==='vote'){
    if (data.roundId !== imposterState.roundId) return;
    imposterState.votes[data.peerId] = data.voteFor;
    renderImposter();
  } else if (data.action==='reveal'){
    if (data.roundId !== imposterState.roundId) return;
    imposterState.phase = 'results';
    imposterState.imposterId = data.imposterId;
    imposterState.word = data.word;
    renderImposter();
  }
});
function imposterGoToVote(){
  imposterState.phase = 'vote';
  broadcast({ type:'imposter', action:'phase', roundId:imposterState.roundId, phase:'vote' });
  renderImposter();
}
function imposterCastVote(forId){
  imposterState.votes[myId] = forId;
  broadcast({ type:'imposter', action:'vote', roundId:imposterState.roundId, peerId:myId, voteFor:forId });
  renderImposter();
}
function imposterReveal(){
  broadcast({ type:'imposter', action:'reveal', roundId:imposterState.roundId, imposterId:imposterState.imposterId, word:imposterState.word });
  imposterState.phase = 'results';
  renderImposter();
}
function renderImposter(){
  const body = document.getElementById('imposter-body');
  if (!body) return;
  if (!imposterState.active){
    body.innerHTML = `
      <div class="imp-role">🕵️</div>
      <p class="imp-lead">One of you won't know the word. Everyone else does. Talk it out, then vote.</p>
      <button class="imp-btn" id="btn-imposter-start" type="button">Start a round</button>
    `;
    document.getElementById('btn-imposter-start').addEventListener('click', imposterStart);
    return;
  }
  const isHost = imposterState.hostId === myId;
  if (imposterState.phase === 'reveal'){
    body.innerHTML = imposterState.isImposter ? `
      <div class="imp-role imp-role--imposter">?</div>
      <p class="imp-lead">You don't know the word.</p>
      <p class="imp-sub">Everyone else does. Listen close, bluff hard, don't get caught.</p>
      <button class="imp-btn" id="btn-imposter-vote" type="button">Everyone's ready — start voting</button>
    ` : `
      <div class="imp-role">${escapeHtml(imposterState.myWord)}</div>
      <p class="imp-lead">That's the word.</p>
      <p class="imp-sub">One person in this room doesn't know it. Find them.</p>
      <button class="imp-btn" id="btn-imposter-vote" type="button">Everyone's ready — start voting</button>
    `;
    document.getElementById('btn-imposter-vote').addEventListener('click', imposterGoToVote);
    return;
  }
  if (imposterState.phase === 'vote'){
    const myVote = imposterState.votes[myId];
    body.innerHTML = `
      <p class="imp-lead">Who doesn't know the word?</p>
      <div class="imp-suspects">
        ${imposterState.order.map(id=>`<button class="imp-suspect ${myVote===id?'picked':''}" data-vote="${id}">${escapeHtml(id===myId?'You':(participants[id]?.name||'…'))}</button>`).join('')}
      </div>
      <p class="imp-tally">${Object.keys(imposterState.votes).length} of ${imposterState.order.length} have voted</p>
      ${isHost ? `<button class="imp-btn imp-btn--ghost" id="btn-imposter-reveal" type="button">Reveal the imposter</button>` : `<p class="imp-sub">Waiting on the host to reveal…</p>`}
    `;
    body.querySelectorAll('[data-vote]').forEach(btn=> btn.addEventListener('click', ()=> imposterCastVote(btn.dataset.vote)));
    if (isHost) document.getElementById('btn-imposter-reveal').addEventListener('click', imposterReveal);
    return;
  }
  if (imposterState.phase === 'results'){
    const correct = Object.values(imposterState.votes).filter(v=>v===imposterState.imposterId).length;
    body.innerHTML = `
      <p class="imp-lead">The imposter was…</p>
      <div class="imp-role imp-role--caught">${escapeHtml(imposterState.imposterId===myId?'You':(participants[imposterState.imposterId]?.name||'…'))}</div>
      <p class="imp-sub">The word was <b>${escapeHtml(imposterState.word)}</b> · ${correct} of ${imposterState.order.length} guessed right</p>
      <button class="imp-btn" id="btn-imposter-again" type="button">Play again</button>
    `;
    document.getElementById('btn-imposter-again').addEventListener('click', imposterStart);
  }
}

/* ---------------- Mafia ---------------- */
let mafiaState = { active:false, roundId:null, hostId:null, order:[], alive:{}, isMafia:false, mafiaId:null, phase:'lobby', dayNum:1, lastVictim:null, lastLynched:null, votes:{}, result:null, _advanceTimer:null };
let mafiaRoundCounter = 0;

function mafiaAliveIds(){ return mafiaState.order.filter(id=> mafiaState.alive[id]); }

function mafiaStart(){
  const order = Object.keys(participants);
  if (order.length < 3){ toast('Need at least 3 people in the room to play Mafia'); return; }
  const mafiaId = order[Math.floor(Math.random()*order.length)];
  const roundId = 'maf' + (mafiaRoundCounter++) + '-' + Date.now();
  const alive = {}; order.forEach(id=> alive[id]=true);
  clearTimeout(mafiaState._advanceTimer);
  order.forEach(id=>{
    if (id === myId){
      mafiaState = { active:true, roundId, hostId:myId, order, alive:{...alive}, isMafia:id===mafiaId, mafiaId, phase:'night', dayNum:1, lastVictim:null, lastLynched:null, votes:{}, result:null, _advanceTimer:null };
    } else {
      sendData(dataConns[id], { type:'mafia', action:'assign', roundId, order, hostId:myId, isMafia:id===mafiaId });
    }
  });
  renderMafia();
}
registerHandler('mafia', (fromId, data)=>{
  if (data.action==='assign'){
    const alive = {}; data.order.forEach(id=> alive[id]=true);
    clearTimeout(mafiaState._advanceTimer);
    mafiaState = { active:true, roundId:data.roundId, hostId:data.hostId, order:data.order, alive, isMafia:data.isMafia, mafiaId: data.isMafia?myId:null, phase:'night', dayNum:1, lastVictim:null, lastLynched:null, votes:{}, result:null, _advanceTimer:null };
    renderMafia();
  } else if (data.action==='night-result'){
    if (data.roundId !== mafiaState.roundId) return;
    mafiaState.alive[data.victim] = false;
    mafiaState.lastVictim = data.victim;
    mafiaState.dayNum = data.dayNum;
    mafiaState.phase = data.gameOver ? 'results' : 'day-discuss';
    if (data.gameOver){ mafiaState.result = data.result; mafiaState.mafiaId = data.mafiaId; }
    renderMafia();
  } else if (data.action==='phase'){
    if (data.roundId !== mafiaState.roundId) return;
    mafiaState.phase = data.phase;
    mafiaState.votes = {};
    renderMafia();
  } else if (data.action==='vote'){
    if (data.roundId !== mafiaState.roundId) return;
    mafiaState.votes[data.peerId] = data.voteFor;
    renderMafia();
  } else if (data.action==='resolve-lynch'){
    if (data.roundId !== mafiaState.roundId) return;
    mafiaResolveLynch();
  } else if (data.action==='reveal'){
    if (data.roundId !== mafiaState.roundId) return;
    clearTimeout(mafiaState._advanceTimer);
    mafiaState.phase = 'results';
    mafiaState.result = data.result;
    mafiaState.mafiaId = data.mafiaId;
    renderMafia();
  }
});
function mafiaNightPick(targetId){
  if (!mafiaState.isMafia || mafiaState.phase!=='night') return;
  mafiaState.alive[targetId] = false;
  const townAlive = mafiaAliveIds().filter(id=> id!==myId).length;
  const gameOver = townAlive <= 1;
  mafiaState.lastVictim = targetId;
  mafiaState.phase = gameOver ? 'results' : 'day-discuss';
  if (gameOver){ mafiaState.result = 'mafia'; mafiaState.mafiaId = myId; }
  broadcast({ type:'mafia', action:'night-result', roundId:mafiaState.roundId, victim:targetId, dayNum:mafiaState.dayNum, gameOver, result: gameOver?'mafia':null, mafiaId: gameOver?myId:null });
  renderMafia();
}
function mafiaOpenVote(){
  mafiaState.phase = 'day-vote';
  mafiaState.votes = {};
  broadcast({ type:'mafia', action:'phase', roundId:mafiaState.roundId, phase:'day-vote' });
  renderMafia();
}
function mafiaCastVote(forId){
  if (!mafiaState.alive[myId]) return;
  mafiaState.votes[myId] = forId;
  broadcast({ type:'mafia', action:'vote', roundId:mafiaState.roundId, peerId:myId, voteFor:forId });
  renderMafia();
}
function mafiaTally(){
  broadcast({ type:'mafia', action:'resolve-lynch', roundId:mafiaState.roundId });
  mafiaResolveLynch();
}
function mafiaResolveLynch(){
  const tally = {};
  Object.values(mafiaState.votes).forEach(id=> tally[id]=(tally[id]||0)+1);
  const entries = Object.entries(tally).sort((a,b)=>b[1]-a[1]);
  if (!entries.length){
    mafiaState.phase = 'night'; mafiaState.dayNum++; mafiaState.votes = {};
    renderMafia();
    return;
  }
  const eliminated = entries[0][0];
  mafiaState.alive[eliminated] = false;
  mafiaState.lastLynched = eliminated;
  if (mafiaState.isMafia && eliminated === myId){
    mafiaState.phase = 'results'; mafiaState.result = 'town'; mafiaState.mafiaId = myId;
    broadcast({ type:'mafia', action:'reveal', roundId:mafiaState.roundId, mafiaId:myId, result:'town' });
    renderMafia();
    return;
  }
  mafiaState.phase = 'day-result';
  renderMafia();
  clearTimeout(mafiaState._advanceTimer);
  mafiaState._advanceTimer = setTimeout(()=>{
    if (mafiaState.phase !== 'day-result') return; // a reveal already arrived
    mafiaState.phase = 'night'; mafiaState.dayNum++; mafiaState.votes = {};
    renderMafia();
  }, 2200);
}
function renderMafia(){
  const body = document.getElementById('mafia-body');
  if (!body) return;
  if (!mafiaState.active){
    body.innerHTML = `
      <div class="maf-crest">🎭</div>
      <p class="maf-lead">One of you is Mafia. Nobody else knows who. Survive the night, catch them by day.</p>
      <button class="maf-btn" id="btn-mafia-start" type="button">Start the game</button>
    `;
    document.getElementById('btn-mafia-start').addEventListener('click', mafiaStart);
    return;
  }
  const aliveIds = mafiaAliveIds();
  const iAmAlive = !!mafiaState.alive[myId];

  if (mafiaState.phase === 'night'){
    if (mafiaState.isMafia){
      const targets = aliveIds.filter(id=> id!==myId);
      body.innerHTML = `
        <div class="maf-phase-tag maf-phase-tag--night">🌙 Night ${mafiaState.dayNum}</div>
        <p class="maf-lead">Choose who disappears tonight.</p>
        <div class="maf-suspects">
          ${targets.map(id=>`<button class="maf-suspect" data-kill="${id}">${escapeHtml(participants[id]?.name||'…')}</button>`).join('') || '<p class="maf-sub">No one left to target.</p>'}
        </div>
      `;
      body.querySelectorAll('[data-kill]').forEach(btn=> btn.addEventListener('click', ()=> mafiaNightPick(btn.dataset.kill)));
    } else {
      body.innerHTML = `
        <div class="maf-phase-tag maf-phase-tag--night">🌙 Night ${mafiaState.dayNum}</div>
        <p class="maf-lead">The town sleeps.</p>
        <p class="maf-sub">Somewhere out there, the Mafia is choosing.</p>
        ${!iAmAlive ? '<p class="maf-dead-tag">👻 You were eliminated — watch quietly.</p>' : ''}
      `;
    }
    return;
  }
  if (mafiaState.phase === 'day-discuss'){
    body.innerHTML = `
      <div class="maf-phase-tag maf-phase-tag--day">☀️ Day ${mafiaState.dayNum}</div>
      <p class="maf-lead"><b>${escapeHtml(participants[mafiaState.lastVictim]?.name||'Someone')}</b> was found eliminated overnight.</p>
      <p class="maf-sub">Talk it out over voice, then open the floor.</p>
      ${iAmAlive ? '<button class="maf-btn" id="btn-mafia-open-vote" type="button">Open the vote</button>' : '<p class="maf-dead-tag">👻 You were eliminated — watch quietly.</p>'}
    `;
    if (iAmAlive) document.getElementById('btn-mafia-open-vote').addEventListener('click', mafiaOpenVote);
    return;
  }
  if (mafiaState.phase === 'day-vote'){
    const myVote = mafiaState.votes[myId];
    body.innerHTML = `
      <div class="maf-phase-tag maf-phase-tag--day">☀️ Day ${mafiaState.dayNum} · Vote</div>
      <p class="maf-lead">Who do you think is Mafia?</p>
      <div class="maf-suspects">
        ${aliveIds.map(id=>`<button class="maf-suspect ${myVote===id?'picked':''}" data-vote="${id}" ${iAmAlive?'':'disabled'}>${escapeHtml(id===myId?'You':(participants[id]?.name||'…'))}</button>`).join('')}
      </div>
      <p class="maf-tally">${Object.keys(mafiaState.votes).length} of ${aliveIds.length} alive have voted</p>
      ${iAmAlive ? '<button class="maf-btn maf-btn--ghost" id="btn-mafia-tally" type="button">Tally the vote</button>' : '<p class="maf-dead-tag">👻 You were eliminated — watch quietly.</p>'}
    `;
    body.querySelectorAll('[data-vote]').forEach(btn=> btn.addEventListener('click', ()=> mafiaCastVote(btn.dataset.vote)));
    if (iAmAlive) document.getElementById('btn-mafia-tally').addEventListener('click', mafiaTally);
    return;
  }
  if (mafiaState.phase === 'day-result'){
    body.innerHTML = `
      <div class="maf-phase-tag maf-phase-tag--day">☀️ Day ${mafiaState.dayNum}</div>
      <p class="maf-lead"><b>${escapeHtml(participants[mafiaState.lastLynched]?.name||'Someone')}</b> was voted out…</p>
      <p class="maf-sub">Were they Mafia? Night falls again either way.</p>
    `;
    return;
  }
  if (mafiaState.phase === 'results'){
    const won = mafiaState.result === 'town' ? 'Town' : 'Mafia';
    body.innerHTML = `
      <div class="maf-crest maf-crest--reveal">${won === 'Town' ? '🏆' : '🎭'}</div>
      <p class="maf-lead">${won} wins!</p>
      <p class="maf-sub">The Mafia was <b>${escapeHtml(mafiaState.mafiaId===myId?'You':(participants[mafiaState.mafiaId]?.name||'…'))}</b></p>
      <button class="maf-btn" id="btn-mafia-again" type="button">Play again</button>
    `;
    document.getElementById('btn-mafia-again').addEventListener('click', mafiaStart);
  }
}

/* ---------------- Detective ---------------- */
const DETECTIVE_CASES = [
  { crime:"Someone ate the last slice of cake from the office fridge.", clues:[
    "You were seen near the kitchen right when it happened.",
    "You have crumbs on your sleeve you can't explain.",
    "You left the room right before the cake vanished.",
    "Your fork was in the sink, freshly rinsed.",
    "You changed the subject fast when cake came up.",
    "You've been suspiciously quiet about dessert all day."] },
  { crime:"The thermostat keeps getting changed to 85°F overnight.", clues:[
    "You've been wearing short sleeves indoors lately.",
    "You were the last one to leave last night.",
    "You complained about the cold earlier today.",
    "Your phone shows you checked the weather app at 2am.",
    "You know the thermostat's passcode.",
    "You've mentioned hating air conditioning before."] },
  { crime:"Someone rearranged all the furniture as a 'prank.'", clues:[
    "You've got a suspicious amount of free time lately.",
    "You were humming while everyone else was confused.",
    "You knew exactly where everything ended up.",
    "You 'happened' to have your phone out recording reactions.",
    "You've pulled a prank like this before.",
    "You offered to help 'put it back' a little too quickly."] }
];
let detState = { active:false, roundId:null, hostId:null, order:[], culpritId:null, isCulprit:false, myClue:null, crime:null, phase:'lobby', votes:{} };
let detRoundCounter = 0;

function detectiveStart(){
  const order = Object.keys(participants);
  if (order.length < 3){ toast('Need at least 3 people in the room to open a case'); return; }
  const c = DETECTIVE_CASES[Math.floor(Math.random()*DETECTIVE_CASES.length)];
  const culpritId = order[Math.floor(Math.random()*order.length)];
  const roundId = 'det' + (detRoundCounter++) + '-' + Date.now();
  const clueOrder = shuffledOrder(c.clues.length);
  let ci = 0;
  order.forEach(id=>{
    const clue = id===culpritId ? null : c.clues[clueOrder[(ci++) % c.clues.length]];
    if (id === myId){
      detState = { active:true, roundId, hostId:myId, order, culpritId, isCulprit:id===culpritId, myClue:clue, crime:c.crime, phase:'briefing', votes:{} };
    } else {
      sendData(dataConns[id], { type:'detective', action:'assign', roundId, order, hostId:myId, crime:c.crime, isCulprit:id===culpritId, clue });
    }
  });
  renderDetective();
}
registerHandler('detective', (fromId, data)=>{
  if (data.action==='assign'){
    detState = { active:true, roundId:data.roundId, hostId:data.hostId, order:data.order, culpritId:null, isCulprit:data.isCulprit, myClue:data.clue, crime:data.crime, phase:'briefing', votes:{} };
    renderDetective();
  } else if (data.action==='phase'){
    if (data.roundId !== detState.roundId) return;
    detState.phase = data.phase;
    renderDetective();
  } else if (data.action==='vote'){
    if (data.roundId !== detState.roundId) return;
    detState.votes[data.peerId] = data.voteFor;
    renderDetective();
  } else if (data.action==='reveal'){
    if (data.roundId !== detState.roundId) return;
    detState.culpritId = data.culpritId;
    detState.phase = 'results';
    renderDetective();
  }
});
function detectiveOpenVote(){
  detState.phase = 'vote';
  broadcast({ type:'detective', action:'phase', roundId:detState.roundId, phase:'vote' });
  renderDetective();
}
function detectiveCastVote(forId){
  detState.votes[myId] = forId;
  broadcast({ type:'detective', action:'vote', roundId:detState.roundId, peerId:myId, voteFor:forId });
  renderDetective();
}
function detectiveReveal(){
  broadcast({ type:'detective', action:'reveal', roundId:detState.roundId, culpritId:detState.culpritId });
  detState.phase = 'results';
  renderDetective();
}
function renderDetective(){
  const body = document.getElementById('detective-body');
  if (!body) return;
  if (!detState.active){
    body.innerHTML = `
      <div class="det-badge">🔍</div>
      <p class="det-lead">A case breaks open. One of you did it — everyone else gets a clue. Question each other, then accuse.</p>
      <button class="det-btn" id="btn-detective-start" type="button">Open a case</button>
    `;
    document.getElementById('btn-detective-start').addEventListener('click', detectiveStart);
    return;
  }
  const isHost = detState.hostId === myId;
  if (detState.phase === 'briefing'){
    body.innerHTML = `
      <p class="det-case-label">THE CASE</p>
      <p class="det-crime">${escapeHtml(detState.crime)}</p>
      <div class="det-card ${detState.isCulprit?'det-card--guilty':''}">
        ${detState.isCulprit
          ? `<p class="det-card-tag">YOUR ROLE</p><p class="det-card-text">You did it. Deny everything — convincingly.</p>`
          : `<p class="det-card-tag">YOUR ALIBI</p><p class="det-card-text">${escapeHtml(detState.myClue)}</p>`}
      </div>
      <p class="det-sub">Question everyone. When you're ready, open the floor to accusations.</p>
      ${isHost ? `<button class="det-btn" id="btn-detective-vote" type="button">Open the floor for accusations</button>` : `<p class="det-sub">Waiting on the host to open the floor…</p>`}
    `;
    if (isHost) document.getElementById('btn-detective-vote').addEventListener('click', detectiveOpenVote);
    return;
  }
  if (detState.phase === 'vote'){
    const myVote = detState.votes[myId];
    body.innerHTML = `
      <p class="det-case-label">WHO DID IT?</p>
      <div class="det-suspects">
        ${detState.order.map(id=>`<button class="det-suspect ${myVote===id?'picked':''}" data-vote="${id}">${escapeHtml(id===myId?'You':(participants[id]?.name||'…'))}</button>`).join('')}
      </div>
      <p class="det-tally">${Object.keys(detState.votes).length} of ${detState.order.length} have accused someone</p>
      ${isHost ? `<button class="det-btn det-btn--ghost" id="btn-detective-reveal" type="button">Close the case</button>` : `<p class="det-sub">Waiting on the host to close the case…</p>`}
    `;
    body.querySelectorAll('[data-vote]').forEach(btn=> btn.addEventListener('click', ()=> detectiveCastVote(btn.dataset.vote)));
    if (isHost) document.getElementById('btn-detective-reveal').addEventListener('click', detectiveReveal);
    return;
  }
  if (detState.phase === 'results'){
    const correct = Object.values(detState.votes).filter(v=>v===detState.culpritId).length;
    body.innerHTML = `
      <p class="det-case-label">CASE CLOSED</p>
      <p class="det-crime">${escapeHtml(detState.crime)}</p>
      <div class="det-board">
        ${detState.order.map((id,i)=>{
          const guilty = id===detState.culpritId;
          const tilt = (i%2?1:-1)*(2+(i*7)%5);
          return `<div class="det-pin-card ${guilty?'det-pin-card--guilty':''}" style="--tilt:${tilt}deg">
            <p class="det-pin-name">${escapeHtml(id===myId?'You':(participants[id]?.name||'…'))}</p>
            ${guilty ? '<p class="det-pin-stamp">GUILTY</p>' : ''}
          </div>`;
        }).join('')}
      </div>
      <p class="det-sub">${correct} of ${detState.order.length} named the right person</p>
      <button class="det-btn" id="btn-detective-again" type="button">Open another case</button>
    `;
    document.getElementById('btn-detective-again').addEventListener('click', detectiveStart);
  }
}
