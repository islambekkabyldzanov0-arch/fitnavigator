// ==================== STATE ====================
let S = {view:'welcome', step:0, ans:{}, user:null, tab:'workout', editingProfile:false, editingMetrics:false};
let workoutState = null;
let workoutTimer = null;
let reminderIntervals = {};
let audioPlayer = document.getElementById('global-audio');
let currentTrackIndex = -1;
let isPlaying = false;

// ==================== STORAGE ====================
function load() { try { const r = localStorage.getItem(SK); if (r) S.user = JSON.parse(r); } catch(e) {} }
function save() { if (S.user) localStorage.setItem(SK, JSON.stringify(S.user)); }
function reset() { if (!confirm('Сбросить все данные?')) return; localStorage.removeItem(SK); S = {view:'welcome',step:0,ans:{},user:null,tab:'workout'}; go(); }

// ==================== STREAK & ACHIEVEMENTS ====================
function updateStreak() {
  if (!S.user) return;
  const today = new Date().toDateString();
  const last = S.user.lastWorkoutDate ? new Date(S.user.lastWorkoutDate).toDateString() : null;
  if (!S.user.workoutHistory) S.user.workoutHistory = [];
  if (!S.user.workoutHistory.find(h => new Date(h.date).toDateString() === today)) {
    const hour = new Date().getHours();
    S.user.workoutHistory.push({date: Date.now(), focus: 'Тренировка', exercises: []});
    if (S.user.workoutHistory.length > 30) S.user.workoutHistory = S.user.workoutHistory.slice(-30);
    if (hour < 8) S.user.earlyWorkouts = (S.user.earlyWorkouts || 0) + 1;
    if (hour >= 21) S.user.lateWorkouts = (S.user.lateWorkouts || 0) + 1;
  }
  if (last !== today) {
    if (last) { const diff = Math.floor((new Date(today) - new Date(last)) / DAY_MS); S.user.streak = (diff === 1) ? (S.user.streak || 0) + 1 : 1; }
    else S.user.streak = 1;
    S.user.lastWorkoutDate = today;
  }
  S.user.totalWorkouts = (S.user.totalWorkouts || 0) + 1;
  addXP(50); addCoins(50); save();
}

function addXP(amount) {
  if (!S.user) return;
  const oldLevel = getLevelInfo(S.user.xp || 0).current.level;
  S.user.xp = (S.user.xp || 0) + amount;
  const newLevel = getLevelInfo(S.user.xp).current.level;
  if (newLevel > oldLevel) { setTimeout(() => { showAch({i:'🎉',t:'Новый уровень!',d:'Вы достигли уровня '+newLevel+'!'}); addCoins(100*newLevel); }, 1000); }
}

function addCoins(amount) { if (!S.user) return; S.user.fitCoins = (S.user.fitCoins || 0) + amount; save(); }

function checkAch() {
  if (!S.user) return [];
  const unlocked = []; const prev = S.user.achievements || [];
  ACH.forEach(a => { if (a.c(S.user) && !prev.includes(a.id)) { unlocked.push(a); addXP(a.xp); addCoins(a.coins); } });
  if (unlocked.length > 0) { S.user.achievements = [...prev, ...unlocked.map(a => a.id)]; save(); }
  return unlocked;
}

function getLevelInfo(xp) {
  let current = LEVELS[0]; let next = LEVELS[1];
  for (let i = 0; i < LEVELS.length - 1; i++) {
    if (xp >= LEVELS[i].xp && xp < LEVELS[i+1].xp) { current = LEVELS[i]; next = LEVELS[i+1]; break; }
    if (i === LEVELS.length - 2 && xp >= LEVELS[i+1].xp) { current = LEVELS[i+1]; next = {level:current.level+1,name:'Максимум',xp:Infinity,icon:'💎'}; }
  }
  const xpInLevel = xp - current.xp; const xpNeeded = next.xp - current.xp;
  return {current, next, xpInLevel, xpNeeded, progress: Math.min(100, (xpInLevel/xpNeeded)*100)};
}

// ==================== HELPERS ====================
function getTrainingSchedule(d) { return {3:[1,0,1,0,1,0,0],4:[1,0,1,0,1,0,1],5:[1,1,0,1,1,0,1],6:[1,1,1,1,1,1,0]}[d] || [1,0,1,0,1,0,0]; }
function getVisibleDays(u) {
  const ts = u.trialStart || Date.now(); const now = Date.now();
  const ds = Math.floor((now - ts) / DAY_MS); let fd = Math.max(0, 7 - ds); let sd = 0;
  if (u.subscription) { const sub = u.subscription; const sl = Math.max(0, Math.ceil((sub.unlockDate - now) / DAY_MS)); if (sub.plan === 'lifetime') return 30; if (sub.plan === 'week') sd = sl; else return Math.min(30, sl); }
  return Math.min(30, fd + sd);
}
function getSubscriptionInfo(u) {
  const ts = u.trialStart || Date.now(); const now = Date.now();
  const ds = Math.floor((now - ts) / DAY_MS); const fl = Math.max(0, 7 - ds);
  let info = {free:fl, paid:0, total:fl, type:'free', isLifetime:false};
  if (u.subscription) { const sub = u.subscription; const sl = Math.max(0, Math.ceil((sub.unlockDate - now) / DAY_MS));
    if (sub.plan === 'lifetime') { info.paid = 30; info.total = 30; info.type = 'lifetime'; info.isLifetime = true; }
    else if (sub.plan === 'week') { info.paid = sl; info.total = fl + sl; info.type = 'week'; }
    else if (sub.plan === 'month') { info.paid = Math.min(30, sl); info.total = Math.min(30, sl); info.type = 'month'; }
    else if (sub.plan === 'year') { info.paid = Math.min(30, sl); info.total = Math.min(30, sl); info.type = 'year'; }
  }
  return info;
}
function getRestTime(w) { if (w === 'heavy') return 180; if (w === 'light') return 170; return 150; }
function formatTime(s) { const m = Math.floor(s / 60); const sec = s % 60; return m + ':' + sec.toString().padStart(2, '0'); }
function getCoachTip(context) { const tips = COACH_TIPS[context] || COACH_TIPS.motivation; return tips[Math.floor(Math.random() * tips.length)]; }
function daysLeft(ts) { return Math.max(0, Math.ceil((ts + TRIAL - Date.now()) / DAY_MS)); }

// ==================== PLAN GENERATION ====================
function genDayWorkout(dayOffset, qd) {
  const a = qd || {}; const pool = a.loc === 'gym' ? GYM : HOME;
  const foc = ['Грудь, трицепс','Спина, бицепс','Ноги, ягодицы','Плечи, пресс','Фулбоди','Кардио + Кор','Всё тело'];
  const days = +a.days || 3; const sched = getTrainingSchedule(days);
  const diw = dayOffset % 7; const isRest = !sched[diw];
  if (isRest) return {rest:true, focus:'Отдых', exercises:[]};
  const seed = dayOffset; const pr = (s,i) => ((s*9301+49297+i*233)%233280)/233280;
  const ec = {3:6,4:5,5:5,6:4}[days] || 5;
  let ex = [], used = new Set();
  for (let i = 0; i < ec; i++) { let idx = Math.floor(pr(seed,i)*pool.length), att = 0; while (used.has(idx) && att < pool.length) { idx = (idx+1) % pool.length; att++; } used.add(idx); ex.push({...pool[idx], rest: getRestTime(pool[idx].weight)}); }
  if (a.int === 'low') ex = ex.map(e => ({...e, rest: e.rest + 30}));
  if (a.int === 'high') ex = ex.map(e => ({...e, r: e.r.replace('10-12','8-10').replace('12-15','10-12')}));
  if (a.exp === 'beg') ex = ex.map(e => ({...e, s: Math.max(2, e.s - 1)}));
  if (a.goal === 'cut' || a.goal === 'tone') { const ce = CARDIO[Math.floor(pr(seed,100)*CARDIO.length)]; ex.push({n:ce.n,s:1,r:'15-20 мин',rest:getRestTime(ce.weight),m:'Кардио',isCardio:true,e:ce.e,t:ce.t,y:ce.y,startPos:ce.startPos,endPos:ce.endPos,weight:ce.weight}); }
  return {rest:false, focus: foc[diw % foc.length], exercises: ex};
}

