/* =========================================================================
   指名ルーレット
   - データはすべてブラウザのlocalStorageに保存され、外部には一切送信しない
   ========================================================================= */
(() => {
  'use strict';

  const STORAGE_KEY = 'roulette.v1';

  /* ---------------- 状態 ---------------- */

  const defaultState = () => ({
    version: 1,
    activeClassId: null,
    settings: { removeAfterPick: true, sound: true, display: 'full' },
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
    const m = mode || state.settings.display;
    const last = (st.last || '').trim();
    const first = (st.first || '').trim();
    if (m === 'last') return last || first;
    if (m === 'first') return first || last;
    return [last, first].filter(Boolean).join(' ');
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
    skipHeader: $('#skipHeader'),
    previewTable: $('#previewTable'),
    previewSummary: $('#previewSummary'),
    excelReplace: $('#excelReplace'),
    excelCancel: $('#excelCancel'),
    excelOk: $('#excelOk'),
    spotlightBtn: $('#spotlightBtn'),
    toast: $('#toast')
  };

  const ctx = el.canvas.getContext('2d');

  /* ---------------- トースト ---------------- */

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-shown'), 2600);
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
    el.resultName.textContent = '…';
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
    el.resultName.textContent = displayName(winner);
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
    el.resultName.textContent = '—';
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

      tr.append(tdNo, tdLast, tdFirst, tdEx, tdDel);
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
    el.resultName.textContent = '—';
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

  function makeStudent(last, first) {
    return { id: uid(), last: (last || '').trim(), first: (first || '').trim(), excluded: false };
  }

  function applyImport(rows, replace) {
    const c = activeClass();
    if (!c) return;
    const students = rows
      .map(r => makeStudent(r.last, r.first))
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

  function parseText(text) {
    return text.split(/\r?\n/).map(line => {
      const s = line.trim();
      if (!s) return null;
      if (s.includes('\t')) {
        const cells = s.split('\t').map(x => x.trim()).filter(Boolean);
        if (cells.length >= 2) return { last: cells[0], first: cells[1] };
        return splitName(cells[0] || '');
      }
      if (s.includes(',')) {
        const cells = s.split(',').map(x => x.trim()).filter(Boolean);
        if (cells.length >= 2) return { last: cells[0], first: cells[1] };
        return splitName(cells[0] || '');
      }
      return splitName(s);
    }).filter(Boolean);
  }

  /* --- Excel取り込み --- */

  let workbook = null;
  const NONE = '__none__';
  const HEADER_WORDS = ['姓', '名', '氏名', '名前', '苗字', '名字', 'せい', 'めい', 'name'];

  function colLabel(i) {
    let s = '';
    let n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  }

  function sheetRows(name) {
    const ws = workbook.Sheets[name];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false })
      .map(r => r.map(cell => String(cell == null ? '' : cell).trim()));
  }

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

  /** シートを見て、姓・名の列と見出し行を推測する */
  function setupColumns() {
    const rows = sheetRows(el.sheetSelect.value);
    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);

    // 見出し行かどうかを先に判定しておく（列の例示に見出し語を出さないため）
    const head = rows[0] || [];
    const looksHeader = head.some(cell =>
      HEADER_WORDS.some(w => cell && cell.toLowerCase().includes(w)));
    const sampleRows = looksHeader ? rows.slice(1) : rows;

    const fill = (sel, withNone) => {
      sel.innerHTML = '';
      if (withNone) {
        const o = document.createElement('option');
        o.value = NONE; o.textContent = '（なし）';
        sel.appendChild(o);
      }
      for (let i = 0; i < width; i++) {
        const sample = sampleRows.slice(0, 4).map(r => r[i]).filter(Boolean)[0] || '';
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = sample ? `${colLabel(i)}列（${sample}…）` : `${colLabel(i)}列`;
        sel.appendChild(o);
      }
    };
    fill(el.lastColSelect, false);
    fill(el.firstColSelect, true);

    el.skipHeader.checked = looksHeader;

    // 列の推測
    let lastIdx = 0, firstIdx = width >= 2 ? 1 : NONE;
    if (looksHeader) {
      const li = head.findIndex(c => /^(姓|名字|苗字|氏)$/.test(c));
      const fi = head.findIndex(c => /^(名|下の名前)$/.test(c));
      if (li >= 0) lastIdx = li;
      if (fi >= 0) firstIdx = fi;
    } else if (width >= 2) {
      // 2列目が空ばかりなら「なし」にしておく
      const body = rows.slice(0, 10);
      const hasSecond = body.some(r => (r[1] || '').trim() !== '');
      if (!hasSecond) firstIdx = NONE;
    }
    el.lastColSelect.value = String(lastIdx);
    el.firstColSelect.value = firstIdx === NONE ? NONE : String(firstIdx);

    renderPreview();
  }

  function excelRows() {
    const rows = sheetRows(el.sheetSelect.value);
    const body = el.skipHeader.checked ? rows.slice(1) : rows;
    const li = parseInt(el.lastColSelect.value, 10);
    const fv = el.firstColSelect.value;
    const fi = fv === NONE ? -1 : parseInt(fv, 10);

    return body.map(r => {
      const a = (r[li] || '').trim();
      const b = fi >= 0 ? (r[fi] || '').trim() : '';
      if (!a && !b) return null;
      // 名の列を使わないときは、1つのセルに入ったフルネームを姓と名に分ける
      if (fi < 0) return splitName(a);
      return { last: a, first: b };
    }).filter(Boolean);
  }

  function renderPreview() {
    const rows = excelRows();
    el.previewTable.innerHTML =
      '<thead><tr><th class="col-no">#</th><th>姓</th><th>名</th></tr></thead>';
    const tb = document.createElement('tbody');
    rows.slice(0, 60).forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td class="col-no">${i + 1}</td><td></td><td></td>`;
      tr.children[1].textContent = r.last;
      tr.children[2].textContent = r.first;
      tb.appendChild(tr);
    });
    el.previewTable.appendChild(tb);
    el.previewSummary.textContent = rows.length
      ? `${rows.length}人を取り込みます${rows.length > 60 ? '（表示は先頭60人）' : ''}`
      : '取り込める行が見つかりません。列の指定を変えてみてください。';
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

  el.resetBtn.addEventListener('click', () => {
    const c = activeClass();
    if (!c) return;
    pickedByClass.delete(c.id);
    historyOrder.delete(c.id);
    rotation = 0;
    applyRotation();
    el.resultName.textContent = '—';
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

  /* ---------------- 起動 ---------------- */

  el.optRemove.checked = state.settings.removeAfterPick;
  el.optSound.checked = state.settings.sound;
  el.optDisplay.value = state.settings.display;
  renderAll();
})();
