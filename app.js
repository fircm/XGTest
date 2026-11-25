/* 习概题库 · 刷题 APP
 * 纯前端单页应用，数据持久化使用 localStorage
 */
const QS = window.QUESTIONS;
const QBYID = {};
QS.forEach(q => QBYID[q.id] = q);
const CHAPTERS = [...new Set(QS.map(q => q.chapter))];
const TOTAL = QS.length;
const PASS_SCORE = 60; // 提前定义：数据迁移和评分判定共用

/* ============== 工具函数 ============== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const newSeed = () => (Math.random() * 1e9) | 0;
function dateOffset(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}
function dateOffsetStr(days, from) { return todayStr(dateOffset(days, from)); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function isCorrect(q, selected) {
  const a = new Set(q.answerList);
  const s = new Set(selected);
  if (a.size !== s.size) return false;
  for (const x of a) if (!s.has(x)) return false;
  return true;
}
function toast(msg, ms = 1500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, ms);
}
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${m}月${d}日`;
}
function fmtDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${pad(m)}:${pad(s)}`;
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============== 持久化存储 ============== */
const K = {
  progress: 'qbank_v2_progress',
  history: 'qbank_v2_history',
  settings: 'qbank_v2_settings',
  dailyset: 'qbank_v2_dailyset',
  exams: 'qbank_v2_exams',
};
function load(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

let progress = load(K.progress, {});   // {id: {correct,wrong,lastAt,lastResult,fav,wrongActive,interval,mastered,dueAt}}
let history = load(K.history, {});      // {dateStr:{total,correct,wrong,dailyQids}}
let settings = Object.assign({ dailyGoal: 20, autoNext: true, shuffleOpt: false }, load(K.settings, {}));
let dailyset = load(K.dailyset, {});
let exams = load(K.exams, []);          // 模拟考试记录
// 旧记录兼容：补齐 pass 字段
exams.forEach(e => { if (e.pass === undefined) e.pass = e.score >= PASS_SCORE; });

// 只读默认对象：读用 getP 不污染 progress
const EMPTY_P = Object.freeze({
  correct: 0, wrong: 0, lastAt: 0, lastResult: null,
  fav: false, wrongActive: false, interval: 0, mastered: false, dueAt: null, priority: false,
});
function getP(id) { return progress[id] || EMPTY_P; }
// 写用 ensureP：只有真正写入数据时才创建条目
function ensureP(id) { return progress[id] || (progress[id] = { ...EMPTY_P }); }
function saveProgress() { save(K.progress, progress); }
function saveSettings() { save(K.settings, settings); }

const INTERVALS = [1, 2, 4, 7, 15, 30];
function nextInterval(cur) {
  const i = INTERVALS.indexOf(cur);
  return i < 0 ? INTERVALS[0] : INTERVALS[Math.min(i + 1, INTERVALS.length - 1)];
}

function recordAnswer(qid, correct, mode) {
  const p = ensureP(qid);
  p.lastAt = Date.now();
  p.lastResult = correct;
  if (correct) {
    p.correct++;
    if (mode === 'wrong') {
      // 错题本里答对：立即移出错题本，但标记为次日优先复习
      p.interval = 1;
      p.wrongActive = false;
      p.priority = true;
      p.mastered = false;
      p.dueAt = dateOffsetStr(1);
    } else {
      p.interval = nextInterval(p.interval);
      p.wrongActive = false;
      p.priority = false;
      if (p.interval >= 30) {
        p.mastered = true;
        p.dueAt = null;          // 已掌握，不再进入复习队列
      } else {
        p.mastered = false;
        p.dueAt = dateOffsetStr(p.interval); // 写入下次复习日期（修复间隔重复）
      }
    }
  } else {
    p.wrong++;
    p.interval = 1;
    p.wrongActive = true;
    p.mastered = false;
    p.dueAt = dateOffsetStr(1);            // 答错，明天优先复习
  }
  saveProgress();
  const day = todayStr();
  const h = history[day] || (history[day] = { total: 0, correct: 0, wrong: 0 });
  h.total++;
  if (correct) h.correct++; else h.wrong++;
  if (mode === 'daily') {
    if (!h.dailyQids) h.dailyQids = [];
    if (!h.dailyQids.includes(qid)) h.dailyQids.push(qid);
  }
  save(K.history, history);
}
function todayDailyCount() {
  const h = history[todayStr()];
  return h && h.dailyQids ? h.dailyQids.length : 0;
}

/* ============== 统计计算 ============== */
// 按每道题当前状态归类：掌握 / 错题 / 正确 / 未答（不依赖累计作答次数）
function questionState(p) {
  if (!p || p.correct + p.wrong === 0) return 'none';
  if (p.mastered) return 'mastered';
  if (p.wrongActive || p.lastResult === false) return 'wrong';
  return 'correct';
}
function overallStats() {
  let correct = 0, wrong = 0, answered = 0, mastered = 0, fav = 0, wrongActive = 0;
  for (const id in progress) {
    const p = progress[id];
    if (p.fav) fav++;
    if (p.wrongActive) wrongActive++;
    const st = questionState(p);
    if (st === 'none') continue;
    answered++;
    if (st === 'mastered') mastered++;
    else if (st === 'wrong') wrong++;
    else correct++;
  }
  const rate = answered ? Math.round((correct + mastered) / answered * 100) : 0;
  return { correct, wrong, total: answered, answered, rate, mastered, fav, wrongActive };
}
function chapterStats() {
  const map = {};
  CHAPTERS.forEach(c => map[c] = { total: 0, correct: 0, wrong: 0, mastered: 0, answered: 0 });
  QS.forEach(q => {
    map[q.chapter].total++;
    const st = questionState(progress[q.id]);
    if (st === 'none') return;
    map[q.chapter].answered++;
    if (st === 'mastered') map[q.chapter].mastered++;
    else if (st === 'wrong') map[q.chapter].wrong++;
    else map[q.chapter].correct++;
  });
  return map;
}
function streakDays() {
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const d = dateOffsetStr(-i);
    if (history[d] && history[d].total > 0) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}
// 是否今日到期复习：未掌握且到期；旧数据（有错题标记但没有 dueAt）视为已到期
function isReviewDue(p, today) {
  if (!p || p.mastered) return false;
  if (p.wrongActive && !p.dueAt) return true;
  return !!p.dueAt && p.dueAt <= today;
}
// 复习排序：错题、或刚从错题本移出的优先
function reviewRank(id) {
  const p = progress[id];
  return p && (p.wrongActive || p.priority) ? 0 : 1;
}
function dueTodayCount() {
  const today = todayStr();
  let n = 0;
  for (const id in progress) {
    if (isReviewDue(progress[id], today)) n++;
  }
  return n;
}

/* ============== 每日题集 ============== */
function getDailySet(date = todayStr()) {
  if (!dailyset[date]) {
    const ids = QS.map(q => q.id);
    const rng = mulberry32(hashStr('daily-' + date));
    dailyset[date] = shuffle(ids, rng).slice(0, settings.dailyGoal);
    save(K.dailyset, dailyset);
  }
  return dailyset[date];
}

/* ============== 应用状态 / 路由 ============== */
const state = { tab: 'home', view: 'home', params: {} };
let session = null;
let examTimer = null;
let lastSearchQuery = '';

function setTop(title, showBack = false) {
  $('#topTitle').textContent = title;
  $('#backBtn').hidden = !showBack;
  const hideSearch = ['quiz', 'exam', 'result', 'examResult', 'search', 'detail'].includes(state.view);
  const sb = $('#searchBtn');
  if (sb) sb.hidden = hideSearch;
}
function showTabbar(show) { $('#tabbar').style.display = show ? 'flex' : 'none'; }

function clearExamTimer() {
  if (examTimer) { clearInterval(examTimer); examTimer = null; }
}
function navigate(view, params = {}) {
  if (view !== 'exam') clearExamTimer();
  state.view = view;
  state.params = params;
  render();
}
function switchTab(tab) {
  state.tab = tab;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  navigate(tab);
}
// 统一返回逻辑（替代 init 中的长 if/else）
function goBack() {
  const v = state.view;
  const from = state.params && state.params.from;
  switch (v) {
    case 'quiz':
      if (session && session.review) { navigate('result'); break; } // 回顾模式：退回成绩页
      session = null; switchTab(state.tab); break;
    case 'result':
      session = null; switchTab(state.tab); break;
    case 'list':
      navigate('practice'); break;
    case 'exam':
      if (confirm('考试尚未交卷，确定退出吗？退出后本次作答不保留。')) {
        clearExamTimer(); session = null; switchTab(state.tab);
      }
      break;
    case 'examSetup':
    case 'examResult':
      session = null; switchTab(state.tab); break;
    case 'detail':
      if (from === 'search') navigate('search', { q: lastSearchQuery });
      else if (from === 'exam' && session && session.examItems) navigate('examResult');
      else navigate('practice');
      break;
    case 'search':
      switchTab(state.tab); break;
    default:
      switchTab('home');
  }
}

/* ============== 渲染入口 ============== */
function render() {
  $$('.sheet-overlay').forEach(o => o.remove());
  const v = state.view;
  if (v === 'home') renderHome();
  else if (v === 'practice') renderPractice();
  else if (v === 'stats') renderStats();
  else if (v === 'me') renderMe();
  else if (v === 'quiz') renderQuiz();
  else if (v === 'result') renderResult();
  else if (v === 'list') renderList();
  else if (v === 'examSetup') renderExamSetup();
  else if (v === 'exam') renderExam();
  else if (v === 'examResult') renderExamResult();
  else if (v === 'search') renderSearch();
  else if (v === 'detail') renderDetail();
}

/* ---------- 首页 ---------- */
function renderHome() {
  setTop('习概题库');
  showTabbar(true);
  const o = overallStats();
  const today = todayStr();
  const doneToday = todayDailyCount();
  const goal = settings.dailyGoal;
  const pct = Math.min(100, Math.round(doneToday / goal * 100));
  const streak = streakDays();
  const due = dueTodayCount();

  $('#view').innerHTML = `
    <div class="search-entry" id="searchEntry">
      <span>🔍</span><span class="muted">搜索题目关键词…</span>
    </div>

    <div class="hero">
      <h2>每日一练，温故知新</h2>
      <p>共 ${TOTAL} 道精选题库 · ${CHAPTERS.length} 个章节</p>
      <div class="streak">🔥 连续打卡 <b>${streak}</b> 天 · 今日已刷 <b>${doneToday}</b> 题</div>
    </div>

    <div class="daily-card">
      <div class="daily-head">
        <div>
          <div class="d">今日目标 · ${fmtDate(today)}</div>
          <div class="small muted">完成 ${doneToday} / ${goal} 题</div>
        </div>
        <div class="chip ${doneToday >= goal ? 'chip-ok' : ''}" style="background:#fff;color:#92400e">${pct}%</div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div style="padding:4px 14px 14px">
        <button class="btn btn-primary" id="startDaily">开始每日刷题（${goal}题）</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-cell"><div class="num">${o.rate}%</div><div class="lbl">正确率</div></div>
      <div class="stat-cell"><div class="num">${o.wrongActive}</div><div class="lbl">错题待清</div></div>
      <div class="stat-cell"><div class="num">${due}</div><div class="lbl">待复习</div></div>
      <div class="stat-cell"><div class="num">${o.mastered}</div><div class="lbl">已掌握</div></div>
    </div>

    <div class="section-title">模拟考试</div>
    <div class="exam-entry" id="examEntry">
      <div class="ee-left">
        <div class="ee-t">📝 全真模拟考试</div>
        <div class="ee-d">限时答题 · 交卷评分 · 还原考场体验</div>
      </div>
      <div class="ee-btn">立即开考</div>
    </div>

    <div class="section-title">快捷练习</div>
    <div class="mode-grid">
      <div class="mode-card" data-mode="random"><div class="mi">🎲</div><div class="mt">随机刷题</div><div class="md">随机抽题，即时判分</div></div>
      <div class="mode-card" data-mode="order"><div class="mi">📖</div><div class="mt">顺序练习</div><div class="md">按题库顺序逐题练习</div></div>
      <div class="mode-card" data-mode="wrong"><div class="mi">❌</div><div class="mt">错题重练</div><div class="md">${o.wrongActive} 道错题待攻克</div></div>
      <div class="mode-card" data-mode="review"><div class="mi">🔁</div><div class="mt">复习巩固</div><div class="md">${due} 道到期需复习</div></div>
    </div>
  `;
  $('#searchEntry').onclick = () => navigate('search');
  $('#examEntry').onclick = () => navigate('examSetup');
  $('#startDaily').onclick = () => startSession('daily');
  $$('.mode-card').forEach(c => c.onclick = () => startSession(c.dataset.mode));
}

/* ---------- 练习页 ---------- */
function renderPractice() {
  setTop('练习题库');
  showTabbar(true);
  const o = overallStats();
  const cs = chapterStats();
  const due = dueTodayCount();
  $('#view').innerHTML = `
    <div class="search-entry" id="searchEntry">
      <span>🔍</span><span class="muted">搜索题目关键词…</span>
    </div>
    <div class="list">
      <div class="list-item" data-list="wrong"><div class="li-ic">❌</div>
        <div class="li-main"><div class="li-t">错题本</div><div class="li-s">${o.wrongActive} 道错题，答对移出，次日优先复习</div></div>
        <div class="li-arr">›</div></div>
      <div class="list-item" data-list="review"><div class="li-ic">🔁</div>
        <div class="li-main"><div class="li-t">复习巩固</div><div class="li-s">${due} 道题今日到期复习（间隔重复）</div></div>
        <div class="li-arr">›</div></div>
      <div class="list-item" data-list="fav"><div class="li-ic">⭐</div>
        <div class="li-main"><div class="li-t">我的收藏</div><div class="li-s">${o.fav} 道收藏题目</div></div>
        <div class="li-arr">›</div></div>
      <div class="list-item" id="examListEntry"><div class="li-ic">📝</div>
        <div class="li-main"><div class="li-t">模拟考试</div><div class="li-s">限时答题，交卷后统一评分</div></div>
        <div class="li-arr">›</div></div>
    </div>
    <div class="section-title">章节练习（按章节刷题）</div>
    <div class="chapter-grid">
      ${CHAPTERS.map(c => {
        const s = cs[c];
        const done = s.answered;
        const rate = s.total ? Math.round(done / s.total * 100) : 0;
        return `<div class="chapter-card" data-chapter="${escapeHTML(c)}">
          <div class="ct">${escapeHTML(c)}</div>
          <div class="cb"><span class="cm">${done}/${s.total} 已做</span><span class="crate" style="color:${rate === 100 ? 'var(--ok)' : 'var(--primary)'}">${rate}%</span></div>
        </div>`;
      }).join('')}
    </div>
  `;
  // 只给带 data-list 的条目绑定 startSession，避免 examListEntry 被误绑
  $$('.list-item[data-list]').forEach(it => it.onclick = () => startSession(it.dataset.list));
  $$('.chapter-card').forEach(c => c.onclick = () => startSession('chapter', { chapter: c.dataset.chapter }));
  $('#searchEntry').onclick = () => navigate('search');
  $('#examListEntry').onclick = () => navigate('examSetup');
}

/* ---------- 列表页（错题/收藏/复习） ---------- */
function renderList() {
  const kind = state.params.kind;
  const map = { wrong: '错题本', review: '复习巩固', fav: '我的收藏' };
  setTop(map[kind], true);
  showTabbar(true);
  let ids = [];
  if (kind === 'wrong') ids = QS.filter(q => progress[q.id] && progress[q.id].wrongActive).map(q => q.id);
  else if (kind === 'fav') ids = QS.filter(q => progress[q.id] && progress[q.id].fav).map(q => q.id);
  else if (kind === 'review') {
    const today = todayStr();
    ids = QS.filter(q => isReviewDue(progress[q.id], today)).map(q => q.id);
    ids.sort((a, b) => reviewRank(a) - reviewRank(b)); // 错题优先
  }
  const list = ids.map(id => QBYID[id]);
  const empty = { wrong: '还没有错题，继续加油！', review: '今日没有需要复习的题目', fav: '还没有收藏题目，答题时点击 ☆ 收藏' };
  $('#view').innerHTML = `
    <div class="card row">
      <div>共 <b>${list.length}</b> 道题</div>
      ${list.length ? `<button class="btn btn-ghost" id="startList">开始练习</button>` : ''}
    </div>
    ${list.length === 0 ? `<div class="empty"><span class="ei">📭</span>${empty[kind]}</div>` :
      `<div class="list">${list.map(q => {
        const p = progress[q.id] || {};
        return `<div class="list-item" data-id="${q.id}">
          <div class="li-ic">${q.type === 'single' ? '🔹' : '🔸'}</div>
          <div class="li-main">
            <div class="li-t">${escapeHTML(q.question.length > 38 ? q.question.slice(0, 38) + '…' : q.question)}</div>
            <div class="li-s">${escapeHTML(q.chapter)} · ${q.type === 'single' ? '单选' : '多选'} · 正确答案 ${q.answer}</div>
          </div>
          <div class="li-arr">›</div>
        </div>`;
      }).join('')}</div>`}
  `;
  const sl = $('#startList');
  if (sl) sl.onclick = () => startSession(kind);
  $$('.list-item[data-id]').forEach(it => it.onclick = () => {
    const id = +it.dataset.id;
    startSession(kind, { focusId: id });
  });
}

/* ---------- 统计页 ---------- */
function renderStats() {
  setTop('答题情况');
  showTabbar(true);
  const o = overallStats();
  const cs = chapterStats();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = dateOffsetStr(-i);
    const h = history[d] || { total: 0, correct: 0 };
    days.push({ d, total: h.total, correct: h.correct, rate: h.total ? Math.round(h.correct / h.total * 100) : 0 });
  }
  const maxTotal = Math.max(1, ...days.map(d => d.total));

  const examList = exams.slice().reverse();
  const avg = exams.length ? Math.round(exams.reduce((s, e) => s + e.score, 0) / exams.length) : 0;
  const best = exams.length ? Math.max(...exams.map(e => e.score)) : 0;

  $('#view').innerHTML = `
    <div class="overall">
      <div class="row">
        <div>
          <div class="rate">${o.answered}<small>题</small></div>
          <div class="small muted">累计答题</div>
        </div>
        <div style="text-align:right">
          <div class="small muted">总正确率</div>
          <div style="font-size:20px;font-weight:700">${o.rate}%</div>
        </div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="small"><span class="legend-dot" style="background:var(--ok)"></span>正确 ${o.correct}</div>
        <div class="small"><span class="legend-dot" style="background:var(--bad)"></span>错误 ${o.wrong}</div>
        <div class="small"><span class="legend-dot" style="background:var(--primary)"></span>掌握 ${o.mastered}</div>
      </div>
    </div>

    <div class="section-title">近 7 天答题</div>
    <div class="chart">
      ${days.map(d => `
        <div class="bar-row">
          <div class="bn">${fmtDate(d.d)}</div>
          <div class="btrack"><div class="bfill" style="width:${d.total / maxTotal * 100}%"></div></div>
          <div class="bv">${d.total}题 ${d.rate}%</div>
        </div>`).join('')}
    </div>

    <div class="section-title">历次模拟考试</div>
    ${exams.length ? `
      <div class="result-stats">
        <div class="rs"><div class="n">${exams.length}</div><div class="small muted">考试次数</div></div>
        <div class="rs"><div class="n">${avg}</div><div class="small muted">平均分</div></div>
        <div class="rs"><div class="n">${best}</div><div class="small muted">最高分</div></div>
      </div>
      <div class="ans-list">
        ${examList.map(e => `<div class="ans-item">
          <span class="dot" style="background:${e.pass ? 'var(--ok)' : 'var(--bad)'}"></span>
          <span class="qtxt">${new Date(e.at).toLocaleString('zh-CN', { hour12: false })} · ${e.scope === 'all' ? '全部章节' : escapeHTML(e.scope)} · 用时 ${fmtDuration(e.usedSec)}</span>
          <span class="ra ${e.pass ? 'text-ok' : 'text-bad'}">${e.score}分</span>
        </div>`).join('')}
      </div>` : `<div class="empty"><span class="ei">📝</span>还没有考试记录，去首页参加一次模拟考试吧</div>`}

    <div class="section-title">各章节题目完成情况</div>
    <div class="chart">
      ${CHAPTERS.map(c => {
        const s = cs[c];
        const pct = s.total ? Math.round(s.answered / s.total * 100) : 0;
        return `<div class="bar-row">
          <div class="bn" title="${escapeHTML(c)}">${escapeHTML(c)}</div>
          <div class="btrack"><div class="bfill" style="width:${pct}%"></div></div>
          <div class="bv">${s.answered}/${s.total}</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

/* ---------- 我的 ---------- */
function renderMe() {
  setTop('我的');
  showTabbar(true);
  const o = overallStats();
  $('#view').innerHTML = `
    <div class="card row">
      <div>
        <div style="font-size:17px;font-weight:700">学习概览</div>
        <div class="small muted">累计答题 ${o.answered} · 已掌握 ${o.mastered} · 连续 ${streakDays()} 天</div>
      </div>
    </div>
    <div class="section-title">设置</div>
    <div class="setting-item">
      <div><div class="st">每日题量</div><div class="sd">每日刷题的题目数量</div></div>
      <div class="seg" id="goalSeg">
        ${[10, 20, 30, 50].map(n => `<span class="${settings.dailyGoal === n ? 'on' : ''}" data-n="${n}">${n}</span>`).join('')}
      </div>
    </div>
    <div class="setting-item">
      <div><div class="st">自动下一题</div><div class="sd">单选答对后自动进入下一题</div></div>
      <div class="switch ${settings.autoNext ? 'on' : ''}" id="autoNext"></div>
    </div>
    <div class="setting-item">
      <div><div class="st">选项乱序</div><div class="sd">每次练习打乱选项顺序</div></div>
      <div class="switch ${settings.shuffleOpt ? 'on' : ''}" id="shuffleOpt"></div>
    </div>
    <div class="section-title">数据</div>
    <div class="setting-item" id="exportData"><div><div class="st">导出答题记录</div><div class="sd">将进度数据导出为 JSON 文件</div></div><div class="li-arr">›</div></div>
    <div class="setting-item" id="resetData" style="color:var(--bad)"><div><div class="st" style="color:var(--bad)">清空所有进度</div><div class="sd">重置答题记录、错题本、收藏与考试记录（不可恢复）</div></div><div class="li-arr">›</div></div>
    <div class="card" style="text-align:center;color:var(--muted);font-size:12px;line-height:1.8">
      习概题库 · 共 ${TOTAL} 题 / ${CHAPTERS.length} 章<br/>
      数据保存在本机浏览器，关闭页面不丢失
    </div>
  `;
  $$('#goalSeg span').forEach(s => s.onclick = () => {
    settings.dailyGoal = +s.dataset.n;
    saveSettings();
    delete dailyset[todayStr()];
    getDailySet();
    toast('每日题量已设为 ' + settings.dailyGoal + '，今日题集已更新');
    renderMe();
  });
  $('#autoNext').onclick = () => { settings.autoNext = !settings.autoNext; saveSettings(); renderMe(); };
  $('#shuffleOpt').onclick = () => { settings.shuffleOpt = !settings.shuffleOpt; saveSettings(); renderMe(); };
  $('#exportData').onclick = exportData;
  $('#resetData').onclick = () => {
    if (confirm('确定要清空所有答题进度吗？此操作不可恢复！')) {
      localStorage.removeItem(K.progress); localStorage.removeItem(K.history); localStorage.removeItem(K.dailyset); localStorage.removeItem(K.exams);
      progress = {}; history = {}; dailyset = {}; exams = [];
      toast('已清空进度'); renderMe();
    }
  };
}
function exportData() {
  const blob = new Blob([JSON.stringify({ progress, history, settings, dailyset, exams }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `习概题库进度_${todayStr()}.json`;
  a.click();
  toast('已导出');
}

/* ============== 答题会话 ============== */
function buildIds(mode, params = {}) {
  let ids = [];
  if (mode === 'daily') ids = getDailySet();
  else if (mode === 'order') ids = QS.map(q => q.id);
  else if (mode === 'random') ids = shuffle(QS.map(q => q.id)).slice(0, settings.dailyGoal);
  else if (mode === 'chapter') ids = QS.filter(q => q.chapter === params.chapter).map(q => q.id);
  else if (mode === 'wrong') ids = QS.filter(q => progress[q.id] && progress[q.id].wrongActive).map(q => q.id);
  else if (mode === 'fav') ids = QS.filter(q => progress[q.id] && progress[q.id].fav).map(q => q.id);
  else if (mode === 'review') {
    const today = todayStr();
    ids = QS.filter(q => isReviewDue(progress[q.id], today)).map(q => q.id);
    ids.sort((a, b) => reviewRank(a) - reviewRank(b)); // 错题优先
  }
  if (params.focusId) {
    ids = [params.focusId, ...ids.filter(i => i !== params.focusId)];
  }
  return ids;
}
function startSession(mode, params = {}) {
  const ids = buildIds(mode, params);
  if (!ids.length) { toast('暂无题目可练习'); return; }
  const titles = { daily: '每日刷题', random: '随机刷题', order: '顺序练习', chapter: '章节练习', wrong: '错题重练', fav: '收藏练习', review: '复习巩固' };
  session = { ids, idx: 0, answers: {}, mode, seed: newSeed(), title: titles[mode] + (params.chapter ? ' · ' + params.chapter : '') };
  navigate('quiz');
}

// 选项乱序：同一会话内题目选项顺序固定（修复判分后重排）
function orderedOptions(q) {
  if (!settings.shuffleOpt) return q.options;
  const seed = session && session.seed ? session.seed : 0;
  const rng = mulberry32(hashStr(q.id + '|' + seed));
  return shuffle(q.options, rng);
}

function renderQuiz() {
  setTop(session.title, true);
  showTabbar(false);
  const q = QBYID[session.ids[session.idx]];
  const total = session.ids.length;
  const review = !!session.review;
  const stored = session.answers[q.id];
  const ans = stored || (review ? { selected: [], correct: false, skipped: true } : null);
  const p = getP(q.id); // 只读
  const options = orderedOptions(q);
  const selected = ans ? ans.selected : [];

  $('#view').innerHTML = `
    <div class="quiz-top">
      <div><span class="qno">${session.idx + 1}/${total}</span>
        <span class="chip ${q.type === 'single' ? 'chip-single' : 'chip-multi'}">${q.type === 'single' ? '单选题' : '多选题'}</span>
        <span class="small muted">${escapeHTML(q.chapter)}</span>
      </div>
      <button class="fav-btn" id="favBtn" aria-label="收藏">${p.fav ? '⭐' : '☆'}</button>
    </div>
    <div class="quiz-bar"><div class="fill" style="width:${(session.idx) / total * 100}%"></div></div>

    <div class="question-card">
      <div class="qstem">${renderStem(q.question)}</div>
    </div>

    <div class="options" id="options">
      ${options.map(o => optionHTML(o, q, selected, ans)).join('')}
    </div>
    ${q.type === 'multi' && !ans ? '<div class="multi-hint">多选题，请选择所有正确选项后点击确认</div>' : ''}

    <div class="feedback ${ans ? (ans.correct ? 'ok show' : 'bad show') : ''}" id="feedback">
      <div class="ft">${ans ? (ans.skipped ? '○ 未作答' : ans.correct ? '✓ 回答正确' : '✗ 回答错误') : ''}</div>
      <div class="fans">
        ${ans ? `<div>正确答案：<b>${q.answer}</b>　你的答案：<b>${selected.join('') || '未作答'}</b></div>
          <div style="margin-top:6px;color:var(--ink-2)">${q.answerList.map(l => {
            const op = q.options.find(x => x.label === l); return op ? `${l}. ${escapeHTML(op.text)}` : '';
          }).join('；')}</div>` : ''}
      </div>
    </div>

    <div class="quiz-foot">
      <button class="btn btn-ghost" id="prevBtn" style="flex:1;${session.idx === 0 ? 'opacity:.4;' : ''}" ${session.idx === 0 ? 'disabled' : ''}>上一题</button>
      ${q.type === 'multi' && !ans ? '<button class="btn btn-ghost" id="confirmBtn" style="flex:1">确认提交</button>' : ''}
      <button class="btn btn-primary" id="nextBtn" style="flex:1.4">${session.idx + 1 >= total ? (review ? '返回结果' : '查看结果') : '下一题'}</button>
    </div>
  `;

  $('#favBtn').onclick = () => {
    const pp = ensureP(q.id);
    pp.fav = !pp.fav; saveProgress();
    $('#favBtn').textContent = pp.fav ? '⭐' : '☆';
    toast(pp.fav ? '已收藏' : '已取消收藏');
  };

  $$('.option').forEach(el => {
    el.onclick = () => {
      if (ans) return;
      const label = el.dataset.label;
      if (q.type === 'single') {
        grade([label]);
      } else {
        const cur = new Set($$('#options .option.sel').map(x => x.dataset.label));
        if (cur.has(label)) cur.delete(label); else cur.add(label);
        renderMultiSelection(cur);
      }
    };
  });
  const cb = $('#confirmBtn');
  if (cb) cb.onclick = () => {
    const cur = $$('#options .option.sel').map(x => x.dataset.label);
    if (!cur.length) { toast('请先选择选项'); return; }
    grade(cur);
  };
  $('#prevBtn').onclick = () => { if (session.idx > 0) { session.idx--; renderQuiz(); } };
  $('#nextBtn').onclick = nextQuestion;
}
function renderStem(t) {
  return escapeHTML(t).replace(/_{2,}/g, '<span class="blank">＿＿</span>');
}
function optionHTML(o, q, selected, ans) {
  let cls = 'option';
  if (ans) {
    if (q.answerList.includes(o.label)) cls += ' show-correct';
    if (selected.includes(o.label) && !ans.correct) cls += ' bad';
    else if (selected.includes(o.label) && ans.correct) cls += ' ok';
  } else if (selected.includes(o.label)) cls += ' sel';
  return `<div class="${cls}" data-label="${o.label}">
    <div class="olabel">${o.label}</div><div class="otext">${escapeHTML(o.text)}</div></div>`;
}
function renderMultiSelection(cur) {
  $$('#options .option').forEach(el => el.classList.toggle('sel', cur.has(el.dataset.label)));
}
function grade(selected) {
  if (!session || session.review) return;
  const q = QBYID[session.ids[session.idx]];
  const correct = isCorrect(q, selected);
  session.answers[q.id] = { selected: selected.slice(), correct };
  recordAnswer(q.id, correct, session.mode);
  renderQuiz();
  if (q.type === 'single' && correct && settings.autoNext) {
    const gradedId = q.id;
    setTimeout(() => {
      if (session && state.view === 'quiz' && session.ids[session.idx] === gradedId) nextQuestion();
    }, 1100);
  }
}
function nextQuestion() {
  if (session.idx + 1 >= session.ids.length) {
    navigate('result');
  } else {
    session.idx++;
    renderQuiz();
  }
}

/* ---------- 结果页 ---------- */
function renderResult() {
  setTop(session.title + ' · 结果', true);
  showTabbar(false);
  const total = session.ids.length;
  let correct = 0;
  const items = session.ids.map(id => {
    const a = session.answers[id];
    if (a && a.correct) correct++;
    const q = QBYID[id];
    return { q, a };
  });
  const rate = total ? Math.round(correct / total * 100) : 0;
  $('#view').innerHTML = `
    <div class="result-score">
      <div class="big">${rate}<span style="font-size:22px">分</span></div>
      <div class="sub">答对 ${correct} / ${total} 题 · ${rate >= 80 ? '太棒了！' : rate >= 60 ? '继续加油' : '多多练习'}</div>
    </div>
    <div class="result-stats">
      <div class="rs"><div class="n text-ok">${correct}</div><div class="small muted">答对</div></div>
      <div class="rs"><div class="n text-bad">${total - correct}</div><div class="small muted">答错</div></div>
      <div class="rs"><div class="n">${rate}%</div><div class="small muted">正确率</div></div>
    </div>
    <div class="section-title">答题回顾</div>
    <div class="ans-list">
      ${items.map((it, i) => {
        const done = !!it.a;
        const ok = done && it.a.correct;
        return `<div class="ans-item" data-i="${i}">
          <span class="dot" style="background:${ok ? 'var(--ok)' : done ? 'var(--bad)' : '#cbd5e1'}"></span>
          <span class="qtxt">${i + 1}. ${escapeHTML(it.q.question.length > 28 ? it.q.question.slice(0, 28) + '…' : it.q.question)}</span>
          <span class="ra ${ok ? 'text-ok' : 'text-bad'}">${done ? it.a.selected.join('') : '未做'}</span>
        </div>`;
      }).join('')}
    </div>
    <div style="padding:10px 12px 20px;display:flex;gap:10px">
      <button class="btn btn-ghost" id="retryWrong" style="flex:1">重练错题</button>
      <button class="btn btn-primary" id="backHome" style="flex:2">完成</button>
    </div>
  `;
  $$('.ans-item').forEach(it => it.onclick = () => {
    session.idx = +it.dataset.i;
    session.review = true;
    navigate('quiz');
  });
  $('#backHome').onclick = goBack;
  $('#retryWrong').onclick = () => {
    const wrongIds = items.filter(it => it.a && !it.a.correct).map(it => it.q.id);
    if (!wrongIds.length) { toast('全部答对，无需重练 🎉'); return; }
    session = { ids: wrongIds, idx: 0, answers: {}, mode: 'wrong', seed: newSeed(), title: session.title + ' · 错题重练' };
    navigate('quiz');
  };
}

/* ============== 模拟考试 ============== */
function renderExamSetup() {
  setTop('模拟考试', true);
  showTabbar(true);
  const cfg = Object.assign({ count: 50, minutes: 60, scope: 'all' }, state.params.cfg || {});
  const recent = exams.slice(-5).reverse();
  $('#view').innerHTML = `
    <div class="card">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px">考试设置</div>
      <div class="small muted">限时作答，交卷后统一评分，${PASS_SCORE} 分及格</div>
    </div>
    <div class="setting-item">
      <div><div class="st">题目数量</div><div class="sd">从题库随机抽取</div></div>
      <div class="seg" id="cntSeg">
        ${[20, 50, 100].map(n => `<span class="${cfg.count === n ? 'on' : ''}" data-n="${n}">${n}题</span>`).join('')}
      </div>
    </div>
    <div class="setting-item">
      <div><div class="st">考试时长</div><div class="sd">倒计时结束自动交卷</div></div>
      <div class="seg" id="minSeg">
        ${[30, 60, 90].map(n => `<span class="${cfg.minutes === n ? 'on' : ''}" data-n="${n}">${n}分</span>`).join('')}
      </div>
    </div>
    <div class="setting-item">
      <div><div class="st">考试范围</div><div class="sd">全部章节或指定章节</div></div>
      <select id="scopeSel" class="select">
        <option value="all" ${cfg.scope === 'all' ? 'selected' : ''}>全部章节</option>
        ${CHAPTERS.map(c => `<option value="${escapeHTML(c)}" ${cfg.scope === c ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}
      </select>
    </div>
    <div style="padding:16px 12px">
      <button class="btn btn-primary" id="startExam">开始考试</button>
    </div>
    ${recent.length ? `
      <div class="section-title">最近考试记录</div>
      <div class="list">
        ${recent.map(e => `<div class="list-item">
          <div class="li-ic">${e.pass ? '✅' : '❌'}</div>
          <div class="li-main">
            <div class="li-t">${e.score} 分 · ${e.correct}/${e.total} 题</div>
            <div class="li-s">${new Date(e.at).toLocaleString('zh-CN', { hour12: false })} · 用时 ${fmtDuration(e.usedSec)} · ${e.scope === 'all' ? '全部章节' : escapeHTML(e.scope)}</div>
          </div>
        </div>`).join('')}
      </div>` : ''}
  `;
  $$('#cntSeg span').forEach(s => s.onclick = () => {
    cfg.count = +s.dataset.n; state.params.cfg = cfg; renderExamSetup();
  });
  $$('#minSeg span').forEach(s => s.onclick = () => {
    cfg.minutes = +s.dataset.n; state.params.cfg = cfg; renderExamSetup();
  });
  const sel = $('#scopeSel');
  sel.onchange = () => { cfg.scope = sel.value; state.params.cfg = cfg; };
  $('#startExam').onclick = () => { cfg.scope = sel.value; startExam(cfg); };
}

function startExam(cfg) {
  let pool = cfg.scope === 'all' ? QS : QS.filter(q => q.chapter === cfg.scope);
  if (pool.length > cfg.count) pool = shuffle(pool);
  const ids = pool.slice(0, Math.min(cfg.count, pool.length)).map(q => q.id);
  session = {
    ids, idx: 0, answers: {}, mode: 'exam',
    seed: newSeed(),
    title: '模拟考试',
    total: ids.length,
    durationSec: cfg.minutes * 60,
    startAt: Date.now(),
    scope: cfg.scope,
    cfg: { count: cfg.count, minutes: cfg.minutes, scope: cfg.scope },
  };
  navigate('exam');
}

function examAnsweredCount() {
  return session.ids.filter(id => session.answers[id] && session.answers[id].selected.length).length;
}

function renderExam() {
  setTop('模拟考试', true);
  showTabbar(false);
  const q = QBYID[session.ids[session.idx]];
  const total = session.ids.length;
  const ans = session.answers[q.id];
  const selected = ans ? ans.selected : [];
  const options = orderedOptions(q);
  const answered = examAnsweredCount();

  $('#view').innerHTML = `
    <div class="exam-head">
      <div class="exam-timer" id="examTimer">--:--</div>
      <div class="small muted">已答 <b id="answeredNum">${answered}</b>/${total}</div>
    </div>
    <div class="quiz-bar"><div class="fill" style="width:${session.idx / total * 100}%"></div></div>

    <div class="quiz-top">
      <div><span class="qno">${session.idx + 1}/${total}</span>
        <span class="chip ${q.type === 'single' ? 'chip-single' : 'chip-multi'}">${q.type === 'single' ? '单选题' : '多选题'}</span>
        <span class="small muted">${escapeHTML(q.chapter)}</span>
      </div>
      <button class="fav-btn" id="favBtn" aria-label="收藏">${getP(q.id).fav ? '⭐' : '☆'}</button>
    </div>

    <div class="question-card">
      <div class="qstem">${renderStem(q.question)}</div>
    </div>

    <div class="options" id="options">
      ${options.map(o => `<div class="option ${selected.includes(o.label) ? 'sel' : ''}" data-label="${o.label}">
        <div class="olabel">${o.label}</div><div class="otext">${escapeHTML(o.text)}</div></div>`).join('')}
    </div>
    ${q.type === 'multi' ? '<div class="multi-hint">多选题，可选择多个选项</div>' : ''}

    <div class="quiz-foot">
      <button class="btn btn-ghost" id="prevBtn" style="flex:1;${session.idx === 0 ? 'opacity:.4;' : ''}" ${session.idx === 0 ? 'disabled' : ''}>上一题</button>
      <button class="btn btn-ghost" id="sheetBtn" style="flex:1">答题卡</button>
      <button class="btn btn-primary" id="nextBtn" style="flex:1.4">${session.idx + 1 >= total ? '交卷' : '下一题'}</button>
    </div>
  `;

  $('#favBtn').onclick = () => {
    const pp = ensureP(q.id);
    pp.fav = !pp.fav; saveProgress();
    $('#favBtn').textContent = pp.fav ? '⭐' : '☆';
    toast(pp.fav ? '已收藏' : '已取消收藏');
  };
  $$('.option').forEach(el => el.onclick = () => {
    const label = el.dataset.label;
    // 从 DOM 读取当前已选，避免闭包里的 selected 过期（多选题会丢失前一次选择）
    const cur = new Set($$('#options .option.sel').map(x => x.dataset.label));
    if (q.type === 'single') { cur.clear(); cur.add(label); }
    else { if (cur.has(label)) cur.delete(label); else cur.add(label); }
    session.answers[q.id] = { selected: [...cur] };
    el.classList.toggle('sel', cur.has(label));
    if (q.type === 'single') $$('.option').forEach(o => { if (o !== el) o.classList.remove('sel'); });
    $('#answeredNum').textContent = examAnsweredCount();
  });
  $('#prevBtn').onclick = () => { if (session.idx > 0) { session.idx--; renderExam(); } };
  $('#nextBtn').onclick = () => {
    if (session.idx + 1 >= total) confirmSubmitExam();
    else { session.idx++; renderExam(); }
  };
  $('#sheetBtn').onclick = openAnswerSheet;

  clearExamTimer();
  const tick = () => {
    const left = Math.max(0, session.durationSec - Math.floor((Date.now() - session.startAt) / 1000));
    const el = $('#examTimer');
    if (!el) { clearExamTimer(); return; }
    el.textContent = fmtDuration(left);
    el.classList.toggle('warn', left <= 60);
    if (left <= 0) { clearExamTimer(); toast('考试时间到，自动交卷'); submitExam(true); }
  };
  tick();
  examTimer = setInterval(tick, 1000);
}

function openAnswerSheet() {
  if (!session || session.examScore !== undefined) return;
  const total = session.ids.length;
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div style="font-weight:700">答题卡</div>
        <div class="small muted">已答 ${examAnsweredCount()}/${total}</div>
      </div>
      <div class="sheet-grid">
        ${session.ids.map((id, i) => {
          const a = session.answers[id];
          const cls = i === session.idx ? 'cur' : (a && a.selected.length ? 'done' : '');
          return `<div class="sheet-cell ${cls}" data-i="${i}">${i + 1}</div>`;
        }).join('')}
      </div>
      <div class="sheet-legend"><span class="legend-dot" style="background:var(--primary)"></span>当前
        <span class="legend-dot" style="background:var(--ok);margin-left:12px"></span>已答
        <span class="legend-dot" style="background:#e2e8f0;margin-left:12px"></span>未答</div>
      <div class="sheet-foot">
        <button class="btn btn-primary" id="sheetSubmit">交卷</button>
      </div>
      <div class="sheet-close" id="sheetClose">关闭</div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  $('#sheetClose', overlay).onclick = () => overlay.remove();
  $$('.sheet-cell', overlay).forEach(c => c.onclick = () => {
    session.idx = +c.dataset.i; overlay.remove(); renderExam();
  });
  $('#sheetSubmit', overlay).onclick = () => { overlay.remove(); confirmSubmitExam(); };
}

function confirmSubmitExam() {
  const unanswered = session.ids.length - examAnsweredCount();
  const msg = unanswered > 0
    ? `还有 ${unanswered} 道题未作答，确定交卷吗？`
    : '确定交卷并查看成绩吗？';
  if (confirm(msg)) submitExam(false);
}

function submitExam(auto) {
  if (!session || session.examScore !== undefined) return; // 防止重复交卷写入多条记录
  clearExamTimer();
  $$('.sheet-overlay').forEach(o => o.remove());
  const usedSec = Math.min(session.durationSec, Math.floor((Date.now() - session.startAt) / 1000));
  let correct = 0, single = { t: 0, c: 0 }, multi = { t: 0, c: 0 };
  const items = session.ids.map(id => {
    const q = QBYID[id];
    const a = session.answers[id];
    const sel = a ? a.selected : [];
    const ok = sel.length > 0 && isCorrect(q, sel);
    if (ok) correct++;
    if (q.type === 'single') { single.t++; if (ok) single.c++; } else { multi.t++; if (ok) multi.c++; }
    if (sel.length > 0) recordAnswer(id, ok, 'exam');
    return { q, sel, ok };
  });
  const score = Math.round(correct / session.ids.length * 100);
  const rec = {
    at: Date.now(), total: session.ids.length, correct, score, usedSec,
    scope: session.scope, pass: score >= PASS_SCORE,
  };
  exams.push(rec);
  save(K.exams, exams);
  session.examItems = items;
  session.examScore = score;
  session.examUsed = usedSec;
  session.examSingle = single;
  session.examMulti = multi;
  session.examAuto = !!auto;
  navigate('examResult');
}

function renderExamResult() {
  setTop('考试成绩', true);
  showTabbar(false);
  const score = session.examScore;
  const pass = score >= PASS_SCORE;
  const items = session.examItems;
  const total = items.length;
  const correct = items.filter(i => i.ok).length;
  const wrong = items.filter(i => !i.ok);
  $('#view').innerHTML = `
    <div class="result-score ${pass ? '' : 'fail'}">
      <div class="big">${score}<span style="font-size:22px">分</span></div>
      <div class="sub">${pass ? '🎉 恭喜通过（≥' + PASS_SCORE + '分）' : '未通过（＜' + PASS_SCORE + '分），继续努力'}${session.examAuto ? ' · 超时自动交卷' : ''}</div>
      <div class="sub" style="margin-top:4px">用时 ${fmtDuration(session.examUsed)} · 答对 ${correct}/${total} 题</div>
    </div>
    <div class="result-stats">
      <div class="rs"><div class="n text-ok">${session.examSingle.c}/${session.examSingle.t}</div><div class="small muted">单选</div></div>
      <div class="rs"><div class="n" style="color:#b45309">${session.examMulti.c}/${session.examMulti.t}</div><div class="small muted">多选</div></div>
      <div class="rs"><div class="n text-bad">${wrong.length}</div><div class="small muted">错题</div></div>
    </div>
    <div class="section-title">答题详情（点击查看解析）</div>
    <div class="ans-list">
      ${items.map((it, i) => `<div class="ans-item" data-id="${it.q.id}">
        <span class="dot" style="background:${it.ok ? 'var(--ok)' : 'var(--bad)'}"></span>
        <span class="qtxt">${i + 1}. ${escapeHTML(it.q.question.length > 26 ? it.q.question.slice(0, 26) + '…' : it.q.question)}</span>
        <span class="ra ${it.ok ? 'text-ok' : 'text-bad'}">${it.sel.length ? it.sel.join('') : '未答'}</span>
      </div>`).join('')}
    </div>
    <div style="padding:10px 12px 20px;display:flex;gap:10px">
      <button class="btn btn-ghost" id="againBtn" style="flex:1">再考一次</button>
      <button class="btn btn-primary" id="examHome" style="flex:1.4">返回首页</button>
    </div>
  `;
  $$('.ans-item').forEach(it => it.onclick = () => navigate('detail', { id: +it.dataset.id, from: 'exam' }));
  $('#againBtn').onclick = () => navigate('examSetup', session && session.cfg ? { cfg: { ...session.cfg } } : {});
  $('#examHome').onclick = () => { session = null; switchTab('home'); };
}

/* ============== 题目搜索 ============== */
function searchQuestions(kw) {
  const k = kw.trim().toLowerCase();
  if (!k) return [];
  return QS.filter(q =>
    q.question.toLowerCase().includes(k) ||
    q.chapter.toLowerCase().includes(k) ||
    q.options.some(o => o.text.toLowerCase().includes(k))
  );
}
function highlight(text, kw) {
  const k = kw.trim();
  if (!k) return escapeHTML(text);
  const idx = text.toLowerCase().indexOf(k.toLowerCase());
  if (idx < 0) return escapeHTML(text);
  return escapeHTML(text.slice(0, idx)) + '<mark>' + escapeHTML(text.slice(idx, idx + k.length)) + '</mark>' + escapeHTML(text.slice(idx + k.length));
}

function renderSearch() {
  setTop('题目搜索', true);
  showTabbar(false);
  const kw = state.params.q !== undefined ? state.params.q : lastSearchQuery;
  $('#view').innerHTML = `
    <div class="search-box">
      <span class="sb-ic">🔍</span>
      <input id="searchInput" class="search-input" placeholder="输入题干/选项/章节关键词" value="${escapeHTML(kw)}" autocomplete="off" />
    </div>
    <div class="small muted" style="margin:10px 16px" id="searchMeta"></div>
    <div class="list" id="searchResults"></div>
  `;
  const input = $('#searchInput');

  const updateResults = (k) => {
    const results = k.trim() ? searchQuestions(k) : [];
    $('#searchMeta').innerHTML = k.trim() ? `找到 <b>${results.length}</b> 道相关题目` : `共 ${TOTAL} 道题，输入关键词开始搜索`;
    const box = $('#searchResults');
    box.innerHTML = results.map(q => `<div class="list-item" data-id="${q.id}">
        <div class="li-ic">${q.type === 'single' ? '🔹' : '🔸'}</div>
        <div class="li-main">
          <div class="li-t">${highlight(q.question, k)}</div>
          <div class="li-s">${escapeHTML(q.chapter)} · ${q.type === 'single' ? '单选' : '多选'}</div>
        </div>
        <div class="li-arr">›</div>
      </div>`).join('') + (k.trim() && results.length === 0 ? '<div class="empty"><span class="ei">🔍</span>没有找到相关题目，换个关键词试试</div>' : '');
    $$('#searchResults .list-item').forEach(it => it.onclick = () => navigate('detail', { id: +it.dataset.id, from: 'search' }));
  };
  updateResults(kw);

  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { lastSearchQuery = input.value; state.params.q = input.value; updateResults(input.value); }, 180);
  };
  input.focus();
  const len = input.value.length;
  input.setSelectionRange(len, len);
}

function renderDetail() {
  const q = QBYID[state.params.id];
  if (!q) { navigate('search'); return; }
  const from = state.params.from;
  setTop('题目详情', true);
  showTabbar(false);
  const p = getP(q.id); // 只读
  $('#view').innerHTML = `
    <div class="quiz-top">
      <div><span class="chip ${q.type === 'single' ? 'chip-single' : 'chip-multi'}">${q.type === 'single' ? '单选题' : '多选题'}</span>
        <span class="small muted">${escapeHTML(q.chapter)}</span>
      </div>
      <button class="fav-btn" id="favBtn">${p.fav ? '⭐' : '☆'}</button>
    </div>
    <div class="question-card">
      <div class="qstem">${renderStem(q.question)}</div>
    </div>
    <div class="options">
      ${q.options.map(o => `<div class="option ${q.answerList.includes(o.label) ? 'show-correct' : ''}">
        <div class="olabel">${o.label}</div><div class="otext">${escapeHTML(o.text)}</div></div>`).join('')}
    </div>
    <div class="feedback ok show">
      <div class="ft">正确答案：${q.answer}</div>
      <div class="fans">${q.answerList.map(l => { const op = q.options.find(x => x.label === l); return op ? `${l}. ${escapeHTML(op.text)}` : ''; }).join('；')}</div>
    </div>
    <div class="card row small muted">
      <div>历史作答：答对 ${p.correct} 次 · 答错 ${p.wrong} 次</div>
      <div>${p.mastered ? '<span class="chip chip-ok">已掌握</span>' : (p.wrongActive ? '<span class="chip chip-bad">错题中</span>' : '')}</div>
    </div>
    <div style="padding:6px 12px 20px">
      <button class="btn btn-ghost btn-block" id="backFromDetail">返回</button>
    </div>
  `;
  $('#favBtn').onclick = () => {
    const pp = ensureP(q.id);
    pp.fav = !pp.fav; saveProgress();
    $('#favBtn').textContent = pp.fav ? '⭐' : '☆';
    toast(pp.fav ? '已收藏' : '已取消收藏');
  };
  $('#backFromDetail').onclick = goBack;
}

/* ============== 初始化 ============== */
function init() {
  $$('.tab').forEach(t => t.onclick = () => switchTab(t.dataset.tab));
  $('#searchBtn').onclick = () => navigate('search');
  $('#backBtn').onclick = goBack;
  render();
}
document.addEventListener('DOMContentLoaded', init);