function genMetrics(qd) {
  const a = qd || {}; const w = +a.cw||70, h = +a.height||170, age = +a.age||30, g = a.gender||'male', goal = a.goal||'tone';
  const bmr = Math.round(10*w + 6.25*h - 5*age + (g==='female'?-161:5));
  const mult = {sed:1.2, light:1.375, mod:1.55, high:1.725};
  const tdee = Math.round(bmr * (mult[a.act] || 1.2));
  let gc = 'maintain', tc = tdee;
  if (goal === 'cut') { gc = 'lose'; tc = Math.round(tdee * 0.85); }
  else if (goal === 'gain') { gc = 'gain'; tc = Math.round(tdee * 1.125); }
  const tw = gc === 'lose' ? w - 10 : gc === 'gain' ? w + 5 : w;
  const p = Math.round(tw * (g==='female'?1.8:2.0)), f = Math.round(tw * 0.9), c = Math.max(0, Math.round((tc - p*4 - f*9) / 4));
  return {bmr, tdee, targetCalories:tc, goalCategory:gc, protein:p, fats:f, carbs:c};
}

function genMeals(qd) {
  const metrics = genMetrics(qd);
  const pick = (arr, t) => arr.reduce((b,c) => Math.abs(c.kcal-t) < Math.abs(b.kcal-t) ? c : b, arr[0]);
  const tg = {breakfast:Math.round(metrics.targetCalories*0.3), lunch:Math.round(metrics.targetCalories*0.4), dinner:Math.round(metrics.targetCalories*0.25), snack:Math.round(metrics.targetCalories*0.05)};
  const result = {
    breakfast: {sel:{...pick(MEALS.breakfast,tg.breakfast),portion:100}, opts:MEALS.breakfast.map(m=>({...m,portion:100}))},
    lunch: {sel:{...pick(MEALS.lunch,tg.lunch),portion:100}, opts:MEALS.lunch.map(m=>({...m,portion:100}))},
    dinner: {sel:{...pick(MEALS.dinner,tg.dinner),portion:100}, opts:MEALS.dinner.map(m=>({...m,portion:100}))},
    snack: {sel:{...pick(MEALS.snack,tg.snack),portion:100}, opts:MEALS.snack.map(m=>({...m,portion:100}))}
  };
  if (S.user && S.user.mealsSelected) { Object.keys(S.user.mealsSelected).forEach(cat => { const mealId = S.user.mealsSelected[cat]; const meal = MEALS[cat].find(m => m.id === mealId); if (meal) result[cat].sel = {...meal, portion: S.user.mealsPortions?.[cat] || 100}; }); }
  return result;
}

// ==================== MUSIC ====================
function initMusicPlayer() {
  if (!S.user) return;
  if (!S.user.tracks) S.user.tracks = [];
  audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration) {
      const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
      document.querySelectorAll('.music-progress-fill,.mini-progress-fill').forEach(f => f.style.width = progress + '%');
      document.querySelectorAll('.music-time').forEach(t => t.textContent = formatTime(Math.floor(audioPlayer.currentTime)));
    }
  });
  audioPlayer.addEventListener('ended', () => { if (currentTrackIndex < S.user.tracks.length - 1) playTrack(currentTrackIndex + 1); else { isPlaying = false; updatePlayButton(); } });
}

function handleFileUpload(e) {
  const files = Array.from(e.target.files); if (!files.length) return;
  files.forEach(file => {
    if (!file.type.startsWith('audio/')) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      const track = {id:Date.now()+Math.random(), name:file.name.replace(/\.[^/.]+$/,''), duration:0, data:ev.target.result};
      const tempAudio = new Audio(ev.target.result);
      tempAudio.addEventListener('loadedmetadata', () => { track.duration = tempAudio.duration; if (!S.user.tracks) S.user.tracks = []; S.user.tracks.push(track); save(); renderMusicTab(); toast('🎵 Трек добавлен: ' + track.name); });
    };
    reader.readAsDataURL(file);
  });
}

function handleAvatarUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) { S.user.avatar = ev.target.result; save(); toast('✅ Фото профиля обновлено!'); go(); };
  reader.readAsDataURL(file);
}

function playTrack(index) { if (!S.user.tracks || !S.user.tracks[index]) return; currentTrackIndex = index; const track = S.user.tracks[index]; audioPlayer.src = track.data; audioPlayer.play(); isPlaying = true; updatePlayButton(); updateMiniPlayer(); renderMusicTab(); }
function togglePlay() { if (currentTrackIndex === -1 && S.user.tracks && S.user.tracks.length > 0) { playTrack(0); return; } if (isPlaying) { audioPlayer.pause(); isPlaying = false; } else { audioPlayer.play(); isPlaying = true; } updatePlayButton(); }
function updatePlayButton() { document.querySelectorAll('[data-action="toggle-play"]').forEach(btn => btn.textContent = isPlaying ? '⏸' : '▶'); }
function updateMiniPlayer() { const mini = document.getElementById('mini-player'); if (!mini) return; if (currentTrackIndex === -1 || !S.user.tracks || !S.user.tracks[currentTrackIndex]) { mini.classList.add('hidden'); return; } const track = S.user.tracks[currentTrackIndex]; mini.classList.remove('hidden'); document.getElementById('mini-track-name').textContent = track.name; document.getElementById('mini-track-artist').textContent = formatTime(track.duration); }
function deleteTrack(id, e) { e.stopPropagation(); if (!confirm('Удалить этот трек?')) return; S.user.tracks = S.user.tracks.filter(t => t.id !== id); save(); if (currentTrackIndex >= S.user.tracks.length) { currentTrackIndex = -1; audioPlayer.pause(); isPlaying = false; updateMiniPlayer(); } renderMusicTab(); toast('🗑️ Трек удалён'); }
function seekAudio(e) { if (!audioPlayer.duration) return; const rect = e.currentTarget.getBoundingClientRect(); const pos = (e.clientX - rect.left) / rect.width; audioPlayer.currentTime = pos * audioPlayer.duration; }

function renderMusicTab() {
  const tracks = S.user.tracks || [];
  let h = '<div class="card"><h3 style="margin-bottom:16px">🎵 Музыкальный плеер</h3>';
  h += '<div class="file-upload"><button class="btn btn-fire">📁 Загрузить MP3<input type="file" accept="audio/*" multiple onchange="handleFileUpload(event)"></button></div>';
  if (tracks.length === 0) { h += '<div class="center muted" style="padding:40px 0">Нет треков. Загрузите MP3 файлы.</div>'; }
  else {
    h += '<div class="music-player"><div class="music-controls">';
    h += '<button class="music-btn" data-action="toggle-play">' + (isPlaying ? '⏸' : '▶') + '</button>';
    h += '<div class="music-progress"><div class="music-progress-fill"></div></div><div class="music-time">0:00</div></div><div class="track-list">';
    tracks.forEach((track, idx) => {
      const isActive = idx === currentTrackIndex;
      h += '<div class="track-item '+(isActive?'active':'')+'" onclick="playTrack('+idx+')"><div class="track-icon">🎵</div><div class="track-info"><div class="track-name">'+track.name+'</div><div class="track-duration">'+formatTime(track.duration)+'</div></div><div class="track-delete" onclick="deleteTrack('+track.id+',event)">✕</div></div>';
    });
    h += '</div></div>';
  }
  return h + '</div>';
}

// ==================== ROUTER ====================
function go() {
  const app = document.getElementById('app');
  if (!S.user) {
    if (S.view === 'quiz') { app.innerHTML = rQuiz(); bQuiz(); }
    else if (S.view === 'reg') { app.innerHTML = rReg(); bReg(); }
    else { app.innerHTML = rWelcome(); bWelcome(); }
  } else {
    if (S.view === 'pay') { app.innerHTML = rPay(); bPay(); }
    else { app.innerHTML = rDash(); bDash(); }
  }
}

// ==================== RENDER FUNCTIONS ====================
function rWelcome() {
  return '<div class="card glass center" style="padding:48px 24px;margin-top:40px"><div style="font-size:56px;margin-bottom:20px" class="grad">🧭</div>' +
    '<h2 style="font-size:26px;margin-bottom:12px;font-weight:900">ФитНавигатор</h2>' +
    '<p class="muted" style="font-size:15px;line-height:1.7;margin-bottom:32px">Персональные тренировки + питание на основе ИИ. Начни бесплатно.</p>' +
    '<ul style="text-align:left;margin:0 auto 28px;max-width:320px;color:var(--text2);font-size:14px;list-style:none">' +
    '<li style="margin-bottom:8px">✓ Адаптивные тренировки (силовые + кардио)</li>' +
    '<li style="margin-bottom:8px">✓ Детальные гиды: исходное и конечное положение</li>' +
    '<li style="margin-bottom:8px">✓ Рацион из натуральных продуктов</li>' +
    '<li style="margin-bottom:8px">✓ ИИ-коуч с персональными советами</li>' +
    '<li style="margin-bottom:8px">✓ Система уровней и FitCoins</li>' +
    '<li>✓ 7 дней бесплатно • без обязательств</li></ul>' +
    '<button class="btn btn-fire" onclick="S.view=\'quiz\';go()">🔥 Начать →</button></div>';
}
function bWelcome() { document.getElementById('bstart').onclick = () => { S.view = 'quiz'; go(); }; }

