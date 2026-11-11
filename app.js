/* LIFE OS - 画面と操作(段階1: 今日 / 予定)。
 * データの計算は logic.js、保存は db.js。ここは表示と操作だけを担当する。 */
(function () {
  'use strict';
  const L = window.Logic, DB = window.LifeDB;
  const S = { schedules: [], logs: [], dayEdits: [], todos: [], moods: [] };
  const ui = { tab: 'today', sheet: null };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => L.toDateStr(new Date());
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  const ICONS = {
    today: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    schedule: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    todo: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
    insight: '<path d="M5 19v-8M12 19V5M19 19v-5"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4"/><path d="M12 8v4l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    dash: '<path d="M7 12h10"/>',
  };
  const icon = (n) => '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[n] + '</svg>';

  // ---------- 保存 ----------
  async function save(store, obj) {
    try { await DB.put(store, obj); return true; }
    catch (e) { toast('保存に失敗しました。もう一度お試しください'); console.error(e); return false; }
  }
  async function remove(store, key) {
    try { await DB.del(store, key); return true; }
    catch (e) { toast('保存に失敗しました。もう一度お試しください'); console.error(e); return false; }
  }
  function upsert(arr, obj, keyName) {
    const i = arr.findIndex((x) => x[keyName] === obj[keyName]);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- 操作 ----------
  const findItem = (key) => L.dayView(S, today()).find((i) => i.key === key);

  async function setStatus(key, status) { // status: 'done' | 'skipped' | null(元に戻す)
    const item = findItem(key);
    if (!item) return;
    if (status === null) {
      if (!(await remove('logs', key))) return;
      S.logs = S.logs.filter((l) => l.key !== key);
    } else {
      const log = L.makeLog(item, status, new Date().toISOString());
      if (!(await save('logs', log))) return;
      upsert(S.logs, log, 'key');
    }
  }
  async function toggleDone(key) {
    const item = findItem(key);
    if (!item) return;
    await setStatus(key, item.log ? null : 'done');
    render();
  }
  async function shiftToday(key, start) {
    const item = findItem(key);
    if (!item || item.orphan) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) { toast('時刻を入力してください'); return; }
    const edit = { key, date: item.date, scheduleId: item.scheduleId, start };
    if (start === item.baseStart) { // 元の時刻に戻すなら、変更記録は消す
      if (!(await remove('dayEdits', key))) return;
      S.dayEdits = S.dayEdits.filter((e) => e.key !== key);
    } else {
      if (!(await save('dayEdits', edit))) return;
      upsert(S.dayEdits, edit, 'key');
    }
  }
  async function reflowNow() {
    const items = L.dayView(S, today());
    const { changes, overflow } = L.reflow(items, nowMin());
    if (!changes.length) { toast(overflow ? '今日のうちに収まりません。いくつか見直してみましょう' : '組み直す予定はありません'); return; }
    for (const c of changes) await shiftToday(c.key, c.start);
    toast(overflow ? '入る分だけ組み直しました' : changes.length + '件を今からの時間に組み直しました');
    render();
  }
  async function setMood(value) {
    const d = today();
    const cur = S.moods.find((m) => m.date === d);
    if (cur && cur.value === value) {
      if (!(await remove('moods', d))) return;
      S.moods = S.moods.filter((m) => m.date !== d);
    } else {
      const m = { date: d, value, at: new Date().toISOString() };
      if (!(await save('moods', m))) return;
      upsert(S.moods, m, 'date');
    }
    render();
  }

  // ---------- 画面: 今日 ----------
  function rowHTML(it, n) {
    const st = it.log ? it.log.status : 'pending';
    const running = !it.log && L.toMin(it.start) <= n && n < L.toMin(it.start) + it.duration;
    const label = st === 'done' ? '完了を取り消す' : st === 'skipped' ? 'スキップを取り消す' : '完了にする';
    const notes = (it.shifted ? ' · ずらし済み' : '') + (st === 'skipped' ? ' · スキップ' : '') + (it.once ? ' · 今日だけ' : '');
    return '<li class="row ' + st + (running ? ' now' : '') + '">' +
      '<button class="check" data-act="toggle" data-key="' + esc(it.key) + '" aria-label="' + label + '" aria-pressed="' + (st === 'done') + '"><span>' +
      (st === 'done' ? icon('check') : st === 'skipped' ? icon('dash') : '') + '</span></button>' +
      '<button class="body" data-act="open-item" data-key="' + esc(it.key) + '">' +
      '<span class="t">' + esc(it.title) + '</span>' +
      '<span class="m">' + it.start + '–' + it.end + ' · ' + L.durLabel(it.duration) + notes + '</span></button></li>';
  }
  function heroHTML(info) {
    const meta = (it) => it.start + '–' + it.end + ' · ' + L.durLabel(it.duration);
    const k = esc;
    switch (info.kind) {
      case 'now':
        return '<section class="hero"><div class="label">いま · あと' + L.durLabel(info.minutesLeft) + '</div><div class="title">' + k(info.item.title) + '</div><div class="meta">' + meta(info.item) + '</div>' +
          '<div class="actions"><button class="btn primary" data-act="toggle" data-key="' + k(info.item.key) + '">' + icon('check') + '完了にする</button>' +
          '<button class="btn" data-act="open-item" data-key="' + k(info.item.key) + '">変更</button></div></section>';
      case 'next':
        return '<section class="hero"><div class="label">次 · ' + (info.minutesUntil >= 60 ? L.durLabel(info.minutesUntil) + '後' : info.minutesUntil + '分後') + '</div><div class="title">' + k(info.item.title) + '</div><div class="meta">' + meta(info.item) + '</div>' +
          '<div class="actions"><button class="btn" data-act="open-item" data-key="' + k(info.item.key) + '">時間をずらす / スキップ</button></div></section>';
      case 'past':
        return '<section class="hero"><div class="label">まだの予定があります</div><div class="title">' + k(info.item.title) + '</div><div class="meta">' + meta(info.item) + '</div>' +
          '<div class="actions"><button class="btn primary" data-act="toggle" data-key="' + k(info.item.key) + '">' + icon('check') + '完了にする</button>' +
          '<button class="btn" data-act="open-item" data-key="' + k(info.item.key) + '">変更</button></div></section>';
      case 'alldone':
        return '<section class="hero calm"><div class="label">今日の予定</div><div class="title">ぜんぶ終わりました</div><div class="meta">おつかれさまでした。</div></section>';
      default:
        return '<section class="hero calm"><div class="label">今日の予定</div><div class="title">予定はありません</div><div class="meta">ゆっくり過ごす日もあります。</div>' +
          '<div class="actions"><button class="btn" data-act="new-once">今日だけの予定を足す</button></div></section>';
    }
  }
  function viewToday() {
    const d = today(), n = nowMin();
    const items = L.dayView(S, d);
    const sum = L.summarize(items);
    const info = L.nextInfo(items, n);
    const mood = (S.moods.find((m) => m.date === d) || {}).value;
    const missed = items.some((i) => !i.log && !i.orphan && L.toMin(i.start) + i.duration <= n);
    const pct = sum.total ? Math.round(((sum.done + sum.skipped) / sum.total) * 100) : 0;
    const faces = ['😣', '😕', '😐', '🙂', '😄'], names = ['つらい', 'いまいち', 'ふつう', 'いい', 'とてもいい'];
    return '<div class="top"><div><h1>' + L.dateLabel(d) + '</h1><div class="sub">' + (sum.total ? sum.done + ' / ' + sum.total + ' 完了' : '今日の予定') + '</div></div>' +
      '<button class="icon-btn" data-act="new-once" aria-label="今日だけの予定を追加">' + icon('plus') + '</button></div>' +
      (sum.total ? '<div class="progress" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div>' : '') +
      heroHTML(info) +
      (items.length ? '<div class="section-h"><span>今日の流れ</span>' + (missed ? '<button class="link" data-act="reflow">残りを今から組み直す</button>' : '') + '</div><ul class="list">' + items.map((i) => rowHTML(i, n)).join('') + '</ul>' : '') +
      '<div class="section-h"><span>今日の調子(あとからでOK)</span></div>' +
      '<div class="mood">' + faces.map((f, i) => '<button data-act="mood" data-v="' + (i + 1) + '" aria-label="' + names[i] + '" aria-pressed="' + (mood === i + 1) + '">' + f + '</button>').join('') + '</div>';
  }

  // ---------- 画面: 予定 ----------
  function viewSchedule() {
    const list = L.listSchedules(S, today());
    const cards = list.map(({ id, rev }) => {
      const when = rev.once ? (rev.once === today() ? '今日だけ' : L.dateLabel(rev.once)) : L.daysLabel(rev.days);
      return '<li><button class="card ' + (rev.paused ? 'paused' : '') + '" data-act="edit" data-id="' + esc(id) + '">' +
        '<div class="t">' + esc(rev.title) + (rev.paused ? '<span class="badge paused">停止中</span>' : '') + '</div>' +
        '<div class="m">' + rev.start + '–' + L.endLabel(rev.start, rev.duration) + ' · ' + L.durLabel(rev.duration) + ' · ' + when + '</div></button></li>';
    }).join('');
    return '<div class="top"><div><h1>予定</h1><div class="sub">くり返す予定を登録します</div></div>' +
      '<button class="icon-btn" data-act="new" aria-label="予定を追加">' + icon('plus') + '</button></div>' +
      (list.length ? '<ul class="list">' + cards + '</ul>' : '<div class="empty">まだ予定がありません。<br>右上の＋から追加できます。</div>') +
      '<p class="note" style="color:var(--muted);font-size:13px;margin:4px 2px">予定を変えても、過去の履歴は当時のまま残ります。</p>';
  }

  // ---------- 画面: 未実装タブ ----------
  const STUB = { todo: ['ToDo', 'タスクの追加・期限・優先度は次の段階で作ります。'], insight: ['分析', '実行率のグラフは、データが貯まってから見られるよう次の段階で作ります。'], history: ['履歴', '日付ごとの振り返りは次の段階で作ります。'] };
  function viewStub(tab) {
    return '<div class="top"><div><h1>' + STUB[tab][0] + '</h1></div></div><div class="empty stub"><h2>準備中</h2>' + STUB[tab][1] + '</div>';
  }

  // ---------- シート ----------
  function itemSheet(key) {
    const it = findItem(key);
    if (!it) return null;
    const st = it.log ? it.log.status : 'pending';
    let h = '<h2>' + esc(it.title) + '</h2><div class="note" style="margin:-6px 2px 14px">' + it.start + '–' + it.end + ' · ' + L.durLabel(it.duration) + '</div><div class="stack">';
    if (st === 'pending') {
      h += '<button class="btn primary block" data-act="sheet-done" data-key="' + esc(key) + '">' + icon('check') + '完了にする</button>';
      h += '<button class="btn block" data-act="sheet-skip" data-key="' + esc(key) + '">今日はスキップ</button>';
      if (!it.orphan) {
        h += '<div class="field" style="margin:6px 0 0"><span class="lbl">今日だけ時間を変える</span><div class="row2"><input type="time" id="shift-time" value="' + it.start + '" aria-label="開始時刻"><button class="btn" data-act="sheet-shift" data-key="' + esc(key) + '">変更</button></div></div>';
        if (it.shifted) h += '<button class="btn block" data-act="sheet-unshift" data-key="' + esc(key) + '">元の時間(' + it.baseStart + ')に戻す</button>';
      }
    } else {
      h += '<button class="btn block" data-act="sheet-undo" data-key="' + esc(key) + '">' + (st === 'done' ? '完了を取り消す' : 'スキップを取り消す') + '</button>';
    }
    return h + '<button class="btn block" data-act="close">閉じる</button></div>' + (it.orphan ? '<p class="note">この予定は停止または削除されています。記録だけ残っています。</p>' : '<p class="note">ここでの変更は今日だけです。毎回の予定は「予定」タブで変えられます。</p>');
  }
  function formSheet(sh) {
    const edit = sh.id ? S.schedules.find((s) => s.id === sh.id) : null;
    const rev = edit ? L.latestRev(edit) : null;
    const once = rev ? rev.once : (sh.once ? today() : null);
    const d = new Date(); const h0 = Math.min(d.getHours() + 1, 23);
    const v = rev || { title: '', start: String(h0).padStart(2, '0') + ':00', duration: 30, days: [0, 1, 2, 3, 4, 5, 6], paused: false };
    const durs = [15, 30, 45, 60, 90, 120];
    let h = '<h2>' + (edit ? '予定を編集' : once ? '今日だけの予定' : '予定を追加') + '</h2>';
    h += '<div id="form-err" class="err" hidden></div><form id="sched-form" novalidate>';
    h += '<div class="field"><label for="f-title">名前</label><input type="text" id="f-title" maxlength="40" placeholder="例: 勉強" value="' + esc(v.title) + '" autocomplete="off"></div>';
    h += '<div class="row2"><div class="field"><label for="f-start">開始</label><input type="time" id="f-start" value="' + v.start + '"></div>' +
      '<div class="field"><label for="f-dur">所要時間(分)</label><input type="number" id="f-dur" inputmode="numeric" min="1" max="1440" value="' + v.duration + '"></div></div>';
    h += '<div class="field"><span class="lbl">よく使う時間</span><div class="chips">' + durs.map((x) => '<button type="button" class="chip" data-act="dur" data-v="' + x + '" aria-pressed="' + (x === Number(v.duration)) + '">' + L.durLabel(x) + '</button>').join('') + '</div></div>';
    if (!once) {
      h += '<div class="field"><span class="lbl">くり返す曜日</span><div class="days">' + L.WEEK_ORDER.map((w) => '<button type="button" class="chip" data-act="day" data-v="' + w + '" aria-pressed="' + v.days.includes(w) + '">' + L.WD[w] + '</button>').join('') + '</div>' +
        '<div class="chips" style="margin-top:6px"><button type="button" class="chip" data-act="days-preset" data-v="all">毎日</button><button type="button" class="chip" data-act="days-preset" data-v="weekday">平日</button><button type="button" class="chip" data-act="days-preset" data-v="weekend">土日</button></div></div>';
    }
    h += '<div class="stack"><button type="submit" class="btn primary block">保存</button>';
    if (edit) {
      h += '<button type="button" class="btn block" data-act="toggle-pause" data-id="' + esc(edit.id) + '">' + (rev.paused ? '再開する' : '一時停止する') + '</button>';
      h += '<button type="button" class="btn block danger" data-act="delete" data-id="' + esc(edit.id) + '">削除</button>';
    }
    h += '<button type="button" class="btn block" data-act="close">キャンセル</button></div></form>';
    h += '<p class="note">' + (edit ? '変更は今日から反映されます。過去の履歴は変わりません。' : once ? '今日だけの予定です。' : '') + '</p>';
    return h;
  }
  function renderSheet() {
    const el = $('#sheet');
    const sh = ui.sheet;
    let inner = null;
    if (sh) inner = sh.type === 'item' ? itemSheet(sh.key) : formSheet(sh);
    if (!sh || inner == null) { ui.sheet = null; el.className = ''; el.innerHTML = ''; return; }
    el.className = 'open';
    el.innerHTML = '<div class="backdrop" data-act="close"></div><div class="panel" role="dialog" aria-modal="true">' + inner + '</div>';
    const first = el.querySelector('#f-title');
    if (first && !sh.id) first.focus();
  }
  const closeSheet = () => { ui.sheet = null; renderSheet(); };

  function readForm() {
    const days = Array.from(document.querySelectorAll('[data-act="day"][aria-pressed="true"]')).map((b) => Number(b.dataset.v));
    return { title: $('#f-title').value, start: $('#f-start').value, duration: $('#f-dur').value === '' ? NaN : Number($('#f-dur').value), days };
  }
  async function submitForm() {
    const sh = ui.sheet;
    const edit = sh.id ? S.schedules.find((s) => s.id === sh.id) : null;
    const input = readForm();
    const onceDate = edit ? L.latestRev(edit).once : (sh.once ? today() : null);
    if (onceDate) input.once = onceDate;
    const v = L.validateInput(input);
    if (!v.ok) { const e = $('#form-err'); e.textContent = v.errors.join(' / '); e.hidden = false; return; }
    const sched = edit ? L.reviseSchedule(edit, input, today()) : L.createSchedule(input, today());
    if (!(await save('schedules', sched))) return;
    upsert(S.schedules, sched, 'id');
    closeSheet(); render(); toast(edit ? '保存しました' : '追加しました');
  }

  // ---------- 全体描画 ----------
  function renderTabs() {
    const tabs = [['today', '今日'], ['schedule', '予定'], ['todo', 'ToDo'], ['insight', '分析'], ['history', '履歴']];
    $('#tabs').innerHTML = '<div class="inner">' + tabs.map(([k, name]) => '<button data-act="tab" data-tab="' + k + '"' + (ui.tab === k ? ' aria-current="page"' : '') + '>' + icon(k) + '<span>' + name + '</span></button>').join('') + '</div>';
  }
  function render() {
    $('#view').innerHTML = ui.tab === 'today' ? viewToday() : ui.tab === 'schedule' ? viewSchedule() : viewStub(ui.tab);
    renderTabs();
    if (ui.sheet && ui.sheet.type === 'item') renderSheet(); // 状態が変わったらシートも合わせる
  }

  // ---------- イベント ----------
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act, key = t.dataset.key, id = t.dataset.id;
    switch (a) {
      case 'tab': ui.tab = t.dataset.tab; ui.sheet = null; renderSheet(); render(); window.scrollTo(0, 0); break;
      case 'toggle': await toggleDone(key); break;
      case 'open-item': ui.sheet = { type: 'item', key }; renderSheet(); break;
      case 'close': closeSheet(); break;
      case 'sheet-done': await setStatus(key, 'done'); closeSheet(); render(); break;
      case 'sheet-skip': await setStatus(key, 'skipped'); closeSheet(); render(); toast('スキップにしました'); break;
      case 'sheet-undo': await setStatus(key, null); closeSheet(); render(); break;
      case 'sheet-shift': await shiftToday(key, $('#shift-time').value); closeSheet(); render(); break;
      case 'sheet-unshift': { const it = findItem(key); await shiftToday(key, it.baseStart); closeSheet(); render(); break; }
      case 'reflow': await reflowNow(); break;
      case 'mood': await setMood(Number(t.dataset.v)); break;
      case 'new': ui.sheet = { type: 'form', id: null, once: false }; renderSheet(); break;
      case 'new-once': ui.sheet = { type: 'form', id: null, once: true }; renderSheet(); break;
      case 'edit': ui.sheet = { type: 'form', id }; renderSheet(); break;
      case 'dur': $('#f-dur').value = t.dataset.v; document.querySelectorAll('[data-act="dur"]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); break;
      case 'day': t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true')); break;
      case 'days-preset': {
        const set = { all: [0, 1, 2, 3, 4, 5, 6], weekday: [1, 2, 3, 4, 5], weekend: [0, 6] }[t.dataset.v];
        document.querySelectorAll('[data-act="day"]').forEach((b) => b.setAttribute('aria-pressed', String(set.includes(Number(b.dataset.v)))));
        break;
      }
      case 'toggle-pause': {
        const s = S.schedules.find((x) => x.id === id);
        const paused = !L.latestRev(s).paused;
        const next = L.reviseSchedule(s, { paused }, today());
        if (await save('schedules', next)) { upsert(S.schedules, next, 'id'); closeSheet(); render(); toast(paused ? '一時停止しました(履歴は残ります)' : '再開しました'); }
        break;
      }
      case 'delete': {
        if (!window.confirm('この予定を削除しますか?\n今日までの履歴は残ります。')) break;
        const s = S.schedules.find((x) => x.id === id);
        const next = L.deleteSchedule(s, today());
        if (await save('schedules', next)) { upsert(S.schedules, next, 'id'); closeSheet(); render(); toast('削除しました(履歴は残ります)'); }
        break;
      }
    }
  });
  document.addEventListener('submit', (e) => { if (e.target.id === 'sched-form') { e.preventDefault(); submitForm(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.sheet) closeSheet(); });

  // 時間が進んだら「いま/次」を更新(入力中のシートは邪魔しない)
  const refresh = () => { if (!ui.sheet && !document.hidden) render(); };
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);

  // ---------- 起動 ----------
  async function boot() {
    renderTabs();
    try {
      await DB.open();
      Object.assign(S, await DB.loadAll());
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      $('#view').innerHTML = '<div class="empty">データを開けませんでした。<br>プライベートブラウズでは使えません。通常のSafariで開いてください。</div>';
      console.error(e); return;
    }
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
  window.__lifeos = { S, ui, render }; // 動作確認用
  boot();
})();
