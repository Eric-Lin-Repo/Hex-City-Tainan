// audio.js — 全部用 Web Audio API 合成的環境音與活動音效，沒有任何外部素材。
//
// ── 接到 app.js 的方式（由主控負責加，這個檔案不碰其他檔案）──
//
// 1. 建立（不需要使用者手勢，只建物件；AudioContext 要到 enable() 才建）：
//      import { createAudio } from "./audio.js";
//      const audio = createAudio();            // 放在 createTrains 之前
//
// 2. 火車鳴笛：createTrains 多傳一個 onDepart 回呼（train.js 已支援）：
//      const trains = createTrains(THREE, scene, infra.services, terrain.heightAt, audio.trainHorn);
//    火車離站時會呼叫 audio.trainHorn()（內建 2 秒節流，關閉聲音時是 no-op）。
//
// 3. HUD「聲音」開關：index.html 的圖層群組加一顆
//      <button class="tg" data-toggle="sound" aria-pressed="false" title="環境音與活動音效（全部即時合成）">聲音</button>
//    在既有 .tg click handler 裡加（必須在 click 事件內呼叫，瀏覽器才允許啟動 AudioContext）：
//      if (k === "sound") { audio.toggle(); toggles.sound = audio.enabled; b.setAttribute("aria-pressed", String(audio.enabled)); }
//    toggles 物件加 sound: false；TOGGLE_MSG 加 sound: ["已開啟聲音", "已關閉聲音"]。
//    syncUrl 的 for 迴圈只列 4 個 key，所以 sound 不會進網址（也不該進：重新載入時沒有手勢無法自動播放）。
//
// 4. 目前可見的效果種類 activeEffects：建議在 events.js 的回傳物件加一個方法（groupOf 與 group 都在閉包內）：
//      function activeKinds() { const s = new Set(); if (group.visible) for (const e of list) if (groupOf.get(e.id)?.visible) s.add(e.effect); return [...s]; }
//      return { update, setVisible, setActive, activeKinds, events: list, pickables };
//    因為它會配置陣列，不要每幀呼叫；在 app.js 的 applyEvent() 尾端與 events 開關切換時重算一次並快取：
//      let activeKinds = [];                      // 與 applyEvent 同一層
//      ...applyEvent 最後一行： activeKinds = fx.activeKinds();
//      ...events 開關：          if (k === "events") { fx.setVisible(toggles.events); activeKinds = fx.activeKinds(); }
//    若不想動 events.js，也可以在 applyEvent 裡用 `on` 維護一個 Map<id, effect>，再從它導出種類陣列，效果相同。
//
// 5. animate loop（放在 fx.update 之後、render 之前；暫停時也要呼叫，讓它把活動音淡出）：
//      audio.update(dt, {
//        night: nightNow,
//        period: period?.label ?? null,
//        activeEffects: activeKinds,
//        cameraHeight: camera.position.y - TOP,    // 離地高度；越高越小聲（俯瞰時只剩風聲）
//        paused: toggles.pause,
//      });
//
// ── 設計 ──
// 所有節點在第一次 enable() 時建立一次，之後只調整增益（setTargetAtTime）與排程打擊（AudioParam 自動化），
// update() 內不配置任何物件。持續的材質（風、蟋蟀、炮竹、火）是預先算好的短 buffer 循環播放；
// 有音高的打擊（鳥叫、鼓、鑼、kick、bass、風鈴、汽笛）用常駐振盪器加 gate 增益包絡，不會每次打擊都新建節點。