function rQuiz() {
  const q = QS[S.step]; const pct = ((S.step+1)/QS.length)*100; let body = '';
  if (q.type === 'n') { const val = S.ans[q.k] || ''; body = '<input type="number" class="inp" id="qnum" min="'+q.min+'" max="'+q.max+'" placeholder="'+q.p+'" value="'+val+'">'; if (q.h) body += '<div class="sm muted" style="margin-top:-8px;margin-bottom:16px">'+q.h+'</div>'; }
  else { body = '<div>'; q.o.forEach(o => { const sel = S.ans[q.k] === o.v ? 'sel' : ''; body += '<label class="chip '+sel+'" data-v="'+o.v+'"><input type="radio" name="'+q.k+'" value="'+o.v+'" '+(sel?'checked':'')+'><span style="font-size:24px">'+o.e+'</span><span>'+o.t+'</span></label>'; }); body += '</div>'; }
  const last = S.step === QS.length - 1;
  return '<div class="card"><div class="prog"><div class="prog-f" style="width:'+pct+'%"></div></div>' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">' +
    '<div style="background:var(--grad);color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px">'+(S.step+1)+'</div>' +
    '<div style="font-size:18px;font-weight:700">'+q.t+'</div></div>' + body +
    '<div class="flex jb" style="gap:12px;margin-top:24px">' +
    (S.step > 0 ? '<button class="btn btn-g btn-s" onclick="S.step--;go()">← Назад</button>' : '<div></div>') +
    '<button class="btn btn-fire" id="btn-next-quiz" '+(valid()?'':'disabled')+' onclick="handleNextStep()">'+(last?'🔥 Далее: Регистрация':'🔥 Далее →')+'</button></div></div>';
}

function valid() {
  const q = QS[S.step]; let ok = false;
  if (q.type === 'n') { const v = parseFloat(S.ans[q.k]); ok = !isNaN(v) && v >= q.min && v <= q.max; if (q.k === 'tw' && S.ans.cw) ok = ok && Math.abs(v - parseFloat(S.ans.cw)) <= 50; }
  else { ok = !!S.ans[q.k]; }
  return ok;
}
function updateNextBtnState() { const btn = document.getElementById('btn-next-quiz'); if (btn) btn.disabled = !valid(); }
function handleNextStep() { if (valid()) { if (S.step < QS.length - 1) { S.step++; go(); } else { S.view = 'reg'; go(); } } }

function bQuiz() {
  document.querySelectorAll('.chip').forEach(ch => { ch.onclick = function() { S.ans[QS[S.step].k] = this.getAttribute('data-v'); document.querySelectorAll('.chip').forEach(c => c.classList.remove('sel')); this.classList.add('sel'); this.querySelector('input').checked = true; updateNextBtnState(); }; });
  const ni = document.getElementById('qnum'); if (ni) ni.addEventListener('input', function() { S.ans[QS[S.step].k] = this.value; updateNextBtnState(); });
  updateNextBtnState();
}

window.doRegister = function() {
  try {
    const fnInput = document.getElementById('rfname'); const emInput = document.getElementById('remail');
    if (!fnInput || !emInput) { toast('❌ Ошибка интерфейса'); return; }
    const fn = fnInput.value.trim(); const em = emInput.value.trim();
    if (!fn) { toast('⚠️ Введите имя!'); fnInput.focus(); return; }
    toast('⏳ Создание профиля...');
    S.user = {firstName:fn, email:em, streak:0, totalWorkouts:0, lastWorkoutDate:null, workoutHistory:[], waterToday:0, waterDate:new Date().toDateString(), waterStreak:0, achievements:[], trialStart:Date.now(), trialAccepted:false, quizData:S.ans?{...S.ans}:{}, reminders:{workout:{enabled:true,time:'09:00'},water:{enabled:true}}, mealsSelected:{}, mealsPortions:{}, tracks:[], xp:0, fitCoins:0, avatar:null, earlyWorkouts:0, lateWorkouts:0, lastPlanUpdate:new Date().toDateString()};
    save(); toast('🎉 Профиль создан!'); S.view = 'dash'; S.tab = 'workout';
    setTimeout(() => { go(); setTimeout(showTrial, 600); }, 400);
  } catch(error) { console.error(error); toast('❌ Ошибка: ' + error.message); }
}

function rReg() {
  return '<div class="card" style="max-width:500px;margin:40px auto;position:relative;z-index:100">' +
    '<h2 class="center" style="font-size:22px;margin-bottom:8px">🔐 Создание профиля</h2>' +
    '<p class="center muted" style="margin-bottom:20px">Последний шаг перед генерацией плана</p>' +
    '<input type="text" class="inp" id="rfname" placeholder="Ваше имя">' +
    '<input type="text" class="inp" id="remail" placeholder="Email (необязательно)">' +
    '<button class="btn btn-fire" onclick="window.doRegister()">🔥 Создать профиль 🤖</button></div>';
}

function rDash() {
  const u = S.user; const metrics = genMetrics(u.quizData); const streak = u.streak || 0;
  const gt = {lose:'Похудение 🔥',maintain:'Поддержание ⚖️',gain:'Набор массы 💪'}[metrics.goalCategory];
  const info = getSubscriptionInfo(u); const dl = u.trialStart ? daysLeft(u.trialStart) : 0;
  const te = u.trialStart ? new Date(u.trialStart + TRIAL).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) : '';
  const levelInfo = getLevelInfo(u.xp || 0);
  let h = '<div class="header"><div class="grad" style="font-size:20px;font-weight:900">🧭 ФитНавигатор</div>' +
    '<div class="flex ic gap"><div class="streak streak-fire"><span class="f">🔥</span>'+streak+' дн.</div>' +
    '<div class="coins-display"><span class="coins-icon">💰</span>'+(u.fitCoins||0)+'</div>' +
    '<div class="user-pill" onclick="S.tab=\'profile\';go()"><div class="user-av">'+(u.avatar?'<img src="'+u.avatar+'">':(u.firstName?u.firstName[0].toUpperCase():'U'))+'</div>' +
    '<div class="sm" style="font-weight:600">'+(u.firstName||'User')+'</div></div></div></div>';
  h += '<div class="level-bar"><div class="level-header"><div class="level-badge"><div class="level-icon">'+levelInfo.current.icon+'</div><div class="level-info"><div class="level-name">Уровень '+levelInfo.current.level+': '+levelInfo.current.name+'</div><div class="level-xp">'+levelInfo.xpInLevel+' / '+levelInfo.xpNeeded+' XP</div></div></div></div><div class="xp-bar"><div class="xp-bar-fill" style="width:'+levelInfo.progress+'%"></div></div></div>';
  const hour = new Date().getHours(); let coachContext = 'motivation'; if (hour < 12) coachContext = 'morning'; else if (hour < 18) coachContext = 'afternoon'; else coachContext = 'evening';
  h += '<div class="coach-card"><div class="coach-header"><div class="coach-avatar">🤖</div><div><div class="coach-name">ИИ-Коуч</div><div class="coach-subtitle">Персональный совет дня</div></div></div><div class="coach-tip">'+getCoachTip(coachContext)+'</div></div>';
  if (info.isLifetime) { h += '<div class="card glass" style="border-color:var(--gold);background:linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.05))"><div class="flex ic gap"><div style="font-size:32px">💎</div><div style="flex:1"><strong style="color:var(--gold);font-size:16px">Подписка "Навсегда" активна</strong><p class="sm" style="margin-top:4px;color:var(--text)">Безграничное количество тренировок</p></div></div></div>'; }
  else if (info.free > 0) { h += '<div class="card glass" style="border-color:var(--ok)"><div class="flex ic gap"><div style="font-size:24px">🎁</div><div style="flex:1"><strong style="color:var(--ok)">'+info.free+' бесплатных дней осталось!</strong><p class="sm muted" style="margin-top:2px">Доступ до '+te+'</p></div><span class="streak" style="background:rgba(16,185,129,.15);color:var(--ok);border-color:rgba(16,185,129,.3)">'+info.free+' дн</span></div></div>'; }
  if (info.paid > 0 && !info.isLifetime) { const tl = {week:'Неделя',month:'Месяц',year:'Год'}; h += '<div class="card glass" style="border-color:var(--v)"><div class="flex ic gap"><div style="font-size:24px">✨</div><div style="flex:1"><strong style="color:var(--v)">Подписка "'+tl[info.type]+'" активна</strong><p class="sm muted" style="margin-top:2px">Доступно ещё '+info.paid+' дней</p></div></div></div>'; }
  if (info.total === 0 && !info.isLifetime) { h += '<div class="card glass" style="border-color:var(--err)"><div class="flex ic gap"><div style="font-size:24px">🔒</div><div style="flex:1"><strong style="color:var(--err)">Пробный период завершён</strong><p class="sm muted" style="margin-top:2px">Продлите подписку</p></div><button class="btn btn-fire btn-s" onclick="S.view=\'pay\';go()">🔥 Продлить</button></div></div>'; }
  h += '<div class="tabs"><div class="tab '+(S.tab==='workout'?'on':'')+'" data-t="workout">🏋️ Тренировки</div><div class="tab '+(S.tab==='nutrition'?'on':'')+'" data-t="nutrition">🥗 Питание</div><div class="tab '+(S.tab==='progress'?'on':'')+'" data-t="progress">📊 Прогресс</div><div class="tab '+(S.tab==='music'?'on':'')+'" data-t="music">🎵 Музыка</div><div class="tab '+(S.tab==='profile'?'on':'')+'" data-t="profile">⚙️ Профиль</div></div>';
  h += '<div id="tc">' + tabContent() + '</div>';
  return h;
}

