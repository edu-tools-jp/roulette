/* =========================================================================
   指名ルーレット
   - データはすべてブラウザのlocalStorageに保存され、外部には一切送信しない
   ========================================================================= */
(() => {
  'use strict';

  const STORAGE_KEY = 'roulette.v1';

  // ★ 公開のたびに、この値と service-worker.js の VERSION を「同じ値」に変えること。
  //    食い違うと「表示中のファイルが古いようです」の案内が出る（それが食い違い検知のしくみ）。
  const APP_VERSION = '20261009a';

  /* 更新内容は release-notes.json に置く（サーバ上の最新をそのつど読む）。
     公開のたびに、いちばん上へ今回の版の項目を足すこと。 */
  const NOTES_URL = 'release-notes.json';

  /* ---------------- 状態 ---------------- */

  const defaultState = () => ({
    version: 1,
    activeClassId: null,
    settings: { removeAfterPick: true, sound: true, display: 'full', furigana: true, kanaStyle: 'hira' },
    classes: []
  });

  let state = load();
  /** 今回のセッションで指名済みの生徒ID（クラスIDごと）。保存はしない */
  const pickedByClass = new Map();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seed();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.classes)) return seed();
      parsed.settings = Object.assign(defaultState().settings, parsed.settings || {});
      return parsed;
    } catch (e) {
      console.warn('保存データを読み込めませんでした', e);
      return seed();
    }
  }

  function seed() {
    const s = defaultState();
    const c = newClass('1組');
    s.classes.push(c);
    s.activeClassId = c.id;
    return s;
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存できませんでした（ブラウザの空き容量を確認してください）');
    }
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function newClass(name) {
    return { id: uid(), name, students: [] };
  }

  function activeClass() {
    return state.classes.find(c => c.id === state.activeClassId) || state.classes[0] || null;
  }

  function pickedSet() {
    const c = activeClass();
    if (!c) return new Set();
    if (!pickedByClass.has(c.id)) pickedByClass.set(c.id, new Set());
    return pickedByClass.get(c.id);
  }

  /* ---------------- 名前の扱い ---------------- */

  /** 「山田 太郎」のような1つの文字列を姓と名に分ける */
  function splitName(raw) {
    const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const parts = s.split(' ');
    if (parts.length >= 2) {
      return { last: parts[0], first: parts.slice(1).join(' ') };
    }
    return { last: s, first: '' };
  }

  function displayName(st, mode) {
    return nameParts(st, mode).map(p => p.text).join(' ');
  }

  /* --- ふりがな ---
     名簿には入力・取り込みしたままの文字で持ち、表示するときに
     設定（ひらがな／カタカナ）にそろえる。校務システムの書き出しはカタカナが多いため。 */

  /** カタカナ（半角も）をひらがなに */
  function toHira(s) {
    return String(s || '').normalize('NFKC')
      .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function toKata(s) {
    return String(s || '').normalize('NFKC')
      .replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  }

  /** 設定（ひらがな／カタカナ）の文字にそろえる */
  function styleKana(s) {
    if (!s) return '';
    return state.settings.kanaStyle === 'kata' ? toKata(s) : toHira(s);
  }

  /** ひらがな・カタカナ・長音・空白だけでできているか */
  function isKanaText(s) {
    return /^[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9F\s・]+$/.test(String(s || '').trim());
  }

  /** 漢字の上に出すふりがな。表示しないときや、名前がかなで読みと同じときは空にする */
  function rubyFor(base, kana) {
    if (!state.settings.furigana || !kana) return '';
    const k = styleKana(kana);
    return toHira(k).replace(/\s/g, '') === toHira(base).replace(/\s/g, '') ? '' : k.trim();
  }

  /**
   * 表示する名前を「文字」と「ふりがな」の組で返す（フルネームなら姓と名の2組）。
   * 名前の表示（フルネーム／姓のみ／名のみ）に合わせて、ふりがなも同じ部分だけを出す。
   */
  function nameParts(st, mode) {
    const m = mode || state.settings.display;
    const last = (st.last || '').trim(), first = (st.first || '').trim();
    const kl = (st.kanaLast || '').trim(), kf = (st.kanaFirst || '').trim();
    let parts;
    if (m === 'last') parts = last ? [[last, kl]] : [[first, kf]];
    else if (m === 'first') parts = first ? [[first, kf]] : [[last, kl]];
    else {
      parts = [];
      if (last) parts.push([last, kl]);
      if (first) parts.push([first, kf]);
      // フルネームが1つの欄に入っていて、読みだけ姓・名に分かれているときは、読みをまとめて振る
      if (parts.length === 1) parts[0][1] = [kl, kf].filter(Boolean).join(' ');
    }
    return parts.filter(p => p[0]).map(([text, kana]) => ({ text, kana: rubyFor(text, kana) }));
  }

  /** 要素の中に、ふりがな付きの名前を入れる */
  function renderName(target, st) {
    const parts = nameParts(st);
    target.textContent = '';
    parts.forEach((p, i) => {
      if (i) target.append(' ');
      if (!p.kana) { target.append(p.text); return; }
      const ruby = document.createElement('ruby');
      const rt = document.createElement('rt');
      rt.textContent = p.kana;
      ruby.append(p.text, rt);
      target.append(ruby);
    });
    target.classList.toggle('has-ruby', parts.some(p => p.kana));
  }

  /**
   * 盤面に並べる生徒。
   * 「対象外」の生徒も、見た目はほかの生徒とまったく同じように並べる。
   * 盤に名前が無いこと自体が本人や周囲に分かってしまわないようにするため。
   */
  function wheelEntries() {
    const c = activeClass();
    if (!c) return [];
    const picked = pickedSet();
    return c.students.filter(st => {
      if (state.settings.removeAfterPick && picked.has(st.id)) return false;
      return displayName(st) !== '';
    });
  }

  /** 実際に当選しうる生徒。盤に並んでいても「対象外」の生徒はここに入らない */
  function eligible() {
    return wheelEntries().filter(st => !st.excluded);
  }

  /* ---------------- 要素 ---------------- */

  const $ = sel => document.querySelector(sel);
  const el = {
    tabs: document.querySelectorAll('.tab'),
    views: { spin: $('#view-spin'), roster: $('#view-roster') },
    classSelect: $('#classSelect'),
    // spin
    canvas: $('#wheel'),
    spinBtn: $('#spinBtn'),
    resultCard: $('#resultCard'),
    resultName: $('#resultName'),
    skipBtn: $('#skipBtn'),
    optRemove: $('#optRemove'),
    optSound: $('#optSound'),
    optDisplay: $('#optDisplay'),
    optFurigana: $('#optFurigana'),
    optKanaStyle: $('#optKanaStyle'),
    remainCount: $('#remainCount'),
    history: $('#history'),
    historyEmpty: $('#historyEmpty'),
    resetBtn: $('#resetBtn'),
    // roster
    classList: $('#classList'),
    addClassBtn: $('#addClassBtn'),
    rosterTitle: $('#rosterTitle'),
    rosterBody: $('#rosterBody'),
    rosterEmpty: $('#rosterEmpty'),
    rosterSummary: $('#rosterSummary'),
    addStudentBtn: $('#addStudentBtn'),
    clearRosterBtn: $('#clearRosterBtn'),
    importTextBtn: $('#importTextBtn'),
    importExcelBtn: $('#importExcelBtn'),
    fileInput: $('#fileInput'),
    // dialogs
    textDialog: $('#textDialog'),
    textArea: $('#textArea'),
    textReplace: $('#textReplace'),
    excelDialog: $('#excelDialog'),
    sheetSelect: $('#sheetSelect'),
    lastColSelect: $('#lastColSelect'),
    firstColSelect: $('#firstColSelect'),
    kanaLastColSelect: $('#kanaLastColSelect'),
    kanaFirstColSelect: $('#kanaFirstColSelect'),
    phoneticNote: $('#phoneticNote'),
    skipHeader: $('#skipHeader'),
    previewTable: $('#previewTable'),
    previewSummary: $('#previewSummary'),
    excelReplace: $('#excelReplace'),
    excelCancel: $('#excelCancel'),
    excelOk: $('#excelOk'),
    spotlightBtn: $('#spotlightBtn'),
    updateBtn: $('#updateBtn'),
    updateDialog: $('#updateDialog'),
    updateLead: $('#updateLead'),
    updateNotes: $('#updateNotes'),
    toast: $('#toast')
  };

  const ctx = el.canvas.getContext('2d');

  /* ---------------- トースト ---------------- */

  let toastTimer = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-shown'), ms || 2600);
  }

  /* ---------------- 効果音（音声ファイル不要） ---------------- */

  let audio = null;
  function ac() {
    if (!state.settings.sound) return null;
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function beep(freq, dur, type, gain) {
    const a = ac();
    if (!a) return;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(gain || 0.08, a.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    osc.connect(g).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + dur + 0.02);
  }

  let lastTickAt = 0;
  function tick() {
    const now = performance.now();
    if (now - lastTickAt < 45) return;   // 高速回転中に鳴り過ぎるのを防ぐ
    lastTickAt = now;
    beep(1150, 0.035, 'square', 0.045);
  }

  function fanfare() {
    const a = ac();
    if (!a) return;
    [0, 0.11, 0.22].forEach((t, i) => {
      setTimeout(() => beep([784, 988, 1319][i], 0.32, 'triangle', 0.11), t * 1000);
    });
  }

  /* ---------------- ルーレット盤の描画 ---------------- */

  const PALETTE = ['#d94f4f', '#d97b2a', '#b8912b', '#5da13c', '#2fa08a',
                   '#3182c8', '#5a5fc7', '#8f4fc0', '#c4468f', '#7a7f8a'];

  function colorFor(i, n) {
    let idx = i % PALETTE.length;
    // 一周して先頭と末尾が同色になるのを避ける
    if (i === n - 1 && n > 1 && idx === 0) idx = 1;
    return PALETTE[idx];
  }

  let rotation = 0; // 度。累積させる

  function drawWheel() {
    const list = wheelEntries();
    const W = el.canvas.width;
    const R = W / 2;
    const cx = R, cy = R;
    const radius = R - 18;

    ctx.clearRect(0, 0, W, W);

    if (list.length === 0) {
      ctx.fillStyle = '#eef1f6';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      const c = activeClass();
      const msg = !c || c.students.length === 0
        ? ['名簿がまだ空です', '「名簿」タブから登録してください']
        : ['全員に当たりました', '「リセット」で全員を戻せます'];
      // canvas自体をCSSで回しているので、案内文だけ逆回転させて水平に保つ
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rotation * Math.PI / 180);
      ctx.fillStyle = '#7a869a';
      ctx.font = '600 34px "Hiragino Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      msg.forEach((line, i) => ctx.fillText(line, 0, -215 + i * 48));
      ctx.restore();
      return;
    }

    const n = list.length;
    const seg = (Math.PI * 2) / n;
    const fontSize = n <= 8 ? 42 : n <= 16 ? 34 : n <= 26 ? 27 : n <= 36 ? 22 : n <= 48 ? 18 : 15;

    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * seg;
      const a1 = a0 + seg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, a0, a1);
      ctx.closePath();
      ctx.fillStyle = colorFor(i, n);
      ctx.fill();
      if (n <= 60) {
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // ラベルは外周から中心に向かって描く。
      // 左半分はそのままだと上下逆になるので、180度回して読める向きに揃える
      const mid = a0 + seg / 2;
      const flipped = Math.cos(mid) < 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(flipped ? mid + Math.PI : mid);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${fontSize}px "Hiragino Sans", "Yu Gothic", sans-serif`;
      ctx.textAlign = flipped ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      let label = displayName(list[i]);
      const maxWidth = radius - 130;
      while (label.length > 1 && ctx.measureText(label).width > maxWidth) {
        label = label.slice(0, -1);
      }
      ctx.fillText(label, flipped ? -(radius - 22) : radius - 22, 0);
      ctx.restore();
    }

    // 中心の白い円（スタートボタンの下地）
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.155, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  function applyRotation() {
    el.canvas.style.transform = `rotate(${rotation}deg)`;
  }

  /* ---------------- 結果欄 ---------------- */

  let resultId = null;   // いま結果欄に出している生徒

  function showResultText(text) {
    resultId = null;
    el.resultName.textContent = text;
    el.resultName.classList.remove('has-ruby');
  }

  /** ふりがなや名前の表示を切り替えたときも、出ている結果をその場で描き直す */
  function renderResult() {
    if (!resultId) return;
    const c = activeClass();
    const st = c && c.students.find(x => x.id === resultId);
    if (st) renderName(el.resultName, st);
    else showResultText('—');
  }

  /* ---------------- 抽選 ---------------- */

  let spinning = false;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

  function spin() {
    if (spinning) return;
    const list = wheelEntries();
    const pool = eligible();
    if (pool.length === 0) {
      drawWheel();
      const c = activeClass();
      if (!c || c.students.length === 0) {
        toast('先に名簿を登録してください');
      } else if (list.length === 0) {
        toast('全員に当たりました。「リセット」で戻せます');
      } else {
        toast('抽選できる生徒がいません');
      }
      return;
    }

    // 前回の当選者を盤から取り除くのはこのタイミング。
    // 停止直後に描き直すと、針が指す名前と発表した名前がずれてしまう
    drawWheel();

    spinning = true;
    el.spinBtn.disabled = true;
    el.skipBtn.hidden = true;
    showResultText('…');
    el.resultCard.classList.remove('is-hit');

    // 当選者は「対象外」を除いた中から選び、
    // 止める位置はその生徒が盤面で何番目にいるかから逆算する
    const seg = 360 / list.length;
    const winner = pool[Math.floor(Math.random() * pool.length)];
    const idx = list.indexOf(winner);

    // 当選セグメントの中心が真上（ポインタ位置）に来る回転量を求める
    const targetMod = (360 - (idx + 0.5) * seg) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    const turns = 5 + Math.floor(Math.random() * 3);
    const delta = ((targetMod - currentMod + 360) % 360) + 360 * turns;

    const from = rotation;
    const duration = 4200 + Math.random() * 600;
    const start = performance.now();
    let lastSegIndex = -1;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      rotation = from + delta * easeOutCubic(t);
      applyRotation();

      // セグメントの切れ目を通過するたびにカチッと鳴らす
      const segIndex = Math.floor(((rotation % 360) + 360) % 360 / seg);
      if (segIndex !== lastSegIndex) {
        if (lastSegIndex !== -1 && t < 0.995) tick();
        lastSegIndex = segIndex;
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = from + delta;
        applyRotation();
        finish(winner);
      }
    }
    requestAnimationFrame(frame);
  }

  function finish(winner) {
    spinning = false;
    el.spinBtn.disabled = false;
    resultId = winner.id;
    renderResult();
    el.resultCard.classList.add('is-hit');
    el.skipBtn.hidden = false;
    fanfare();

    pickedSet().add(winner.id);
    recordOrder(winner.id);
    renderHistory();   // 盤面は次に回すときまでそのままにしておく
  }

  /** 直前の指名を取り消して、その生徒を対象に戻す */
  function undoLast() {
    const c = activeClass();
    if (!c) return;
    const picked = pickedSet();
    const order = historyOrder.get(c.id) || [];
    const lastId = order[order.length - 1];
    if (!lastId) return;
    order.pop();
    picked.delete(lastId);
    showResultText('—');
    el.resultCard.classList.remove('is-hit');
    el.skipBtn.hidden = true;
    renderHistory();
    drawWheel();
    toast('指名を取り消しました');
  }

  /** 指名された順番を保持する（Setは順序が保証されるが明示的に持つ） */
  const historyOrder = new Map();

  function recordOrder(id) {
    const c = activeClass();
    if (!c) return;
    if (!historyOrder.has(c.id)) historyOrder.set(c.id, []);
    historyOrder.get(c.id).push(id);
  }

  /* ---------------- 画面の更新 ---------------- */

  function renderHistory() {
    const c = activeClass();
    el.history.innerHTML = '';
    const order = (c && historyOrder.get(c.id)) || [];
    const byId = new Map((c ? c.students : []).map(s => [s.id, s]));

    order.forEach(id => {
      const st = byId.get(id);
      if (!st) return;
      const li = document.createElement('li');
      li.textContent = displayName(st);
      el.history.appendChild(li);
    });

    el.historyEmpty.hidden = order.length > 0;
    el.remainCount.textContent = String(eligible().length);
  }

  function renderClassSelect() {
    el.classSelect.innerHTML = '';
    state.classes.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      el.classSelect.appendChild(o);
    });
    const c = activeClass();
    if (c) el.classSelect.value = c.id;
  }

  function renderClassList() {
    el.classList.innerHTML = '';
    state.classes.forEach(c => {
      const li = document.createElement('li');
      if (c.id === state.activeClassId) li.classList.add('is-active');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'class-name';
      btn.textContent = `${c.name}（${c.students.length}）`;
      btn.addEventListener('click', () => switchClass(c.id));

      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'icon-btn';
      ren.title = '名前を変える';
      ren.textContent = '✏️';
      ren.addEventListener('click', () => renameClass(c.id));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.title = 'このクラスを削除';
      del.textContent = '🗑';
      del.addEventListener('click', () => deleteClass(c.id));

      li.append(btn, ren, del);
      el.classList.appendChild(li);
    });
  }

  function renderRoster() {
    const c = activeClass();
    el.rosterBody.innerHTML = '';
    if (!c) return;

    el.rosterTitle.textContent = `${c.name} の名簿`;

    c.students.forEach((st, i) => {
      const tr = document.createElement('tr');
      if (st.excluded) tr.classList.add('is-excluded');

      const tdNo = document.createElement('td');
      tdNo.className = 'col-no';
      tdNo.textContent = String(i + 1);

      const tdLast = document.createElement('td');
      const inLast = document.createElement('input');
      inLast.type = 'text';
      inLast.value = st.last || '';
      inLast.placeholder = '姓';
      inLast.addEventListener('input', () => { st.last = inLast.value; save(); refreshSpin(); });
      tdLast.appendChild(inLast);

      const tdFirst = document.createElement('td');
      const inFirst = document.createElement('input');
      inFirst.type = 'text';
      inFirst.value = st.first || '';
      inFirst.placeholder = '名';
      inFirst.addEventListener('input', () => { st.first = inFirst.value; save(); refreshSpin(); });
      tdFirst.appendChild(inFirst);

      const kanaCell = (key, ph) => {
        const td = document.createElement('td');
        td.className = 'col-kana';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = st[key] || '';
        input.placeholder = ph;
        input.addEventListener('input', () => { st[key] = input.value; save(); refreshSpin(); });
        td.appendChild(input);
        return td;
      };
      const tdKanaLast = kanaCell('kanaLast', 'せい');
      const tdKanaFirst = kanaCell('kanaFirst', 'めい');

      const tdEx = document.createElement('td');
      tdEx.className = 'col-ex';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!st.excluded;
      cb.title = 'チェックすると盤面に表示されず、抽選もされません';
      cb.addEventListener('change', () => {
        st.excluded = cb.checked;
        tr.classList.toggle('is-excluded', cb.checked);
        save();
        refreshSpin();
      });
      tdEx.appendChild(cb);

      const tdDel = document.createElement('td');
      tdDel.className = 'col-del';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.title = '削除';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        c.students.splice(i, 1);
        save();
        renderRoster();
        renderClassList();
        refreshSpin();
      });
      tdDel.appendChild(del);

      tr.append(tdNo, tdLast, tdFirst, tdKanaLast, tdKanaFirst, tdEx, tdDel);
      el.rosterBody.appendChild(tr);
    });

    const total = c.students.length;
    const ex = c.students.filter(s => s.excluded).length;
    el.rosterEmpty.hidden = total > 0;
    el.rosterSummary.textContent = total === 0
      ? ''
      : `全${total}人／抽選対象 ${total - ex}人${ex ? `（対象外 ${ex}人）` : ''}`;
  }

  function refreshSpin() {
    drawWheel();
    renderHistory();
    if (!spinning) renderResult();
  }

  function renderAll() {
    renderClassSelect();
    renderClassList();
    renderRoster();
    refreshSpin();
  }

  /* ---------------- クラス操作 ---------------- */

  function switchClass(id) {
    state.activeClassId = id;
    save();
    rotation = 0;
    applyRotation();
    showResultText('—');
    el.skipBtn.hidden = true;
    renderAll();
  }

  function addClass() {
    const name = prompt('クラス名を入力してください', `${state.classes.length + 1}組`);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const c = newClass(trimmed);
    state.classes.push(c);
    state.activeClassId = c.id;
    save();
    renderAll();
  }

  function renameClass(id) {
    const c = state.classes.find(x => x.id === id);
    if (!c) return;
    const name = prompt('クラス名を入力してください', c.name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    c.name = trimmed;
    save();
    renderAll();
  }

  function deleteClass(id) {
    const c = state.classes.find(x => x.id === id);
    if (!c) return;
    if (!confirm(`「${c.name}」を名簿ごと削除します。よろしいですか？`)) return;
    state.classes = state.classes.filter(x => x.id !== id);
    if (state.classes.length === 0) state.classes.push(newClass('1組'));
    if (!state.classes.some(x => x.id === state.activeClassId)) {
      state.activeClassId = state.classes[0].id;
    }
    pickedByClass.delete(id);
    historyOrder.delete(id);
    save();
    renderAll();
  }

  /* ---------------- 名簿の取り込み ---------------- */

  function makeStudent(last, first, kanaLast, kanaFirst) {
    const t = v => String(v || '').trim();
    return {
      id: uid(), last: t(last), first: t(first),
      kanaLast: t(kanaLast), kanaFirst: t(kanaFirst), excluded: false
    };
  }

  function applyImport(rows, replace) {
    const c = activeClass();
    if (!c) return;
    const students = rows
      .map(r => makeStudent(r.last, r.first, r.kanaLast, r.kanaFirst))
      .filter(s => s.last || s.first);
    if (students.length === 0) {
      toast('取り込める名前がありませんでした');
      return;
    }
    if (replace) {
      c.students = students;
      pickedByClass.delete(c.id);
      historyOrder.delete(c.id);
    } else {
      c.students = c.students.concat(students);
    }
    save();
    renderAll();
    toast(`${students.length}人を取り込みました`);
  }

  /* --- 貼り付け取り込み --- */

  /** 名前と読みの組を作る。読みが1つにまとまっていれば空白で姓・名に分ける */
  function withKana(name, kana) {
    const k = splitName(kana) || { last: '', first: '' };
    return { last: name.last, first: name.first, kanaLast: k.last, kanaFirst: k.first };
  }

  /**
   * 1行に1人。次の書き方を受け付ける。
   *   山田 太郎
   *   山田 太郎 やまだ たろう
   *   山田 太郎（やまだ たろう）
   *   Excelからの貼り付け（タブ区切り）：姓 名 / 姓 名 せい めい / 氏名 ふりがな
   * 先頭の出席番号（数字だけの欄）は読み飛ばす。
   */
  function parseText(text) {
    return text.split(/\r?\n/).map(line => {
      // 先頭の出席番号（「1 」「1.」「1、」「1）」やタブ・カンマ区切り）は読み飛ばす
      const s = line.trim().replace(/^[0-9０-９]+(?:\s+|[.．、,，:：)）]\s*)/, '').trim();
      if (!s) return null;

      // 「山田 太郎（やまだ たろう）」
      const paren = s.match(/^(.*?)\s*[（(]\s*([^）)]*?)\s*[）)]\s*$/);
      if (paren && isKanaText(paren[2])) {
        const name = splitName(paren[1]);
        return name && withKana(name, paren[2]);
      }

      const sep = s.includes('\t') ? '\t' : s.includes(',') ? ',' : null;
      if (sep) {
        const cells = s.split(sep).map(x => x.trim()).filter(Boolean);
        while (cells.length > 1 && /^\d+$/.test(cells[0])) cells.shift();
        if (cells.length >= 4) {
          return { last: cells[0], first: cells[1], kanaLast: cells[2], kanaFirst: cells[3] };
        }
        if (cells.length === 3 && isKanaText(cells[2])) {
          return withKana({ last: cells[0], first: cells[1] }, cells[2]);
        }
        if (cells.length >= 2) {
          // 「氏名」「ふりがな」の2列
          if (/\s/.test(cells[0]) && isKanaText(cells[1])) return withKana(splitName(cells[0]), cells[1]);
          return { last: cells[0], first: cells[1] };
        }
        return splitName(cells[0] || '');
      }

      // 空白区切りで4つ：「山田 太郎 やまだ たろう」
      const words = s.split(/\s+/);
      if (words.length === 4 && isKanaText(words[2]) && isKanaText(words[3])) {
        return { last: words[0], first: words[1], kanaLast: words[2], kanaFirst: words[3] };
      }
      return splitName(s);
    }).filter(Boolean);
  }

  /* --- Excel取り込み --- */

  let workbook = null;
  let grid = [];                  // 選んでいるシートの中身。grid[行][列] = { text, ph }
  const NONE = '__none__';
  const PHON = '__phonetic__';    // Excelに残っている読み（名前を入力したときの変換の読み）

  // 見出し行かどうかの判定。生徒の名前（椎名、名取、かな など）を見出しと取り違えないよう、
  // 見出しらしい言葉が「その欄まるごと」になっているときだけ見出しとみなす
  const STRONG_HEAD = [
    /^(出席)?番号$/, /^no\.?$/i,
    /^(姓|名|氏|氏名|名前|苗字|名字|生徒名|児童名|生徒氏名|児童氏名|下の名前)([（(].*[）)])?$/,
    /(ふりがな|フリガナ|ﾌﾘｶﾞﾅ|よみがな|ヨミガナ|読み仮名)/,
    /^(姓|名|氏名|名前)[\s・_]*(かな|カナ|ｶﾅ|よみ|ヨミ|読み)$/
  ];
  // ふりがなの列の見出し（見出し行と分かったあとで使う）
  const KANA_HEAD = /(ふりがな|フリガナ|ﾌﾘｶﾞﾅ|よみ|ヨミ|ﾖﾐ|読み|かな|カナ|ｶﾅ|ルビ)|^(せい|めい|セイ|メイ)$/;

  function colLabel(i) {
    let s = '';
    let n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  }

  /**
   * Excelのセルに残っている読みを取り出す（PHONETIC関数で出せるのと同じもの）。
   * Excelで名前を手入力すると、変換したときの読みがセルに一緒に保存されている。
   * SheetJSはそれをセルの r（元のXML）に残しているので、そこから組み立てる。
   */
  function phoneticOf(cell) {
    if (!cell || cell.t !== 's' || typeof cell.r !== 'string' || !cell.r.includes('rPh')) return '';
    const doc = new DOMParser().parseFromString('<si>' + cell.r + '</si>', 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) return '';
    const si = doc.documentElement;
    let base = '';
    const runs = [];
    for (const node of si.children) {
      if (node.localName === 't') base += node.textContent;
      else if (node.localName === 'r') for (const t of node.getElementsByTagName('t')) base += t.textContent;
      else if (node.localName === 'rPh') {
        runs.push({ sb: +node.getAttribute('sb'), eb: +node.getAttribute('eb'), t: node.textContent });
      }
    }
    if (!runs.length) return '';
    // 読みの付いていない文字（かなや空白）はそのまま残す
    runs.sort((a, b) => a.sb - b.sb);
    let out = '', pos = 0;
    for (const r of runs) {
      if (!(r.sb >= pos && r.eb >= r.sb)) continue;
      out += base.slice(pos, r.sb) + r.t;
      pos = r.eb;
    }
    return (out + base.slice(pos)).trim();
  }

  /** シートを [行][列] の表にする。列の番号はExcelの列（A=0）にそろえる */
  function sheetGrid(name) {
    const ws = workbook.Sheets[name];
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const text = cell ? String(cell.w != null ? cell.w : (cell.v != null ? cell.v : '')).trim() : '';
        row.push({ text, ph: phoneticOf(cell) });
      }
      if (row.some(x => x.text)) rows.push(row);
    }
    return rows;
  }

  const textAt = (row, i) => (row && row[i] && row[i].text) || '';

  function openExcel(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      } catch (err) {
        console.error(err);
        toast('このファイルは読み込めませんでした');
        return;
      }
      if (!workbook.SheetNames.length) { toast('シートがありません'); return; }

      el.sheetSelect.innerHTML = '';
      workbook.SheetNames.forEach(n => {
        const o = document.createElement('option');
        o.value = n; o.textContent = n;
        el.sheetSelect.appendChild(o);
      });
      el.sheetSelect.value = workbook.SheetNames[0];
      setupColumns();
      el.excelDialog.showModal();
    };
    reader.onerror = () => toast('ファイルを読めませんでした');
    reader.readAsArrayBuffer(file);
  }

  /** 見出しと中身から、姓・名・ふりがなの列を推測する */
  function guessColumns(rows, width) {
    const head = (rows[0] || []).map(x => x.text);
    const looksHeader = head.some(h => h && STRONG_HEAD.some(re => re.test(h)));
    const body = (looksHeader ? rows.slice(1) : rows).slice(0, 15);

    // 中身で分ける：数字だけの列（出席番号）、かなだけの列（ふりがな）、それ以外（名前）
    const filled = i => body.map(r => textAt(r, i)).filter(Boolean);
    const ratio = (i, test) => { const v = filled(i); return v.length ? v.filter(test).length / v.length : 0; };
    const cols = [...Array(width).keys()].filter(i => filled(i).length);
    const numCols = cols.filter(i => ratio(i, v => /^\d+$/.test(v)) >= 0.8);
    const kanaCols = cols.filter(i => !numCols.includes(i) && ratio(i, isKanaText) >= 0.8);
    const nameCols = cols.filter(i => !numCols.includes(i) && !kanaCols.includes(i));

    const g = {
      looksHeader,
      last: nameCols.length ? nameCols[0] : 0,
      first: nameCols.length > 1 ? nameCols[1] : NONE,
      kanaLast: kanaCols.length ? kanaCols[0] : NONE,
      kanaFirst: kanaCols.length > 1 ? kanaCols[1] : NONE
    };

    if (looksHeader) {
      const isKana = h => KANA_HEAD.test(h);
      const at = test => head.findIndex(h => !!h && test(h));
      const li = at(h => !isKana(h) && /^(姓|名字|苗字|氏)([（(].*[）)])?$/.test(h));
      const fi = at(h => !isKana(h) && /^(名|下の名前)([（(].*[）)])?$/.test(h));
      const full = at(h => !isKana(h) && /(氏名|名前|生徒名|児童名)/.test(h));
      if (li >= 0) { g.last = li; g.first = fi >= 0 ? fi : NONE; }
      else if (full >= 0) { g.last = full; g.first = NONE; }

      const kli = at(h => isKana(h) && (/(姓|苗字|名字|せい|セイ)/.test(h) || /氏(?!名)/.test(h)));
      const kfi = at(h => isKana(h) && (/(めい|メイ)/.test(h) || /(^|[^氏])名(?!前)/.test(h)));
      const kfull = head.findIndex((h, i) => !!h && isKana(h) && i !== kli && i !== kfi);
      if (kli >= 0 || kfi >= 0) {
        g.kanaLast = kli >= 0 ? kli : NONE;
        g.kanaFirst = kfi >= 0 ? kfi : NONE;
      } else if (kfull >= 0) {
        g.kanaLast = kfull; g.kanaFirst = NONE;
      }
    }

    // ふりがなの列が無く、名前のセルにExcelの読みが残っていれば、それを使う
    const hasPh = i => i !== NONE && body.some(r => r[i] && r[i].ph);
    if (g.kanaLast === NONE && g.kanaFirst === NONE && (hasPh(g.last) || hasPh(g.first))) {
      g.kanaLast = PHON;
      g.kanaFirst = g.first !== NONE ? PHON : NONE;
    }
    return g;
  }

  function setupColumns() {
    grid = sheetGrid(el.sheetSelect.value);
    const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
    const g = guessColumns(grid, width);
    const sampleRows = g.looksHeader ? grid.slice(1) : grid;
    const anyPh = sampleRows.some(r => r.some(x => x.ph));

    const fill = (sel, { none, phon }) => {
      sel.innerHTML = '';
      const add = (value, label) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = label;
        sel.appendChild(o);
      };
      if (none) add(NONE, '（なし）');
      if (phon && anyPh) add(PHON, 'Excelに残っている読み');
      for (let i = 0; i < width; i++) {
        const head = g.looksHeader ? textAt(grid[0], i) : '';
        const sample = sampleRows.slice(0, 4).map(r => textAt(r, i)).filter(Boolean)[0] || '';
        const hint = [head, sample].filter(Boolean).join('：');
        add(String(i), hint ? `${colLabel(i)}列（${hint}…）` : `${colLabel(i)}列`);
      }
    };
    fill(el.lastColSelect, {});
    fill(el.firstColSelect, { none: true });
    fill(el.kanaLastColSelect, { none: true, phon: true });
    fill(el.kanaFirstColSelect, { none: true, phon: true });

    el.skipHeader.checked = g.looksHeader;
    el.lastColSelect.value = String(g.last);
    el.firstColSelect.value = String(g.first);
    el.kanaLastColSelect.value = String(g.kanaLast);
    el.kanaFirstColSelect.value = String(g.kanaFirst);

    renderPreview();
  }

  function excelRows() {
    const body = el.skipHeader.checked ? grid.slice(1) : grid;
    const li = parseInt(el.lastColSelect.value, 10);
    const fv = el.firstColSelect.value;
    const fi = fv === NONE ? -1 : parseInt(fv, 10);
    const kl = el.kanaLastColSelect.value;
    const kf = el.kanaFirstColSelect.value;

    return body.map(r => {
      const a = r[li] || { text: '', ph: '' };
      const b = fi >= 0 ? (r[fi] || { text: '', ph: '' }) : { text: '', ph: '' };
      if (!a.text && !b.text) return null;
      // 名の列を使わないときは、1つのセルに入ったフルネームを姓と名に分ける
      const name = fi < 0 ? splitName(a.text) : { last: a.text, first: b.text };
      if (!name) return null;

      const from = (v, cell) => v === PHON ? cell.ph : v === NONE ? '' : textAt(r, parseInt(v, 10));
      // 名の読みの指定が無いとき（または氏名が1つのセルのとき）は、読みを空白で姓・名に分ける
      const row = (kf === NONE || (kf === PHON && fi < 0))
        ? withKana(name, from(kl, a))
        : { last: name.last, first: name.first, kanaLast: from(kl, a), kanaFirst: from(kf, b) };
      // Excelの読みは中身がカタカナで入っているので、確認画面に出す文字（＝設定の文字）にそろえて取り込む
      row.kanaLast = styleKana(row.kanaLast);
      row.kanaFirst = styleKana(row.kanaFirst);
      return row;
    }).filter(Boolean);
  }

  function renderPreview() {
    const rows = excelRows();
    el.previewTable.innerHTML =
      '<thead><tr><th class="col-no">#</th><th>姓</th><th>名</th><th>せい</th><th>めい</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.slice(0, 60).forEach((r, i) => {
      const tr = document.createElement('tr');
      [String(i + 1), r.last, r.first, r.kanaLast, r.kanaFirst].forEach((v, k) => {
        const td = document.createElement('td');
        if (k === 0) td.className = 'col-no';
        if (k >= 3) td.className = 'col-kana';
        td.textContent = v || '';
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    el.previewTable.appendChild(tb);

    const withKanaCount = rows.filter(r => r.kanaLast || r.kanaFirst).length;
    el.previewSummary.textContent = rows.length
      ? `${rows.length}人を取り込みます（ふりがなあり ${withKanaCount}人）${rows.length > 60 ? '・表示は先頭60人' : ''}`
      : '取り込める行が見つかりません。列の指定を変えてみてください。';
    el.phoneticNote.hidden = !(el.kanaLastColSelect.value === PHON || el.kanaFirstColSelect.value === PHON);
  }

  /* ---------------- イベント ---------------- */

  el.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.tabs.forEach(t => t.classList.toggle('is-active', t === tab));
      Object.entries(el.views).forEach(([k, v]) =>
        v.classList.toggle('is-active', k === tab.dataset.view));
      if (tab.dataset.view === 'spin') refreshSpin();
    });
  });

  el.classSelect.addEventListener('change', () => switchClass(el.classSelect.value));

  el.spinBtn.addEventListener('click', () => {
    ac(); // 最初のクリックで音声を有効にする
    spin();
  });

  el.skipBtn.addEventListener('click', undoLast);

  el.optRemove.addEventListener('change', () => {
    state.settings.removeAfterPick = el.optRemove.checked;
    save();
    refreshSpin();
  });

  el.optSound.addEventListener('change', () => {
    state.settings.sound = el.optSound.checked;
    save();
  });

  el.optDisplay.addEventListener('change', () => {
    state.settings.display = el.optDisplay.value;
    save();
    refreshSpin();
  });

  el.optFurigana.addEventListener('change', () => {
    state.settings.furigana = el.optFurigana.checked;
    el.optKanaStyle.disabled = !el.optFurigana.checked;
    save();
    refreshSpin();
  });

  el.optKanaStyle.addEventListener('change', () => {
    state.settings.kanaStyle = el.optKanaStyle.value;
    save();
    refreshSpin();
  });

  el.resetBtn.addEventListener('click', () => {
    const c = activeClass();
    if (!c) return;
    pickedByClass.delete(c.id);
    historyOrder.delete(c.id);
    rotation = 0;
    applyRotation();
    showResultText('—');
    el.resultCard.classList.remove('is-hit');
    el.skipBtn.hidden = true;
    refreshSpin();
    toast('全員を対象に戻しました');
  });

  el.spotlightBtn.addEventListener('click', () => {
    const on = document.body.classList.toggle('is-spotlight');
    el.spotlightBtn.classList.toggle('is-on', on);
    el.spotlightBtn.textContent = on ? '投影モード解除' : '投影モード';
  });

  el.addClassBtn.addEventListener('click', addClass);

  el.addStudentBtn.addEventListener('click', () => {
    const c = activeClass();
    if (!c) return;
    c.students.push(makeStudent('', ''));
    save();
    renderRoster();
    renderClassList();
    const inputs = el.rosterBody.querySelectorAll('tr:last-child input[type="text"]');
    if (inputs[0]) inputs[0].focus();
  });

  el.clearRosterBtn.addEventListener('click', () => {
    const c = activeClass();
    if (!c || c.students.length === 0) return;
    if (!confirm(`「${c.name}」の名簿（${c.students.length}人）を全部消します。よろしいですか？`)) return;
    c.students = [];
    pickedByClass.delete(c.id);
    historyOrder.delete(c.id);
    save();
    renderAll();
  });

  el.importTextBtn.addEventListener('click', () => {
    el.textArea.value = '';
    el.textReplace.checked = false;
    el.textDialog.showModal();
    el.textArea.focus();
  });

  el.textDialog.addEventListener('close', () => {
    if (el.textDialog.returnValue !== 'ok') return;
    const rows = parseText(el.textArea.value);
    applyImport(rows, el.textReplace.checked);
  });

  el.importExcelBtn.addEventListener('click', () => el.fileInput.click());

  el.fileInput.addEventListener('change', () => {
    const f = el.fileInput.files && el.fileInput.files[0];
    if (f) openExcel(f);
    el.fileInput.value = '';
  });

  el.sheetSelect.addEventListener('change', setupColumns);
  el.lastColSelect.addEventListener('change', renderPreview);
  el.firstColSelect.addEventListener('change', renderPreview);
  el.kanaLastColSelect.addEventListener('change', renderPreview);
  el.kanaFirstColSelect.addEventListener('change', renderPreview);
  el.skipHeader.addEventListener('change', renderPreview);

  el.excelCancel.addEventListener('click', () => el.excelDialog.close());
  el.excelOk.addEventListener('click', () => {
    applyImport(excelRows(), el.excelReplace.checked);
    el.excelDialog.close();
  });

  // スペースキーでも回せる（入力中は除く）
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!el.views.spin.classList.contains('is-active')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    ac();
    spin();
  });

  /* ---------------- 更新（Service Worker） ---------------- */
  // PDFノートと同じしくみ。GitHubに新しい版を上げると、起動時と1時間ごとの確認で
  // 裏で取り込まれ、「更新」ボタンが緑色になる。押すと更新内容を見せてから切り替える。
  // （押さなくても、アプリを全部閉じて開き直せば新しい版になる）

  let swReg = null, waitingWorker = null, swReloading = false, updateRequested = false;

  /* 今より新しい版の更新内容だけを取り出す。
     いちばん上から見ていき、いま動いている版に当たったらそこで止める。 */
  async function fetchNewNotes() {
    try {
      const res = await fetch(NOTES_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return null;
      const all = await res.json();
      if (!Array.isArray(all)) return null;
      const fresh = [];
      for (const n of all) { if (n && n.version === APP_VERSION) break; if (n) fresh.push(n); }
      return fresh;
    } catch (e) { return null; }
  }

  function confirmUpdate(notes) {
    const has = !!(notes && notes.length);
    el.updateLead.textContent = (has
      ? '更新すると、次のように変わります。'
      : '更新内容を読み込めませんでした（ネット接続を確認してください）。')
      + '画面が再読み込みされ、今回の指名の記録はリセットされます（名簿と設定はそのまま残ります）。';
    el.updateNotes.innerHTML = '';
    el.updateNotes.hidden = !has;
    (notes || []).forEach(n => {
      const sec = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = n.title || n.version || '';
      const ul = document.createElement('ul');
      (n.items || []).forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        ul.appendChild(li);
      });
      sec.append(h, ul);
      el.updateNotes.appendChild(sec);
    });
    return new Promise(resolve => {
      el.updateDialog.returnValue = '';
      el.updateDialog.addEventListener('close',
        () => resolve(el.updateDialog.returnValue === 'ok'), { once: true });
      el.updateDialog.showModal();
    });
  }

  /* 更新するか、内容を見せたうえで聞く */
  async function askAndUpdate(worker) {
    setUpdateBusy(true);
    const notes = await fetchNewNotes();
    setUpdateBusy(false);
    if (await confirmUpdate(notes)) {
      updateRequested = true;
      worker.postMessage('skipWaiting');   // → controllerchange で自動リロード
    }
  }

  function setUpdateBusy(on) {
    const b = el.updateBtn;
    b.disabled = on;
    b.querySelector('.lbl').textContent = on ? '確認中…'
      : (b.classList.contains('has-update') ? '更新（新版あり）' : '更新');
  }

  /* 版番号は APP_VERSION から入れる（手書きの重複を作らない） */
  function showBuildStamp() {
    document.querySelectorAll('.build-stamp').forEach(n => {
      n.textContent = 'バージョン ' + APP_VERSION;
    });
  }

  async function initServiceWorker() {
    const upd = el.updateBtn;
    // http/https のときだけ（GitHub Pages 等）。ファイルを直接開いたときは使えない
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) {
      upd.hidden = true;
      return;
    }
    upd.hidden = false;
    upd.title = '最新版に更新する（現在 ' + APP_VERSION + '）';
    // 初めて開いたときは、登録直後に clients.claim() でも controllerchange が起きる。
    // そこで再読み込みすると入力中の内容が消えるので、更新のときだけ読み込み直す
    const hadController = !!navigator.serviceWorker.controller;
    try {
      swReg = await navigator.serviceWorker.register('service-worker.js');
      // ブラウザの設定や学校のポリシーで Service Worker が使えないことがある
      if (!swReg) { upd.title = 'オフライン機能を有効にできませんでした'; return; }
      if (swReg.waiting && navigator.serviceWorker.controller) markUpdateReady(swReg.waiting);
      swReg.addEventListener('updatefound', () => {
        const nw = swReg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) markUpdateReady(nw);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController && !updateRequested) return;
        if (swReloading) return;
        swReloading = true;
        location.reload();
      });
      // 表示中のファイルと Service Worker のバージョンが食い違っていたら知らせる
      // （キャッシュの取り違えで「番号だけ新しい」状態になっていないかの確認）
      navigator.serviceWorker.addEventListener('message', (ev) => {
        const d = ev.data;
        if (d && d.type === 'version' && d.version && d.version !== APP_VERSION) {
          toast('表示中のファイルが古いようです。Ctrl+Shift+R で読み込み直してください', 7000);
        }
      });
      setTimeout(() => {
        try {
          if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('version');
        } catch (e) { /* 確認できなくても動作には影響しない */ }
      }, 2500);
      // たまに自動で更新チェック（起動時・以後1時間ごと）
      setTimeout(() => { try { swReg.update(); } catch (e) {} }, 4000);
      setInterval(() => { try { swReg && swReg.update(); } catch (e) {} }, 60 * 60 * 1000);
    } catch (e) {
      console.error('Service Worker 登録失敗', e);
      upd.title = 'オフライン機能を有効にできませんでした';
    }
  }

  function markUpdateReady(worker) {
    waitingWorker = worker;
    const upd = el.updateBtn;
    upd.hidden = false;
    upd.classList.add('has-update');
    upd.querySelector('.lbl').textContent = '更新（新版あり）';
    upd.title = '新しい版があります。押すと最新版になります';
  }

  /* 新しい版が見つかって、入り終わるまで待つ。
     見つからなければ FIND_MS ほどで「無し」と判断し、待たせすぎない。
     見つかったら、入り終わるまで最大 INSTALL_MS 待つ。 */
  const FIND_MS = 2000, INSTALL_MS = 30000;
  function waitForNewWorker(reg) {
    return new Promise((resolve) => {
      let settled = false, tFind = null, tInstall = null;
      const finish = (w) => {
        if (settled) return;
        settled = true;
        clearTimeout(tFind); clearTimeout(tInstall);
        reg.removeEventListener('updatefound', onFound);
        resolve(w || null);
      };
      const watch = (nw) => {
        if (!nw) return;
        clearTimeout(tFind);                       // 見つかったので「無し」の判断はやめる
        tInstall = setTimeout(() => finish(reg.waiting || null), INSTALL_MS);
        if (nw.state === 'installed') { finish(reg.waiting || nw); return; }
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed') finish(reg.waiting || nw);
          else if (nw.state === 'redundant') finish(null);   // 入れ替えに失敗した
        });
      };
      const onFound = () => watch(reg.installing);
      if (reg.waiting) { finish(reg.waiting); return; }
      reg.addEventListener('updatefound', onFound);
      tFind = setTimeout(() => finish(reg.waiting || waitingWorker), FIND_MS);
      watch(reg.installing);                       // もう始まっていることもある
    });
  }

  async function checkForUpdate() {
    if (!swReg) { toast('この開き方では更新機能は使えません（GitHub Pages のURLで開いてください）'); return; }
    // すでに新版が待機していれば、それを適用
    const ready = waitingWorker || swReg.waiting;
    if (ready) { await askAndUpdate(ready); return; }
    // サーバに最新があるか確認
    setUpdateBusy(true);
    try {
      const watching = waitForNewWorker(swReg);   // update() より先に見張りを始める
      try { await swReg.update(); } catch (e) { /* 見張りの結果で判断する */ }
      const w = await watching;
      setUpdateBusy(false);
      if (w) {
        await askAndUpdate(w);
      } else {
        toast('最新の状態です（' + APP_VERSION + '）');
      }
    } catch (e) {
      setUpdateBusy(false);
      console.error(e);
      toast('更新の確認に失敗しました。ネット接続を確認してください');
    }
  }

  el.updateBtn.addEventListener('click', checkForUpdate);

  /* ---------------- 起動 ---------------- */

  el.optRemove.checked = state.settings.removeAfterPick;
  el.optSound.checked = state.settings.sound;
  el.optDisplay.value = state.settings.display;
  el.optFurigana.checked = state.settings.furigana;
  el.optKanaStyle.value = state.settings.kanaStyle;
  el.optKanaStyle.disabled = !state.settings.furigana;
  renderAll();
  showBuildStamp();
  initServiceWorker();
})();
