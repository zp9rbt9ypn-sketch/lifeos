/* LIFE OS - 画面にもストレージにも依存しない純粋なロジック層。
 * ブラウザでは window.Logic、Node では require() で使える(テスト用)。
 *
 * 履歴を守る仕組み:
 *  - 予定は「版(revision)」の配列で持つ。編集すると今日付けの新しい版が追加され、
 *    過去の日付は当時の版で計算される。
 *  - 完了/スキップの記録(logs)は、その時点の名前・時刻・所要時間のコピーを持つ。
 *  - 削除は deletedFrom(その日以降は表示しない)で表し、実データは消さない。
 */
(function (root) {
  'use strict';

  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜はじまりの表示順
  const pad = (n) => String(n).padStart(2, '0');

  // ---------- 日付・時刻 ----------
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function weekday(s) { return parseDate(s).getDay(); }
  function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }
  function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  function fromMin(m) { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function endLabel(start, duration) {
    const e = toMin(start) + duration;
    return (e >= 1440 ? '翌' : '') + fromMin(e);
  }
  function durLabel(min) {
    if (min < 60) return min + '分';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? h + '時間' + m + '分' : h + '時間';
  }
  function dateLabel(s) { const d = parseDate(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日(' + WD[d.getDay()] + ')'; }
  function daysLabel(days) {
    const set = new Set(days);
    if (set.size === 7) return '毎日';
    if (set.size === 5 && [1, 2, 3, 4, 5].every((x) => set.has(x))) return '平日';
    if (set.size === 2 && set.has(0) && set.has(6)) return '土日';
    return WEEK_ORDER.filter((x) => set.has(x)).map((x) => WD[x]).join('');
  }
  const makeKey = (date, id) => date + '|' + id;
  function newId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- 入力チェック ----------
  function validateInput(i) {
    const errors = [];
    const title = String(i.title == null ? '' : i.title).trim();
    if (!title) errors.push('名前を入力してください');
    if (title.length > 40) errors.push('名前は40文字までです');
    const start = String(i.start || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) errors.push('開始時刻を入力してください');
    const duration = Number(i.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) errors.push('所要時間は1〜1440分で入力してください');
    const once = i.once || null;
    let days = [];
    if (once) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(once)) errors.push('日付が正しくありません');
    } else {
      days = Array.from(new Set((i.days || []).map(Number))).sort((a, b) => a - b);
      if (!days.length || days.some((d) => !(d >= 0 && d <= 6))) errors.push('曜日を1つ以上選んでください');
    }
    return { ok: errors.length === 0, errors, value: { title, start, duration, days, once } };
  }

  // ---------- 予定(版管理) ----------
  function createSchedule(input, today, id) {
    const v = validateInput(input);
    if (!v.ok) throw new Error(v.errors.join(' / '));
    return {
      id: id || newId('s'),
      createdAt: today,
      deletedFrom: null,
      revisions: [Object.assign({ from: today, paused: false }, v.value)],
    };
  }
  function latestRev(s) { return s.revisions[s.revisions.length - 1]; }
  // patch: 変更したい項目(title/start/duration/days/paused)。今日からの新しい版として保存する。
  function reviseSchedule(s, patch, today) {
    const clone = JSON.parse(JSON.stringify(s));
    const last = latestRev(clone);
    const merged = Object.assign({}, last, patch);
    const v = validateInput(merged);
    if (!v.ok) throw new Error(v.errors.join(' / '));
    const rev = Object.assign({ from: today, paused: !!merged.paused }, v.value);
    if (last.from >= today) clone.revisions[clone.revisions.length - 1] = rev;
    else clone.revisions.push(rev);
    return clone;
  }
  function deleteSchedule(s, today) {
    const clone = JSON.parse(JSON.stringify(s));
    clone.deletedFrom = today;
    return clone;
  }
  function revisionFor(s, date) {
    if (s.deletedFrom && date >= s.deletedFrom) return null;
    let r = null;
    for (const rev of s.revisions) if (rev.from <= date) r = rev;
    return r;
  }
  // 予定管理画面に出す一覧(削除済みと過去の「その日だけ」は除く)
  function listSchedules(state, today) {
    const out = [];
    for (const s of state.schedules) {
      if (s.deletedFrom && s.deletedFrom <= today) continue;
      const rev = latestRev(s);
      if (rev.once && rev.once < today) continue;
      out.push({ id: s.id, rev, schedule: s });
    }
    return out.sort((a, b) => toMin(a.rev.start) - toMin(b.rev.start) || a.rev.title.localeCompare(b.rev.title, 'ja'));
  }

  // ---------- 1日分の予定 ----------
  function plannedFor(state, date) {
    const edits = {};
    for (const e of state.dayEdits || []) edits[e.key] = e;
    const items = [];
    for (const s of state.schedules) {
      const rev = revisionFor(s, date);
      if (!rev || rev.paused) continue;
      if (rev.once) { if (rev.once !== date) continue; }
      else if (!rev.days.includes(weekday(date))) continue;
      const key = makeKey(date, s.id);
      const edit = edits[key];
      const start = edit ? edit.start : rev.start;
      items.push({
        key, date, scheduleId: s.id, title: rev.title, start, baseStart: rev.start,
        duration: rev.duration, end: endLabel(start, rev.duration),
        shifted: !!edit && edit.start !== rev.start, once: !!rev.once, orphan: false,
      });
    }
    return items;
  }
  const byStart = (a, b) => toMin(a.start) - toMin(b.start) || a.title.localeCompare(b.title, 'ja');

  // 予定 + 記録 を合体した、その日の表示用リスト。
  // 後から停止・削除された予定でも、記録が残っていれば当時の内容で表示する。
  function dayView(state, date) {
    const logs = {};
    for (const l of state.logs || []) if (l.date === date) logs[l.key] = l;
    const items = plannedFor(state, date);
    const seen = new Set(items.map((i) => i.key));
    for (const i of items) i.log = logs[i.key] || null;
    for (const k of Object.keys(logs)) {
      if (seen.has(k)) continue;
      const l = logs[k];
      items.push({
        key: k, date, scheduleId: l.scheduleId, title: l.title, start: l.start, baseStart: l.start,
        duration: l.duration, end: endLabel(l.start, l.duration), shifted: false, once: false, orphan: true, log: l,
      });
    }
    return items.sort(byStart);
  }
  function summarize(items) {
    let done = 0, skipped = 0;
    for (const i of items) { if (i.log && i.log.status === 'done') done++; else if (i.log && i.log.status === 'skipped') skipped++; }
    return { total: items.length, done, skipped, pending: items.length - done - skipped };
  }
  // 記録は「その時点のコピー」を持つ
  function makeLog(item, status, atISO) {
    return {
      key: item.key, date: item.date, scheduleId: item.scheduleId, status,
      title: item.title, start: item.start, duration: item.duration, at: atISO,
    };
  }

  // ---------- 「次にやること」 ----------
  function nextInfo(items, nowMin) {
    if (!items.length) return { kind: 'empty' };
    const pending = items.filter((i) => !i.log);
    if (!pending.length) return { kind: 'alldone' };
    const cur = pending.find((i) => toMin(i.start) <= nowMin && nowMin < toMin(i.start) + i.duration);
    if (cur) return { kind: 'now', item: cur, minutesLeft: toMin(cur.start) + cur.duration - nowMin };
    const nxt = pending.find((i) => toMin(i.start) > nowMin);
    if (nxt) return { kind: 'next', item: nxt, minutesUntil: toMin(nxt.start) - nowMin };
    return { kind: 'past', item: pending[0], count: pending.length };
  }

  // ---------- 立て直し ----------
  // 時間が過ぎてしまった未完了の予定を「今から」順に並べ直す。
  // 先の予定は、重なる場合だけ後ろへ押し出す。戻り値は変更すべき予定の新しい開始時刻。
  function reflow(items, nowMin) {
    const ceil5 = (x) => Math.ceil(x / 5) * 5;
    const pending = items.filter((i) => !i.log && !i.orphan).sort(byStart);
    let cursor = ceil5(nowMin);
    for (const it of pending) { // 進行中の予定が終わるまでは動かさない
      const s = toMin(it.start), e = s + it.duration;
      if (s <= nowMin && nowMin < e) cursor = Math.max(cursor, e);
    }
    const changes = [];
    let overflow = false;
    for (const it of pending) {
      const s = toMin(it.start), e = s + it.duration;
      if (s <= nowMin && nowMin < e) continue;
      if (e <= nowMin || s < cursor) {
        if (cursor + it.duration > 1440) { overflow = true; break; }
        changes.push({ scheduleId: it.scheduleId, key: it.key, start: fromMin(cursor) });
        cursor += it.duration;
      } else {
        cursor = Math.max(cursor, e);
      }
    }
    return { changes, overflow };
  }

  const api = {
    toDateStr, parseDate, weekday, addDays, toMin, fromMin, endLabel, durLabel, dateLabel, daysLabel,
    makeKey, newId, validateInput, createSchedule, reviseSchedule, deleteSchedule, revisionFor,
    latestRev, listSchedules, plannedFor, dayView, summarize, makeLog, nextInfo, reflow, WD, WEEK_ORDER,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof self !== 'undefined' ? self : this);