function tabContent() { if (S.tab==='workout') return rWork(); if (S.tab==='nutrition') return rNutr(); if (S.tab==='progress') return rProg(); if (S.tab==='music') return renderMusicTab(); if (S.tab==='profile') return rProf(); return ''; }

function rWork() {
  const u = S.user; const metrics = genMetrics(u.quizData);
  const gt = {lose:'Похудение 🔥',maintain:'Поддержание ⚖️',gain:'Набор массы 💪'}[metrics.goalCategory];
  const info = getSubscriptionInfo(u); const visibleDays = getVisibleDays(u);
  const today = new Date(); today.setHours(0,0,0,0);
  let h = '<div class="main-layout"><div class="sidebar"><div class="card"><h3 style="font-size:16px;margin-bottom:16px">📜 История тренировок</h3>';
  const history = (u.workoutHistory || []).slice(-30).reverse();
  if (history.length === 0) h += '<p class="sm muted">Пока нет тренировок.</p>';
  else history.forEach(item => { const date = new Date(item.date); h += '<div class="history-item"><div class="history-date">'+date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'})+'</div><div class="history-info"><div class="history-focus">'+(item.focus||'Тренировка')+'</div></div></div>'; });
  h += '</div></div><div class="main-content"><div class="card"><div class="flex ic jb" style="margin-bottom:16px"><h2 style="font-size:20px">📊 Ваши показатели</h2><button class="btn btn-g btn-s" onclick="exportPlan()">📄 Экспорт</button></div>' +
    '<div class="calorie-banner"><div class="label">ВАША ДНЕВНАЯ НОРМА</div><div class="value">'+metrics.targetCalories.toLocaleString('ru-RU')+' ккал</div><div class="sub">Для достижения цели: <strong>'+gt+'</strong></div></div>' +
    '<div class="metrics-container"><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+metrics.protein+'г</span></div><div class="metric-label">Белки</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+metrics.fats+'г</span></div><div class="metric-label">Жиры</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+metrics.carbs+'г</span></div><div class="metric-label">Углеводы</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+metrics.tdee+'</span></div><div class="metric-label">TDEE (расход)</div></div></div></div>';
  if (info.isLifetime) h += '<div class="card glass" style="text-align:center;padding:20px"><p class="sm"><strong style="color:var(--gold)">💎 Безграничный доступ</strong> — все тренировки доступны навсегда!</p></div>';
  else if (visibleDays > 0) h += '<div class="card glass" style="text-align:center;padding:16px"><p class="sm">📅 Доступно тренировок: <strong style="color:var(--v)">'+visibleDays+' дней</strong></p></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">📅 План тренировок на 30 дней</h3>';
  for (let i = 0; i < Math.min(visibleDays, 30); i++) {
    const date = new Date(today.getTime() + i * DAY_MS); const isUnlocked = i < visibleDays; const isToday = i === 0;
    const dayName = DAY_NAMES[date.getDay() === 0 ? 6 : date.getDay() - 1];
    const dateStr = date.toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
    const workout = genDayWorkout(i, u.quizData);
    if (!isUnlocked) { h += '<div class="day locked"><h4><span>'+dayName+'</span> <span class="day-date">'+dateStr+'</span></h4><p class="sm muted">🔒 Доступно после подписки</p></div>'; continue; }
    if (workout.rest) { h += '<div class="day rest '+(isToday?'today':'')+'"><h4><span>☾ '+dayName+': Отдых</span> <span class="day-date">'+dateStr+'</span></h4><div style="padding:12px;background:rgba(16,185,129,.1);border-radius:12px;margin-top:12px"><div class="flex ic gap"><span style="font-size:24px">🚶</span><div><strong style="color:var(--ok)">Прогулка и растяжка</strong><br><span class="sm">Легкая активность для восстановления</span></div></div></div></div>'; }
    else {
      h += '<div class="day '+(isToday?'today':'')+'"><h4><span>▸ '+dayName+': '+workout.focus+'</span> <span class="day-date">'+dateStr+'</span></h4>';
      workout.exercises.forEach((e, ei) => { const restDisplay = formatTime(e.rest);
        h += '<div class="ex"><div class="ex-name">'+(e.e||'💪')+' '+e.n+' '+(e.isCardio?'<span class="tag tag-c">Кардио</span>':'<span class="tag tag-s">Сила</span>')+' <button class="btn btn-g btn-s" style="padding:4px 10px;font-size:11px;margin-left:8px" onclick="togM('+i+','+ei+')">📺 Гид</button></div><div class="ex-meta"><strong>'+e.s+'×'+e.r+'</strong><br><span class="xs">отдых '+restDisplay+'</span></div></div>' +
          '<div class="hide" id="em-'+i+'-'+ei+'" style="background:var(--bg);border-radius:12px;padding:12px;margin:8px 0;border:1px solid var(--border)"><div class="wo-pos-box"><div class="wo-pos-title start">🟢 Исходное</div><div class="wo-pos-text">'+(e.startPos||'Следите за дыханием.')+'</div></div><div class="wo-pos-box"><div class="wo-pos-title end">🎯 Конечное</div><div class="wo-pos-text">'+(e.endPos||'Удерживайте положение.')+'</div></div><a class="yt-btn" href="https://rutube.ru/search/?query='+encodeURIComponent(e.y||e.n+' техника')+'" target="_blank" rel="noopener">▶ Смотреть на RUTUBE</a></div>';
      });
      h += '<div class="day-actions"><button class="btn btn-fire" onclick="startWorkout('+i+')">▶ Начать тренировку</button></div></div>';
    }
  }
  h += '</div><div class="card glass center" style="border-color:var(--c)"><p class="sm muted" style="margin-bottom:16px">Хотите больше тренировок? <strong>Продлите доступ</strong>.</p><button class="btn btn-fire" onclick="S.view=\'pay\';go()">🔥 Посмотреть тарифы</button></div></div>';
  h += '<div class="sidebar"><div class="card"><h3 style="font-size:16px;margin-bottom:16px">🏆 Топ-100</h3>';
  const leaderboard = generateLeaderboard();
  leaderboard.slice(0, 100).forEach((item, idx) => {
    h += '<div class="leaderboard-item"><div class="leaderboard-rank">#'+(idx+1)+'</div><div class="leaderboard-avatar">'+item.name[0]+'</div><div class="leaderboard-info"><div class="leaderboard-name">'+item.name+'</div><div class="leaderboard-streak">🔥 '+item.streak+' дн.</div><div class="leaderboard-achievements">';
    item.achievements.forEach(ach => { h += '<div class="leaderboard-ach" title="'+ach.t+'">'+ach.i+'</div>'; });
    h += '</div></div></div>';
  });
  return h + '</div></div></div>';
}

function togM(di, ei) { const el = document.getElementById('em-'+di+'-'+ei); if (el) el.classList.toggle('hide'); }

// ==================== WORKOUT MODE ====================
function startWorkout(dayIndex) {
  const u = S.user; const today = new Date(); today.setHours(0,0,0,0);
  const date = new Date(today.getTime() + dayIndex * DAY_MS);
  const workout = genDayWorkout(dayIndex, u.quizData);
  if (!workout || workout.rest || workout.exercises.length === 0) { toast('⚠️ Нет упражнений'); return; }
  workoutState = {dayIndex:dayIndex, dayName:DAY_NAMES[date.getDay()===0?6:date.getDay()-1], focus:workout.focus, exercises:workout.exercises, currentEx:0, currentSet:1, phase:'exercise', restTime:0, restDuration:150, completedSets:0, skippedExercises:0, startTime:Date.now()};
  renderWorkoutMode();
}

function renderWorkoutMode() {
  const ws = workoutState; const container = document.getElementById('workout-mode');
  if (ws.phase === 'complete') {
    const duration = Math.floor((Date.now() - ws.startTime) / 1000); const mins = Math.floor(duration / 60); const secs = duration % 60;
    container.innerHTML = '<div class="workout-mode"><div class="workout-body"><div class="workout-complete"><div class="workout-complete-icon">🏆</div><div class="workout-complete-title">Тренировка завершена!</div><p class="muted">Отличная работа! +50 XP +50 FitCoins</p><div class="workout-complete-stats"><div class="workout-stat"><div class="workout-stat-value">'+mins+':'+secs.toString().padStart(2,'0')+'</div><div class="workout-stat-label">Время</div></div><div class="workout-stat"><div class="workout-stat-value">'+ws.completedSets+'</div><div class="workout-stat-label">Подходов</div></div><div class="workout-stat"><div class="workout-stat-value">'+ws.exercises.length+'</div><div class="workout-stat-label">Упражнений</div></div></div><button class="btn btn-fire" onclick="finishWorkout()">✅ Завершить и сохранить</button></div></div></div>';
    return;
  }
  if (ws.phase === 'confirm') {
    container.innerHTML = '<div class="workout-mode"><div class="workout-body" style="display:flex;align-items:center;justify-content:center;min-height:80vh"><div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r2);padding:28px;max-width:400px;width:100%;text-align:center"><div style="font-size:20px;font-weight:700;margin-bottom:12px">💪 Подход выполнен?</div><div style="font-size:14px;color:var(--text2);margin-bottom:24px">Вы выполнили подход '+(ws.currentSet-1)+' из '+ws.exercises[ws.currentEx].s+'</div><div class="flex gap" style="gap:12px"><button class="btn btn-g" onclick="redoSet()">🔄 Повторить</button><button class="btn btn-ok" onclick="confirmSet()">✓ Да, отдых</button></div></div></div></div>';
    return;
  }
  const ex = ws.exercises[ws.currentEx]; const totalEx = ws.exercises.length;
  const progress = ((ws.currentEx) / totalEx) * 100; let content = '';
  if (ws.phase === 'rest') {
    const circ = 2 * Math.PI * 90; const offset = circ * (1 - ws.restTime / ws.restDuration);
    const restDisplay = formatTime(ws.restTime); const restTotalDisplay = formatTime(ws.restDuration);
    content = '<div class="workout-exercise-card"><div style="text-align:center;font-size:14px;color:var(--text2);margin-bottom:8px">ОТДЫХ МЕЖДУ ПОДХОДАМИ</div><div class="rest-info-display"><div class="label">Время отдыха</div><div class="value">'+restTotalDisplay+'</div></div><div class="rest-timer"><svg viewBox="0 0 200 200"><defs><linearGradient id="tg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff6b35"/><stop offset="100%" stop-color="#ffcc00"/></linearGradient></defs><circle style="fill:none;stroke:var(--border);stroke-width:10" cx="100" cy="100" r="90"/><circle id="rest-fg" style="fill:none;stroke:url(#tg);stroke-width:10;stroke-linecap:round;transition:stroke-dashoffset 1s linear" cx="100" cy="100" r="90" stroke-dasharray="'+circ+'" stroke-dashoffset="'+offset+'"/></svg><div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><div id="rest-timer-display" style="font-size:48px;font-weight:900;background:var(--grad);-webkit-background-clip:text;-webkit-text-fill-color:transparent">'+restDisplay+'</div><div style="font-size:12px;color:var(--text2);text-transform:uppercase;letter-spacing:.1em;margin-top:4px">секунд</div></div></div><div class="workout-actions"><button class="btn btn-ok" onclick="skipRest()">⏭ Пропустить отдых</button></div></div>';
  } else {
    const restDisplay = formatTime(ex.rest);
    content = '<div class="workout-exercise-card"><div style="text-align:center;font-size:14px;color:var(--text2);margin-bottom:8px">УПРАЖНЕНИЕ '+(ws.currentEx+1)+' ИЗ '+totalEx+'</div><div style="font-size:48px;margin-bottom:8px">'+ex.e+'</div><div class="workout-exercise-name">'+ex.n+'</div><div class="workout-exercise-muscle">'+ex.m+'</div><div class="workout-exercise-params"><div class="workout-param"><div class="workout-param-label">Подход</div><div class="workout-param-value">'+ws.currentSet+' / '+ex.s+'</div></div><div class="workout-param"><div class="workout-param-label">Повторения</div><div class="workout-param-value">'+ex.r+'</div></div><div class="workout-param"><div class="workout-param-label">Отдых</div><div class="workout-param-value">'+restDisplay+'</div></div></div><div class="wo-pos-box"><div class="wo-pos-title start">🟢 Исходное</div><div class="wo-pos-text">'+(ex.startPos||'Следите за дыханием.')+'</div></div><div class="wo-pos-box"><div class="wo-pos-title end">🎯 Конечное</div><div class="wo-pos-text">'+(ex.endPos||'Удерживайте положение.')+'</div></div><a class="yt-btn" href="https://rutube.ru/search/?query='+encodeURIComponent(ex.y||ex.n+' техника')+'" target="_blank" rel="noopener" style="display:block;text-align:center;margin-bottom:16px">▶ Смотреть на RUTUBE</a><div class="workout-actions"><button class="btn btn-ok" onclick="completeSet()">✓ Подход выполнен</button><button class="btn btn-g" onclick="skipExercise()">⏭ Пропустить</button></div></div>';
  }
  container.innerHTML = '<div class="workout-mode"><div class="workout-header"><button class="btn btn-g btn-s" onclick="exitWorkout()">✕ Выйти</button><div class="workout-title">'+ws.dayName+': '+ws.focus+'</div><div style="width:80px"></div></div><div class="workout-body"><div class="workout-progress"><div class="workout-progress-text"><span>Прогресс</span><span>'+Math.round(progress)+'%</span></div><div class="prog"><div class="prog-f" style="width:'+progress+'%"></div></div></div>'+content+'</div></div>';
  if (ws.phase === 'rest') startRestTimer();
}

function startRestTimer() { if (workoutTimer) clearInterval(workoutTimer); const ex = workoutState.exercises[workoutState.currentEx]; workoutState.restDuration = ex.rest || 150; workoutState.restTime = workoutState.restDuration; updateRestTimerDisplay(); workoutTimer = setInterval(() => { workoutState.restTime--; updateRestTimerDisplay(); if (workoutState.restTime <= 0) { clearInterval(workoutTimer); workoutTimer = null; playSound('complete'); nextSet(); } }, 1000); }
function updateRestTimerDisplay() { const display = document.getElementById('rest-timer-display'); if (display) display.textContent = formatTime(workoutState.restTime); const circ = 2 * Math.PI * 90; const offset = circ * (1 - workoutState.restTime / workoutState.restDuration); const fg = document.getElementById('rest-fg'); if (fg) fg.style.strokeDashoffset = offset; }
function playSound(type) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = type === 'complete' ? 880 : 800; osc.type = 'sine'; gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5); osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5); } catch(e) {} }
function completeSet() { workoutState.completedSets++; workoutState.currentSet++; workoutState.phase = 'confirm'; renderWorkoutMode(); }
function redoSet() { workoutState.currentSet--; workoutState.completedSets--; workoutState.phase = 'exercise'; renderWorkoutMode(); }
function confirmSet() { const ws = workoutState; const ex = ws.exercises[ws.currentEx]; if (ws.currentSet <= ex.s) { ws.phase = 'rest'; renderWorkoutMode(); } else nextExercise(); }
function nextSet() { const ws = workoutState; const ex = ws.exercises[ws.currentEx]; if (ws.currentSet < ex.s) { ws.phase = 'rest'; renderWorkoutMode(); } else nextExercise(); }
function skipExercise() { workoutState.skippedExercises++; workoutState.currentEx++; workoutState.currentSet = 1; if (workoutState.currentEx >= workoutState.exercises.length) { workoutState.phase = 'complete'; playSound('complete'); renderWorkoutMode(); } else { workoutState.phase = 'exercise'; renderWorkoutMode(); } }
function nextExercise() { const ws = workoutState; ws.currentEx++; ws.currentSet = 1; if (ws.currentEx >= ws.exercises.length) { ws.phase = 'complete'; playSound('complete'); renderWorkoutMode(); } else { ws.phase = 'exercise'; renderWorkoutMode(); } }
function skipRest() { if (workoutTimer) clearInterval(workoutTimer); workoutTimer = null; nextSet(); }
function exitWorkout() { if (confirm('Выйти из тренировки?')) { if (workoutTimer) clearInterval(workoutTimer); workoutTimer = null; workoutState = null; document.getElementById('workout-mode').innerHTML = ''; } }
function finishWorkout() { updateStreak(); const na = checkAch(); if (workoutTimer) clearInterval(workoutTimer); workoutTimer = null; workoutState = null; document.getElementById('workout-mode').innerHTML = ''; toast('🏆 Тренировка сохранена! +50 XP +50 💰'); go(); if (na.length > 0) setTimeout(() => { playSound('achievement'); showAch(na[0]); }, 500); }

