// 猜產地小遊戲：一輪 10 題「🍍 鳳梨是哪一區的？」，在地圖上點區作答（點地面、區名、建築都算那一區）。
// 答完亮出正確產地（specs.highlight），一輪結束顯示分數；滿分放煙火。最佳成績存 localStorage。
// createQuiz({ t, esc, specs, islands, toast, onReveal(key), onPerfect(), onStart(), rnd })
//   → { mount(toolbar, app), answer(districtId) → true（遊戲中，已吃掉這次點選）／false, get active }
const KEY = "hexcity-quiz-best", ROUND = 10;

export function createQuiz({ t, esc, specs, islands, toast, onReveal, onPerfect, onStart, rnd = Math.random }) {
  let btn, panel, q = null; // q = { list, i, score, streak, best, answered }
  let best = 0;
  try { best = +localStorage.getItem(KEY) || 0; } catch {}

  function mount(toolbar, app) {
    btn = document.createElement("button");
    btn.id = "quiz-btn";
    btn.setAttribute("aria-controls", "quiz");
    btn.setAttribute("aria-expanded", "false");
    btn.title = t("quiz.title", "猜產地小遊戲：看特產猜是哪一區");
    toolbar.insertBefore(btn, toolbar.querySelector("#sidebar-toggle")); // 放在「🎮 玩」選單裡時排在集章後面
    btn.textContent = matchMedia("(max-width: 800px)").matches && !btn.closest(".play-menu") ? "🎯" : t("quiz.btn", "🎯 猜產地"); // 手機工具列只放圖示，選單裡放全名
    panel = document.createElement("div");
    panel.id = "quiz"; panel.className = "stamps quiz"; panel.hidden = true; panel.setAttribute("role", "dialog");
    app.appendChild(panel);
    btn.addEventListener("click", () => (panel.hidden ? open() : close()));
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) close();
      else if (e.target.closest("[data-quiz-start]")) start();
      else if (e.target.closest("[data-quiz-skip]")) reveal(null);
      else if (e.target.closest("[data-quiz-next]")) next();
    });
  }
  function open() { panel.hidden = false; btn.setAttribute("aria-expanded", "true"); if (!q) renderIntro(); }
  function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); q = null; }

  function start() {
    // 題目：從所有特產隨機抽 10 項（不重複）；「全年」的加工品也算，產地少的比較難
    const pool = specs.names.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    q = { list: pool.slice(0, ROUND), i: 0, score: 0, streak: 0, maxStreak: 0, answered: false };
    onStart?.();
    render();
  }
  const head = (sub) => `<div class="stamps-head"><b>${esc(t("quiz.title_short", "🎯 猜產地"))}</b><span>${sub}</span><button type="button" data-close aria-label="${esc(t("card.close", "關閉（Esc）"))}">×</button></div>`;
  function renderIntro() {
    panel.innerHTML = `${head(best ? esc(t("quiz.best", "最佳 {n}/{total}", { n: best, total: ROUND })) : "")}
      <p>${esc(t("quiz.intro", "每題給一項台南農特產，在地圖上點你覺得是產地的那一區。有好幾個產地的，點中任何一個都算對。"))}</p>
      <p><button type="button" class="chip act" data-quiz-start>${esc(t("quiz.start", "開始（{n} 題）", { n: ROUND }))}</button></p>`;
  }
  function render(msg = "") {
    const key = q.list[q.i], s = specs.info(key);
    panel.innerHTML = `${head(esc(t("quiz.progress", "第 {i}/{total} 題 · {score} 分", { i: q.i + 1, total: ROUND, score: q.score })))}
      <p class="quiz-q"><span class="quiz-icon">${esc(s.icon)}</span>${esc(t("quiz.question", "{name}是哪一區的？", { name: s.name }))}</p>
      ${msg ? `<p class="quiz-msg">${msg}</p>` : `<p class="muted">${esc(t("quiz.how", "在地圖上點一個區作答"))}${q.streak >= 2 ? ` · ${esc(t("quiz.streak", "連對 {n} 題", { n: q.streak }))}` : ""}</p>`}
      <p>${q.answered ? `<button type="button" class="chip act" data-quiz-next>${esc(q.i + 1 < ROUND ? t("quiz.next", "下一題") : t("quiz.finish", "看結果"))}</button>` : `<button type="button" class="chip" data-quiz-skip>${esc(t("quiz.skip", "不知道，看答案"))}</button>`}</p>`;
  }
  // 地圖點選：回傳 true 表示遊戲吃掉這次點選（不開卡片）
  function answer(id) {
    if (!q || panel.hidden) return false;
    if (q.answered) return true; // 已作答，等按「下一題」；這期間點地圖不開卡片，免得把題目蓋掉
    reveal(id);
    return true;
  }
  function reveal(id) {
    const key = q.list[q.i], ds = specs.districtsOf(key), ok = id != null && ds.includes(id);
    q.answered = true;
    if (ok) { q.score++; q.streak++; q.maxStreak = Math.max(q.maxStreak, q.streak); } else q.streak = 0;
    const where = ds.map((d) => islands.get(d)?.name).filter(Boolean).join(t("list.separator", "、"));
    const picked = id != null ? islands.get(id)?.name : null;
    const msg = ok ? `✅ ${esc(t("quiz.right", "答對！產地：{where}", { where }))}`
      : `❌ ${picked ? esc(t("quiz.wrong", "{picked}不是，產地在：{where}", { picked, where })) : esc(t("quiz.answer", "產地在：{where}", { where }))}`;
    onReveal?.(key);
    render(msg);
  }
  function next() {
    q.i++; q.answered = false;
    if (q.i < ROUND) { render(); return; }
    const { score, maxStreak } = q;
    if (score > best) { best = score; try { localStorage.setItem(KEY, String(best)); } catch {} }
    panel.innerHTML = `${head(esc(t("quiz.best", "最佳 {n}/{total}", { n: best, total: ROUND })))}
      <p class="quiz-q">${esc(t("quiz.result", "這輪答對 {score}/{total} 題", { score, total: ROUND }))}</p>
      <p class="muted">${esc(t("quiz.max_streak", "最多連對 {n} 題", { n: maxStreak }))}</p>
      <p><button type="button" class="chip act" data-quiz-start>${esc(t("quiz.again", "再玩一輪"))}</button></p>`;
    q = null;
    if (score === ROUND) { toast?.(t("quiz.perfect", "全對！台南農產達人 🎆")); onPerfect?.(); }
  }
  return { mount, answer, get active() { return !!q && !panel.hidden; } };
}