export function createAudio() {
  const MASTER = 0.25; // 總音量：全部都很小聲
  const SMOOTH = 0.35; // 圖層增益的時間常數（秒）
  const LOOKAHEAD = 0.12; // 排程提前量（秒）
  const EMPTY = [];
  const FLOOR = 0.0001; // exponentialRamp 不能到 0

  let ctx = null, enabled = false, master = null, suspendTimer = 0, hornLast = -Infinity, birdIdx = 0;
  const layers = {}; // name -> { gain, applied }
  const pat = {}; // name -> { next, step }
  const inst = {}; // 常駐樂器

  // ── 建圖 ──
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  function gainNode(v, to) { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
  function osc(type, freq, to, detune = 0) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune; o.connect(to); o.start(); return o; }
  function filter(type, freq, Q, to) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; f.connect(to); return f; }
  function loop(buffer, to, offset = 0) { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.connect(to); s.start(0, offset); return s; }
  function layer(name) { const g = gainNode(0, master); layers[name] = { gain: g, applied: 0 }; pat[name] = { next: -1, step: 0 }; return g; }
  function makeBuffer(seconds, fill) {
    const sr = ctx.sampleRate || 44100, n = Math.max(1, Math.floor(seconds * sr));
    const b = ctx.createBuffer(1, n, sr);
    fill(b.getChannelData(0), sr);
    return b;
  }
  const fillWhite = (d) => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
  // 蟋蟀：兩隻不同節奏的脈衝串正弦波，buffer 長度是兩者週期的公倍數所以循環無縫
  const fillCrickets = (d, sr) => {
    const voices = [{ f: 4300, pulse: 24, on: 0.35, period: 0.65, amp: 0.5 }, { f: 3900, pulse: 19, on: 0.28, period: 0.52, amp: 0.35 }];
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const v of voices) {
        const ph = (t % v.period) / v.on;
        if (ph >= 1) continue;
        const pulse = (t * v.pulse) % 1;
        if (pulse > 0.4) continue;
        s += Math.sin(2 * Math.PI * v.f * t) * v.amp * Math.sin(Math.PI * ph) * Math.sin(Math.PI * pulse / 0.4);
      }
      d[i] = s;
    }
  };
  // 隨機爆響：count 個短噪音脈衝，指數衰減
  const fillPops = (count, minLen, maxLen) => (d, sr) => {
    for (let k = 0; k < count; k++) {
      const len = Math.floor(rand(minLen, maxLen) * sr), start = Math.floor(Math.random() * (d.length - len)), amp = rand(0.25, 1);
      for (let i = 0; i < len; i++) d[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len * 0.3));
    }
    for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
  };

  // 打擊包絡與音高掃描（都用自動化，不建節點）
  function env(p, t, peak, attack, decay, hold = 0) {
    p.cancelScheduledValues(t);
    p.setValueAtTime(FLOOR, t);
    p.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) p.setValueAtTime(peak, t + attack + hold);
    p.exponentialRampToValueAtTime(FLOOR, t + attack + hold + decay);
  }
  function sweep(p, t, f0, f1, d) { p.cancelScheduledValues(t); p.setValueAtTime(f0, t); p.exponentialRampToValueAtTime(f1, t + d); }

  function build() {
    master = gainNode(0, ctx.destination);
    const white = makeBuffer(2.9, fillWhite);
    const popsA = makeBuffer(3.7, fillPops(46, 0.004, 0.03));
    const popsB = makeBuffer(5.3, fillPops(38, 0.006, 0.045));

    // 風：低通白噪音，兩個 LFO 慢慢推濾波頻率
    const wind = layer("wind");
    const windF = filter("lowpass", 320, 0.7, wind);
    loop(white, windF);
    osc("sine", 0.06, gainNode(140, windF.frequency));
    osc("sine", 0.17, gainNode(55, windF.frequency));

    // 鳥：兩個常駐正弦聲部，各自一個 gate
    const birds = layer("birds");
    inst.birds = [0, 1].map(() => { const gate = gainNode(0, birds); return { gate, osc: osc("sine", 3000, gate) }; });

    // 蟋蟀：預算好的脈衝串循環，帶通修掉粗糙感
    const crickets = layer("crickets");
    loop(makeBuffer(2.6, fillCrickets), filter("bandpass", 4200, 2.5, crickets));

    // 通勤尖峰的遠方車流：帶通噪音 + 兩個低頻鋸齒嗡嗡聲
    const traffic = layer("traffic");
    loop(white, filter("bandpass", 230, 1.2, gainNode(0.6, traffic)), 0.7);
    const hum = filter("lowpass", 130, 0.8, gainNode(0.35, traffic));
    osc("sawtooth", 46, hum);
    osc("sawtooth", 49.3, hum);

    // 煙火／蜂炮：兩段不同長度的爆響循環（合成週期很長），加一個低音轟
    const fireworks = layer("fireworks");
    loop(popsA, filter("bandpass", 2400, 0.8, gainNode(0.7, fireworks)));
    loop(popsB, filter("bandpass", 1500, 0.9, gainNode(0.6, fireworks)));
    const boomGate = gainNode(0, fireworks);
    inst.boom = { gate: boomGate, osc: osc("sine", 60, boomGate) };

    // 蜈蚣陣／遊行：低音鼓 + 鑼（非諧和分音）
    const drums = layer("drums");
    const drumGate = gainNode(0, drums);
    inst.drum = { gate: drumGate, osc: osc("sine", 80, drumGate) };
    const gongGate = gainNode(0, filter("lowpass", 3500, 0.5, drums));
    inst.gong = { gate: gongGate, oscs: [1, 1.47, 2.09, 2.73, 3.56].map((r, i) => osc("sine", 196 * r, gainNode(1 / (i + 1.5), gongGate))) };

    // 海灘舞台：four-on-the-floor kick + 兩音 bass
    const beach = layer("beach");
    const kickGate = gainNode(0, beach);
    inst.kick = { gate: kickGate, osc: osc("sine", 150, kickGate) };
    const bassGate = gainNode(0, beach);
    inst.bass = { gate: bassGate, osc: osc("sawtooth", 55, filter("lowpass", 300, 1.5, bassGate)) };

    // 燈節：五支五聲音階的風鈴管
    const chimes = layer("chimes");
    inst.chimes = [1318.5, 1568, 1760, 2093, 2349].map((f) => { const gate = gainNode(0, chimes); return { gate, osc: osc("sine", f, gate) }; });

    // 燒王船：低頻火焰轟鳴 + 高頻劈啪（共用 popsA，接到另一個濾波器）
    const fire = layer("fire");
    const roar = filter("lowpass", 420, 0.8, gainNode(0.8, fire));
    loop(white, roar, 1.3);
    osc("sine", 0.9, gainNode(160, roar.frequency));
    loop(popsA, filter("highpass", 2600, 0.7, gainNode(0.45, fire)), 1.9);

    // 柴油汽笛：兩個音各一對微失諧的鋸齒波，低通
    const horn = layer("horn");
    const hornGate = gainNode(0, filter("lowpass", 900, 1.2, horn));
    inst.horn = { gate: hornGate, oscs: [[311, -6], [311, 6], [370, -5], [370, 5]].map(([f, c]) => osc("sawtooth", f, hornGate, c)) };
  }

  function ensureContext() {
    if (ctx) return true;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); build(); } catch (err) { console.warn("[audio] 無法建立 AudioContext", err); ctx = null; return false; }
    return true;
  }

  // ── 打擊 ──
  function chirp(t) {
    const v = inst.birds[birdIdx++ % inst.birds.length];
    const g = v.gate.gain, f = v.osc.frequency;
    const n = 2 + Math.floor(Math.random() * 3), f0 = rand(2400, 4200), up = Math.random() < 0.6;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    let tt = t;
    for (let i = 0; i < n; i++) {
      const len = rand(0.05, 0.1), gap = rand(0.04, 0.12), fa = f0 * rand(0.95, 1.05), fb = fa * (up ? 1.25 : 0.8);
      f.setValueAtTime(fa, tt);
      f.exponentialRampToValueAtTime(fb, tt + len);
      g.setValueAtTime(FLOOR, tt);
      g.linearRampToValueAtTime(0.35, tt + 0.012);
      g.exponentialRampToValueAtTime(FLOOR, tt + len);
      tt += len + gap;
    }
  }
  function boom(t, big) {
    sweep(inst.boom.osc.frequency, t, big ? 75 : 65, 30, 0.5);
    env(inst.boom.gate.gain, t, big ? 0.9 : 0.6, 0.01, big ? 1.1 : 0.8);
  }
  function thump(t, vel) {
    sweep(inst.drum.osc.frequency, t, 92, 44, 0.12);
    env(inst.drum.gate.gain, t, 0.8 * vel, 0.005, 0.35);
  }
  function gong(t) {
    for (const o of inst.gong.oscs) o.detune.setValueAtTime(rand(-10, 10), t);
    env(inst.gong.gate.gain, t, 0.45, 0.008, 2.6);
  }
  function kick(t) {
    sweep(inst.kick.osc.frequency, t, 160, 42, 0.08);
    env(inst.kick.gate.gain, t, 0.9, 0.004, 0.28);
  }
  function bassNote(t, f) {
    inst.bass.osc.frequency.cancelScheduledValues(t);
    inst.bass.osc.frequency.setValueAtTime(f, t);
    env(inst.bass.gate.gain, t, 0.45, 0.01, 0.08, 0.17);
  }
  function chime(t) {
    const c = inst.chimes[Math.floor(Math.random() * inst.chimes.length)];
    env(c.gate.gain, t, rand(0.12, 0.3), 0.004, rand(1.4, 2.4));
  }
  const DRUM = [[0.55, 1], [0.55, 0.75], [0.28, 0.55], [0.27, 0.55], [0.55, 1], [0.85, 0.85]]; // [下一拍間隔, 力度]
  const BASS = [55, 55, 65.41, 55, 55, 65.41, 65.41, 55], EIGHTH = 60 / 124 / 2;

  // ── 每幀 ──
  function setTarget(name, v, now) {
    const L = layers[name];
    if (Math.abs(v - L.applied) < 0.003) return;
    L.applied = v;
    L.gain.gain.setTargetAtTime(v, now, SMOOTH);
  }
  // 圖層可聽且到了排程時間就回傳 true；不可聽時把排程歸零，下次啟用從頭開始
  function due(name, audible, now) {
    const p = pat[name];
    if (!audible) { p.next = -1; return false; }
    if (p.next < 0 || p.next < now - 0.5) p.next = now + 0.05; // 剛啟用或分頁被藏起來後重新對時
    return p.next <= now + LOOKAHEAD;
  }

  function update(dt, state) {
    if (!enabled || !ctx || (ctx.state && ctx.state !== "running")) return;
    const s = state || {};
    const now = ctx.currentTime;
    const h = Math.max(0, s.cameraHeight ?? 20);
    const dist = 1 / (1 + (h / 16) * (h / 16)); // 離地越高越小聲：貼地 1、HOME 約 0.35、高空 < 0.1
    const night = clamp01(s.night ?? 0), day = 1 - night;
    const paused = !!s.paused;
    const fxList = s.activeEffects || EMPTY;
    let fw = false, big = false, drums = false, beach = false, chimes = false, fire = false;
    for (let i = 0; i < fxList.length; i++) {
      const k = fxList[i];
      if (k === "fireworks") fw = true;
      else if (k === "bigfireworks") { fw = true; big = true; }
      else if (k === "centipede" || k === "procession") drums = true;
      else if (k === "beachstage") beach = true;
      else if (k === "lanterns") chimes = true;
      else if (k === "boat") fire = true;
    }
    const ev = paused ? 0 : dist; // 暫停時活動音淡出，環境音照常

    const birdsT = 0.5 * day * day * dist, cricketsT = 0.4 * night * night * dist;
    setTarget("wind", 0.32 * (0.55 + 0.45 * Math.min(1, h / 30)), now); // 越高風越大
    setTarget("birds", birdsT, now);
    setTarget("crickets", cricketsT, now);
    setTarget("traffic", s.period === "通勤尖峰" ? 0.28 * dist : 0, now);
    setTarget("fireworks", fw ? 0.45 * ev : 0, now);
    setTarget("drums", drums ? 0.5 * ev : 0, now);
    setTarget("beach", beach ? 0.4 * ev : 0, now);
    setTarget("chimes", chimes ? 0.4 * ev : 0, now);
    setTarget("fire", fire ? 0.5 * ev : 0, now);
    setTarget("horn", 0.8 * Math.max(dist, 0.08), now);

    if (due("birds", birdsT > 0.03, now)) { const t = pat.birds.next; chirp(t); pat.birds.next = t + rand(1.5, 6) / Math.max(0.3, day); }
    if (due("fireworks", fw && !paused, now)) { const t = pat.fireworks.next; boom(t, big); pat.fireworks.next = t + (big ? rand(0.7, 2.5) : rand(1.2, 4)); }
    if (due("drums", drums && !paused, now)) {
      const p = pat.drums, t = p.next, [gap, vel] = DRUM[p.step % DRUM.length];
      thump(t, vel);
      if (p.step % (DRUM.length * 2) === 0) gong(t + 0.02);
      p.step++;
      p.next = t + gap;
    }
    if (due("beach", beach && !paused, now)) {
      const p = pat.beach, t = p.next;
      if (p.step % 2 === 0) kick(t);
      bassNote(t, BASS[p.step % BASS.length]);
      p.step++;
      p.next = t + EIGHTH;
    }
    if (due("chimes", chimes && !paused, now)) { const t = pat.chimes.next; chime(t); pat.chimes.next = t + (Math.random() < 0.3 ? rand(0.08, 0.25) : rand(0.8, 3.5)); }
  }

  // ── 汽笛：兩秒內只響一次 ──
  function trainHorn() {
    if (!enabled || !ctx || (ctx.state && ctx.state !== "running")) return false;
    const now = ctx.currentTime;
    if (now - hornLast < 2) return false;
    hornLast = now;
    env(inst.horn.gate.gain, now, 1, 0.07, 0.18, 0.35); // 約 0.6 秒
    return true;
  }

  // ── 開關 ──
  function enable() {
    if (!ensureContext()) return false;
    clearTimeout(suspendTimer);
    enabled = true;
    if (ctx.state !== "running" && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(MASTER, now, 0.4);
    for (const p of Object.values(pat)) { p.next = -1; p.step = 0; }
    return true;
  }
  function disable() {
    enabled = false;
    if (!ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0, now, 0.08);
    for (const L of Object.values(layers)) { L.gain.gain.cancelScheduledValues(now); L.gain.gain.setTargetAtTime(0, now, 0.08); L.applied = -1; }
    hornLast = -Infinity;
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => { if (!enabled && ctx.suspend) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } }, 400);
  }
  function toggle() { if (enabled) disable(); else enable(); return enabled; }

  return { get enabled() { return enabled; }, enable, disable, toggle, update, trainHorn };
}