// ==================== NUTRITION ====================
function rNutr() {
  const meals = genMeals(S.user.quizData);
  const cats = [{k:'breakfast',t:'🌅 Завтрак'},{k:'lunch',t:'☀️ Обед'},{k:'dinner',t:'🌙 Ужин'},{k:'snack',t:'🍎 Перекус'}];
  let h = '<div class="card"><div style="margin-bottom:18px;padding:14px 18px;background:rgba(139,92,246,.1);border-radius:var(--r);border:1px solid rgba(139,92,246,.3)"><strong class="grad" style="font-size:14px">🤖 Совет ИИ-нутрициолога:</strong><p class="sm muted" style="margin-top:6px">Только натуральные продукты. Настройте порцию.</p></div>';
  cats.forEach(c => { h += rMeal(c.k, c.t, meals[c.k]); });
  return h + '</div>';
}

function rMeal(cat, title, slot) {
  const s = slot.sel; const calc = (m,p) => ({kcal:Math.round(m.kcal*p/100), p:Math.round(m.p*p/100), f:Math.round(m.f*p/100), c:Math.round(m.c*p/100)});
  const cur = calc(s, s.portion); let opts = '';
  slot.opts.forEach(o => { const isSelected = o.id === s.id;
    opts += '<label class="meal-opt '+(isSelected?'sel':'')+'" onclick="selMeal(\''+cat+'\',\''+o.id+'\')"><input type="radio" name="'+cat+'-opt" '+(isSelected?'checked':'')+'><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:14px">'+o.name+'</div><div class="xs muted" style="margin-top:2px">'+o.g+' • '+o.kcal+' ккал • Б'+o.p+'/Ж'+o.f+'/У'+o.c+'</div></div></label>';
  });
  return '<div class="meal" data-cat="'+cat+'"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:12px"><div style="flex:1"><div class="xs muted" style="text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">'+title+'</div><div class="meal-name">'+s.name+'</div><div class="meal-g">'+s.g+'</div></div><span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:linear-gradient(135deg,rgba(139,92,246,.2),rgba(34,211,238,.2));border:1px solid var(--v);border-radius:12px;font-size:10px;font-weight:600">🤖 ИИ</span></div><div class="macros" id="mc-'+cat+'"><span class="pill pill-k">🔥 '+cur.kcal+' ккал</span><span class="pill pill-p">🥩 '+cur.p+'г</span><span class="pill pill-f">🥑 '+cur.f+'г</span><span class="pill pill-c">🍚 '+cur.c+'г</span></div><div style="display:flex;align-items:center;gap:12px;margin-top:12px;padding:12px;background:var(--bg);border-radius:12px"><label class="sm muted">Порция:</label><input type="range" min="80" max="120" value="'+s.portion+'" oninput="updPortion(\''+cat+'\',this.value)" style="flex:1;accent-color:var(--v)"><span id="pv-'+cat+'" style="font-weight:700;font-size:13px;min-width:40px;text-align:right;color:var(--v)">'+s.portion+'%</span></div><div style="margin-top:16px">'+opts+'</div><button class="btn btn-g btn-s" style="margin-top:12px;color:var(--v);border-color:var(--v)" onclick="regenM(\''+cat+'\')">🔄 Другой вариант</button></div>';
}

function updPortion(cat, val) { if (!S.user.mealsPortions) S.user.mealsPortions = {}; S.user.mealsPortions[cat] = val; document.getElementById('pv-'+cat).textContent = val+'%'; const meals = genMeals(S.user.quizData); const s = meals[cat].sel; const c = v => Math.round(v*val/100); const el = document.getElementById('mc-'+cat); if (el) el.innerHTML = '<span class="pill pill-k">🔥 '+c(s.kcal)+' ккал</span><span class="pill pill-p">🥩 '+c(s.p)+'г</span><span class="pill pill-f">🥑 '+c(s.f)+'г</span><span class="pill pill-c">🍚 '+c(s.c)+'г</span>'; save(); }
function selMeal(cat, id) { if (!S.user.mealsSelected) S.user.mealsSelected = {}; S.user.mealsSelected[cat] = id; save(); const tc = document.getElementById('tc'); if (tc) { tc.innerHTML = rNutr(); bDash(); } toast('🔄 Вариант выбран'); }
function regenM(cat) { const meals = genMeals(S.user.quizData); const slot = meals[cat]; const cur = (S.user.mealsSelected && S.user.mealsSelected[cat]) || slot.sel.id; const sh = [...slot.opts].sort(() => 0.5 - Math.random()); const alt = sh.find(m => m.id !== cur) || slot.opts[0]; if (!S.user.mealsSelected) S.user.mealsSelected = {}; S.user.mealsSelected[cat] = alt.id; save(); const tc = document.getElementById('tc'); if (tc) { tc.innerHTML = rNutr(); bDash(); } toast('✨ Новый вариант'); }

// ==================== PROGRESS ====================
function rProg() {
  const u = S.user; const today = new Date().toDateString();
  if (u.waterDate !== today) { u.waterToday = 0; u.waterDate = today; save(); }
  const cal = []; for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); const ds = d.toDateString(); cal.push({ds, on:(u.workoutHistory||[]).find(h => new Date(h.date).toDateString() === ds), today: ds === today}); }
  const ul = u.achievements || [];
  let h = '<div class="card"><h3 style="margin-bottom:16px">💧 Водный баланс</h3><p class="sm muted">Выпито: <strong style="color:var(--c)">'+(u.waterToday||0)+' / 8</strong></p><div class="water-grid">';
  for (let i = 0; i < 8; i++) h += '<div class="wg '+((u.waterToday||0)>i?'on':'')+'" onclick="togW('+i+')"></div>';
  h += '</div></div><div class="card"><h3 style="margin-bottom:16px">📅 Календарь активности</h3><div class="cal-grid">';
  cal.forEach(d => { h += '<div class="cd '+(d.on?'on':'')+' '+(d.today?'today':'')+'" title="'+new Date(d.ds).toLocaleDateString('ru-RU')+'"></div>'; });
  h += '</div></div><div class="card"><h3 style="margin-bottom:16px">🏆 Достижения ('+ul.length+'/'+ACH.length+')</h3><div class="ach-grid">';
  ACH.forEach(a => { h += '<div class="ach '+(ul.includes(a.id)?'on':'off')+'"><span class="ach-i">'+a.i+'</span><div class="ach-t">'+a.t+'</div><div class="ach-d">'+a.d+'</div></div>'; });
  return h + '</div></div>';
}

function togW(i) { const u = S.user; const today = new Date().toDateString(); if (u.waterDate !== today) { u.waterToday = 0; u.waterDate = today; } u.waterToday = (u.waterToday||0) > i ? i : i + 1; if (u.waterToday >= 8) { if (!u.waterStreak) u.waterStreak = 0; u.waterStreak++; } save(); checkAch(); const tc = document.getElementById('tc'); if (tc) tc.innerHTML = rProg(); }
function showAch(a) { document.getElementById('modal').innerHTML = '<div class="modal-bg"><div class="modal center"><button class="modal-x" onclick="closeM()">✕</button><div style="font-size:72px;margin-bottom:16px">'+a.i+'</div><h3 style="font-size:22px;font-weight:800;margin-bottom:8px">Новое достижение!</h3><div class="grad" style="font-size:20px;margin-bottom:8px">'+a.t+'</div><p class="muted">'+a.d+'</p><button class="btn btn-fire" style="margin-top:20px" onclick="closeM()">🔥 Отлично!</button></div></div>'; }
function closeM() { document.getElementById('modal').innerHTML = ''; }

// ==================== PAYWALL ====================
function rPay() {
  const info = getSubscriptionInfo(S.user);
  let h = '<div class="card glass center" style="padding:36px 24px;border-color:var(--v)"><div style="font-size:44px;margin-bottom:14px">🔓</div><h2 style="font-size:23px;margin-bottom:10px">Тарифы</h2>';
  if (info.isLifetime) h += '<div class="card" style="margin-bottom:20px;border-color:var(--gold);background:linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.05))"><div class="sm"><strong style="color:var(--gold)">💎 У вас активен тариф "Навсегда"</strong></div></div>';
  else if (info.free > 0) h += '<div style="background:rgba(16,185,129,.1);padding:12px;border-radius:12px;margin-bottom:20px;border:1px solid rgba(16,185,129,.3)"><p class="sm">✨ У вас ещё есть <strong style="color:var(--ok)">'+info.free+' бесплатных дней</strong></p></div>';
  h += '<div class="pw-grid"><div class="pw-card" data-plan="week" data-price="190"><div class="pw-n">Неделя</div><div class="pw-c">190 ₽</div><div class="pw-o">999 ₽</div><div class="pw-s">−81%</div><div class="pw-days">+7 дней</div><button class="btn btn-fire btn-s" style="margin-top:12px" onclick="buyPlan(\'week\',190,this)">🔥 Выбрать</button></div><div class="pw-card" data-plan="month" data-price="299"><div class="pw-n">Месяц</div><div class="pw-c">299 ₽</div><div class="pw-o">1 490 ₽</div><div class="pw-s">−80%</div><div class="pw-days">30 дней</div><button class="btn btn-fire btn-s" style="margin-top:12px" onclick="buyPlan(\'month\',299,this)">🔥 Выбрать</button></div><div class="pw-card" data-plan="year" data-price="990"><div class="pw-n">Год</div><div class="pw-c">990 ₽</div><div class="pw-o">10 990 ₽</div><div class="pw-s">−91%</div><div class="pw-days">365 дней</div><button class="btn btn-fire btn-s" style="margin-top:12px" onclick="buyPlan(\'year\',990,this)">🔥 Выбрать</button></div><div class="pw-card hit" data-plan="lifetime" data-price="6990"><div class="pw-n">Навсегда</div><div class="pw-c">6 990 ₽</div><div class="pw-o">24 990 ₽</div><div class="pw-s">−72%</div><div class="pw-days">♾️ Безгранично</div><button class="btn btn-fire btn-s" style="margin-top:12px" onclick="buyPlan(\'lifetime\',6990,this)">🔥 Выбрать</button></div></div><p class="xs muted" style="margin-top:20px">🔒 Безопасная оплата • Отмена в любой момент</p></div><button class="btn btn-o" style="margin-top:16px" onclick="S.view=\'dash\';go()">← В личный кабинет</button>';
  return h;
}

window.buyPlan = function(plan, price, btnEl) {
  const now = Date.now(); let unlockDate;
  if (plan === 'lifetime') unlockDate = now + 36500 * DAY_MS;
  else if (plan === 'week') { const currentEnd = S.user.trialStart ? S.user.trialStart + TRIAL : now; unlockDate = Math.max(currentEnd, now) + 7 * DAY_MS; }
  else if (plan === 'month') unlockDate = now + 30 * DAY_MS;
  else if (plan === 'year') unlockDate = now + 365 * DAY_MS;
  S.user.subscription = {plan, price, startedAt:now, isActive:true, unlockDate:unlockDate}; save();
  if (btnEl) { btnEl.innerHTML = '✓ Активировано'; btnEl.style.background = 'var(--ok)'; }
  setTimeout(() => { S.view = 'dash'; S.tab = 'workout'; go(); toast('✅ Подписка "'+plan+'" активирована!'); checkAch(); }, 700);
}
function bPay() {}

// ==================== PROFILE ====================
function rProf() {
  const u = S.user; const info = getSubscriptionInfo(u);
  const typeLabels = {free:'Бесплатный',week:'Неделя',month:'Месяц',year:'Год',lifetime:'Навсегда'};
  const isEditing = S.editingProfile; const isEditingMetrics = S.editingMetrics;
  const theme = localStorage.getItem('theme') || 'dark';
  const reminders = u.reminders || {workout:{enabled:true,time:'09:00'},water:{enabled:true}};
  const daysPerWeek = +u.quizData.days || 3;
  const levelInfo = getLevelInfo(u.xp || 0);
  let h = '<div class="card"><h3 style="margin-bottom:20px">⚙️ Настройки профиля</h3><div class="profile-card"><div class="profile-avatar">'+(u.avatar?'<img src="'+u.avatar+'">':(u.firstName?u.firstName[0].toUpperCase():'U'))+'<div class="avatar-upload"><input type="file" accept="image/*" onchange="handleAvatarUpload(event)"><span style="font-size:20px">📷</span></div></div><div class="profile-info"><div class="profile-name">'+u.firstName+'</div><div class="profile-email">'+(u.email||'Email не указан')+'</div>';
  const userAchievements = u.achievements || []; const displayAch = userAchievements.slice(0, 5);
  h += '<div class="profile-achievements">'; displayAch.forEach(achId => { const ach = ACH.find(a => a.id === achId); if (ach) h += '<div class="profile-ach" title="'+ach.t+'">'+ach.i+'</div>'; });
  h += '</div></div><button class="btn btn-g btn-s" onclick="toggleEditProfile()" style="width:auto">'+(isEditing?'✕ Отмена':'✏️ Изменить')+'</button></div><div class="edit-form '+(isEditing?'active':'')+'" id="edit-profile-form"><label class="sm muted" style="display:block;margin-bottom:8px">Имя</label><input type="text" class="inp" id="edit-fname" value="'+u.firstName+'" placeholder="Ваше имя"><button class="btn btn-fire" onclick="saveProfileEdit()" style="margin-top:8px">💾 Сохранить</button></div></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">🏆 Уровень и XP</h3><div class="level-bar" style="margin-bottom:0"><div class="level-header"><div class="level-badge"><div class="level-icon">'+levelInfo.current.icon+'</div><div class="level-info"><div class="level-name">Уровень '+levelInfo.current.level+': '+levelInfo.current.name+'</div><div class="level-xp">'+(u.xp||0)+' XP всего • '+levelInfo.xpInLevel+' / '+levelInfo.xpNeeded+' до следующего</div></div></div></div><div class="xp-bar" style="margin-top:12px"><div class="xp-bar-fill" style="width:'+levelInfo.progress+'%"></div></div></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">💰 FitCoins: '+(u.fitCoins||0)+'</h3><p class="sm muted" style="margin-bottom:16px">Обменивайте баллы на награды!</p>';
  REWARDS.forEach(r => { const canAfford = (u.fitCoins||0) >= r.cost; h += '<div class="reward-item"><div class="reward-icon">'+r.icon+'</div><div class="reward-info"><div class="reward-name">'+r.name+'</div><div class="reward-desc">'+r.desc+'</div></div><button class="btn btn-s '+(canAfford?'btn-fire':'btn-g')+'" style="width:auto;'+(canAfford?'':'opacity:.5;cursor:not-allowed')+'" onclick="'+(canAfford?'redeemReward(\''+r.id+'\','+r.cost+')':'')+'" '+(canAfford?'':'disabled')+'><span style="color:var(--gold)">💰 '+r.cost+'</span></button></div>'; });
  h += '</div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">📊 Показатели для расчёта ккалорий</h3><div class="flex ic jb" style="margin-bottom:12px"><span class="sm">Текущие значения</span><button class="btn btn-g btn-s" onclick="toggleEditMetrics()" style="width:auto">'+(isEditingMetrics?'✕ Отмена':'✏️ Изменить')+'</button></div><div class="metrics-container" style="margin-bottom:16px"><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+u.quizData.cw+' кг</span></div><div class="metric-label">Текущий вес</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+u.quizData.tw+' кг</span></div><div class="metric-label">Желаемый вес</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+u.quizData.height+' см</span></div><div class="metric-label">Рост</div></div><div class="metric-box"><div class="metric-bar"><span class="metric-value">'+u.quizData.age+' лет</span></div><div class="metric-label">Возраст</div></div></div><div class="edit-form '+(isEditingMetrics?'active':'')+'" id="edit-metrics-form"><label class="sm muted" style="display:block;margin-bottom:8px">Текущий вес (кг)</label><input type="number" class="inp" id="edit-cw" value="'+u.quizData.cw+'" min="30" max="250"><label class="sm muted" style="display:block;margin-bottom:8px">Желаемый вес (кг)</label><input type="number" class="inp" id="edit-tw" value="'+u.quizData.tw+'" min="30" max="200"><label class="sm muted" style="display:block;margin-bottom:8px">Рост (см)</label><input type="number" class="inp" id="edit-height" value="'+u.quizData.height+'" min="120" max="230"><label class="sm muted" style="display:block;margin-bottom:8px">Возраст</label><input type="number" class="inp" id="edit-age" value="'+u.quizData.age+'" min="16" max="80"><label class="sm muted" style="display:block;margin-bottom:8px">Цель</label><select class="inp" id="edit-goal"><option value="cut" '+(u.quizData.goal==='cut'?'selected':'')+'>Похудеть</option><option value="gain" '+(u.quizData.goal==='gain'?'selected':'')+'>Набрать массу</option><option value="tone" '+(u.quizData.goal==='tone'||!u.quizData.goal?'selected':'')+'>Поддерживать тонус</option></select><button class="btn btn-fire" onclick="saveMetricsEdit()" style="margin-top:8px">💾 Сохранить</button></div></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">📅 Дней тренировок в неделю</h3><p class="sm muted" style="margin-bottom:16px">Сейчас: <strong>'+daysPerWeek+' дней</strong></p><div class="chip '+(daysPerWeek===3?'sel':'')+'" onclick="changeDays(3)"><span style="font-size:24px">3️⃣</span><div><div style="font-weight:600">3 дня</div><div class="xs muted">Пн/Ср/Пт</div></div></div><div class="chip '+(daysPerWeek===4?'sel':'')+'" onclick="changeDays(4)"><span style="font-size:24px">4️⃣</span><div><div style="font-weight:600">4 дня</div><div class="xs muted">Пн/Ср/Пт/Вс</div></div></div><div class="chip '+(daysPerWeek===5?'sel':'')+'" onclick="changeDays(5)"><span style="font-size:24px">5️⃣</span><div><div style="font-weight:600">5 дней</div><div class="xs muted">Пн/Вт/Чт/Пт/Вс</div></div></div><div class="chip '+(daysPerWeek===6?'sel':'')+'" onclick="changeDays(6)"><span style="font-size:24px">6️⃣</span><div><div style="font-weight:600">6 дней</div><div class="xs muted">Пн-Сб</div></div></div></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">🎨 Тема оформления</h3><div class="theme-toggle" onclick="toggleTheme()"><span class="theme-toggle-icon">'+(theme==='dark'?'🌙':'☀️')+'</span><span class="theme-toggle-label">'+(theme==='dark'?'Тёмная тема':'Светлая тема')+'</span></div></div>';
  h += '<div class="card"><h3 style="margin-bottom:16px">🔔 Напоминания</h3><div class="reminder-card"><div class="flex ic gap"><div class="reminder-icon">🏋️</div><div class="reminder-info"><div class="reminder-title">Напоминание о тренировке</div><div class="reminder-desc">Ежедневное напоминание в выбранное время</div></div><div class="reminder-toggle '+(reminders.workout.enabled?'on':'')+'" onclick="toggleReminder(\'workout\')"></div></div><div class="time-slots">';
  ['08:00','09:00','10:00','12:00','13:00','14:00','16:00','18:00','19:00','20:00','21:00','22:00'].forEach(t => { h += '<div class="time-slot '+(reminders.workout.time===t?'sel':'')+'" onclick="setReminderTime(\'workout\',\''+t+'\')">'+t+'</div>'; });
  h += '</div></div><div class="reminder-card"><div class="flex ic gap"><div class="reminder-icon">💧</div><div class="reminder-info"><div class="reminder-title">Напоминание о воде</div><div class="reminder-desc">Каждые 2 часа (8:00-22:00)</div></div><div class="reminder-toggle '+(reminders.water.enabled?'on':'')+'" onclick="toggleReminder(\'water\')"></div></div></div></div>';
  if (info.isLifetime) h += '<div class="card" style="border-color:var(--gold);background:linear-gradient(135deg,rgba(251,191,36,.1),rgba(245,158,11,.05))"><div class="sm muted" style="margin-bottom:4px">Текущий тариф</div><div style="font-weight:700;color:var(--gold);font-size:16px">💎 Навсегда</div><p class="sm" style="margin-top:8px;color:var(--text)">Безграничное количество тренировок</p></div>';
  else h += '<div class="card"><div style="background:var(--bg2);padding:14px;border-radius:12px;margin-bottom:16px"><div class="sm muted" style="margin-bottom:4px">Текущий тариф</div><div style="font-weight:700;color:var(--fire)">'+typeLabels[info.type]+'</div></div><button class="btn btn-fire" style="margin-bottom:12px" onclick="S.view=\'pay\';go()">🔥 Управление подпиской</button><button class="btn btn-err" onclick="reset()">🚪 Сбросить все данные</button></div>';
  return h;
}

function toggleEditProfile() { S.editingProfile = !S.editingProfile; go(); }
function toggleEditMetrics() { S.editingMetrics = !S.editingMetrics; go(); }
function saveProfileEdit() { try { const fi = document.getElementById('edit-fname'); if (!fi) { toast('❌ Ошибка'); return; } const nf = fi.value.trim(); if (!nf) { toast('⚠️ Имя не может быть пустым!'); fi.focus(); return; } S.user.firstName = nf; S.editingProfile = false; save(); toast('✅ Профиль обновлён!'); go(); } catch(e) { toast('❌ Ошибка: ' + e.message); } }
function saveMetricsEdit() { try { const cw = +document.getElementById('edit-cw').value; const tw = +document.getElementById('edit-tw').value; const height = +document.getElementById('edit-height').value; const age = +document.getElementById('edit-age').value; const goal = document.getElementById('edit-goal').value; if (!cw||!tw||!height||!age) { toast('⚠️ Заполните все поля!'); return; } if (Math.abs(tw-cw) > 50) { toast('⚠️ Желаемый вес должен отличаться не более чем на 50 кг!'); return; } S.user.quizData.cw = cw; S.user.quizData.tw = tw; S.user.quizData.height = height; S.user.quizData.age = age; S.user.quizData.goal = goal; S.editingMetrics = false; save(); toast('✅ Показатели обновлены!'); go(); } catch(e) { toast('❌ Ошибка: ' + e.message); } }
function changeDays(days) { S.user.quizData.days = days; save(); toast('✅ Обновлено: '+days+' дней'); go(); }
function setReminderTime(type, time) { if (!S.user.reminders) S.user.reminders = {workout:{enabled:true,time:'09:00'},water:{enabled:true}}; S.user.reminders[type].time = time; save(); setupReminders(); toast('✅ Время: '+time); go(); }
function toggleTheme() { const current = localStorage.getItem('theme') || 'dark'; const newTheme = current === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', newTheme); document.documentElement.setAttribute('data-theme', newTheme); go(); }
function toggleReminder(type) { if (!S.user.reminders) S.user.reminders = {workout:{enabled:true,time:'09:00'},water:{enabled:true}}; S.user.reminders[type].enabled = !S.user.reminders[type].enabled; save(); setupReminders(); toast(S.user.reminders[type].enabled ? '✅ Включено' : '❌ Выключено'); go(); }
function setupReminders() { Object.values(reminderIntervals).forEach(interval => clearInterval(interval)); reminderIntervals = {}; if (!S.user || !S.user.reminders) return; reminderIntervals.workout = setInterval(() => { const now = new Date(); const currentTime = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'); if (S.user.reminders.workout.enabled && currentTime === S.user.reminders.workout.time) { if (Notification.permission === 'granted') new Notification('🏋️ Время тренировки!'); else toast('🏋️ Время тренировки!'); } }, 60000); reminderIntervals.water = setInterval(() => { const now = new Date(); const hour = now.getHours(); const minute = now.getMinutes(); if (S.user.reminders.water.enabled && hour % 2 === 0 && minute === 0 && hour >= 8 && hour <= 22) { if (Notification.permission === 'granted') new Notification('💧 Время пить воду!'); else toast('💧 Время пить воду!'); } }, 60000); }
function redeemReward(id, cost) { if (!S.user || !confirm('Потратить '+cost+' FitCoins?')) return; if ((S.user.fitCoins||0) < cost) { toast('❌ Недостаточно FitCoins'); return; } S.user.fitCoins -= cost; if (!S.user.redeemedRewards) S.user.redeemedRewards = []; S.user.redeemedRewards.push({id, date:Date.now()}); if (id === 'free_week' && S.user.subscription) S.user.subscription.unlockDate += 7*DAY_MS; else if (id === 'free_month' && S.user.subscription) S.user.subscription.unlockDate += 30*DAY_MS; save(); toast('🎉 Награда получена!'); go(); }
function exportPlan() { window.print(); toast('📄 План экспортирован!'); }
function bDash() { document.querySelectorAll('.tab').forEach(t => { t.onclick = () => { S.tab = t.dataset.t; go(); }; }); }
function toast(msg) { const r = document.getElementById('toast'); r.innerHTML = '<div class="toast"><span style="font-size:20px">✅</span><span style="font-size:14px;font-weight:500">'+msg+'</span></div>'; setTimeout(() => r.querySelector('.toast')?.classList.add('show'), 10); setTimeout(() => { const t = r.querySelector('.toast'); if (t) { t.classList.remove('show'); setTimeout(() => r.innerHTML = '', 300); } }, 3000); }
function checkDailyUpdate() { if (!S.user) return; const today = new Date().toDateString(); if (S.user.lastPlanUpdate !== today) { S.user.lastPlanUpdate = today; save(); toast('🔄 План обновлён!'); go(); } }
setInterval(checkDailyUpdate, 60000);

// ==================== INIT ====================
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
load();
initMusicPlayer();
if (S.user) { S.view = 'dash'; S.tab = 'workout'; setupReminders(); }
go();
</script>
</body>
</html>
