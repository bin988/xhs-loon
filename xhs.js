'use strict';

// ===== pure core =========================================================

function isNoteId(s) {
  return typeof s === 'string' && /^[0-9a-f]{24}$/.test(s);
}

function toHttps(u) {
  return String(u).replace(/^http:\/\//i, 'https://');
}

function bareUrl(u) {
  return String(u).split('?')[0];
}

function tryJSON(s) {
  if (typeof s !== 'string') return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function imageUrl(item) {
  if (!item || typeof item !== 'object') return null;
  var cand = item.original || item.url_size_large || item.url_default || item.url;
  if (!cand && item.url_multi_level && typeof item.url_multi_level === 'object') {
    cand = item.url_multi_level.high || item.url_multi_level.medium || item.url_multi_level.low;
  }
  if (!cand || typeof cand !== 'string') return null;
  return toHttps(bareUrl(cand));
}

function pickVideoUrl(streamItem) {
  if (!streamItem || typeof streamItem !== 'object') return null;
  var backups = streamItem.backup_urls;
  if (Array.isArray(backups) && backups.length && typeof backups[0] === 'string') {
    return toHttps(backups[0]);
  }
  if (typeof streamItem.master_url === 'string' && streamItem.master_url) {
    return toHttps(streamItem.master_url);
  }
  return null;
}

function codecRank(codec) {
  var c = String(codec || '').toLowerCase();
  if (c === 'h264' || c === 'avc') return 3;
  if (c === 'h265' || c === 'hevc') return 2;
  return 1;
}

function bestVideo(stream) {
  if (!stream || typeof stream !== 'object') return null;
  var best = null;

  function consider(s, key) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    var w = Number(s.width) || 0;
    var h = Number(s.height) || 0;
    if (!w || !h) return;
    var url = pickVideoUrl(s);
    if (!url) return;
    var codec = String(s.video_codec || key).toLowerCase();
    var cand = {
      url: url,
      w: w,
      h: h,
      px: w * h,
      br: Number(s.avg_bitrate) || 0,
      codec: codec,
      rank: codecRank(codec),
      size: Number(s.size) || 0
    };
    if (!best) {
      best = cand;
      return;
    }
    // iOS 对 VVC(h266) 支持不可靠：只要存在 h264/h265，就不选 h266
    var candPlayable = cand.rank >= 2 ? 1 : 0;
    var bestPlayable = best.rank >= 2 ? 1 : 0;
    if (candPlayable !== bestPlayable) {
      if (candPlayable) best = cand;
      return;
    }
    if (cand.px !== best.px) {
      if (cand.px > best.px) best = cand;
      return;
    }
    if (cand.rank !== best.rank) {
      if (cand.rank > best.rank) best = cand;
      return;
    }
    if (cand.br > best.br) best = cand;
  }

  for (var key in stream) {
    if (!Object.prototype.hasOwnProperty.call(stream, key)) continue;
    var arr = stream[key];
    if (!Array.isArray(arr)) continue;
    for (var i = 0; i < arr.length; i++) consider(arr[i], key);
  }
  return best;
}

function parseNote(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var id = obj.id || obj.note_id || obj.noteId;
  if (!isNoteId(id)) return null;

  var list = Array.isArray(obj.images_list) ? obj.images_list
    : (Array.isArray(obj.image_list) ? obj.image_list : null);
  var streams = null;
  var vinfo = obj.video_info_v2 || obj.video_info;
  if (vinfo && vinfo.media && vinfo.media.stream) streams = vinfo.media.stream;
  if (!streams && obj.video && obj.video.media && obj.video.media.stream) {
    streams = obj.video.media.stream;
  }
  if (!list && !streams) return null;

  var imgs = [];
  if (list) {
    for (var i = 0; i < list.length && imgs.length < 20; i++) {
      var u = imageUrl(list[i]);
      if (u && imgs.indexOf(u) === -1) imgs.push(u);
    }
  }

  var video = streams ? bestVideo(streams) : null;
  var card = obj.note_card && typeof obj.note_card === 'object' ? obj.note_card : null;
  var user = (obj.user && typeof obj.user === 'object' ? obj.user : null)
    || (card && card.user) || {};
  var title = obj.title || (card && card.title) || '';
  var author = user.nickname || user.name || '';
  var share = '';
  if (obj.share_info && obj.share_info.link) share = obj.share_info.link;
  else if (obj.qq_mini_program_info && obj.qq_mini_program_info.webpage_url) {
    share = obj.qq_mini_program_info.webpage_url;
  } else if (obj.mini_program_info && obj.mini_program_info.webpage_url) {
    share = obj.mini_program_info.webpage_url;
  }

  return {
    id: id,
    title: String(title || ''),
    author: String(author || ''),
    imgs: imgs,
    v: video ? video.url : '',
    share: String(share || ''),
    ts: 0
  };
}

function mergeNotes(a, b) {
  var imgs = (a.imgs || []).slice(0, 20);
  var incoming = b.imgs || [];
  for (var i = 0; i < incoming.length && imgs.length < 20; i++) {
    if (imgs.indexOf(incoming[i]) === -1) imgs.push(incoming[i]);
  }
  return {
    id: a.id,
    title: b.title || a.title || '',
    author: b.author || a.author || '',
    imgs: imgs,
    v: a.v || b.v || '',
    share: a.share || b.share || '',
    ts: Math.max(a.ts || 0, b.ts || 0)
  };
}

function extractNotes(json) {
  var byId = {};
  var order = [];
  var stack = [json];
  while (stack.length) {
    var x = stack.pop();
    if (!x || typeof x !== 'object') continue;
    if (Array.isArray(x)) {
      for (var i = 0; i < x.length; i++) stack.push(x[i]);
      continue;
    }
    var n = parseNote(x);
    if (n) {
      if (byId[n.id]) byId[n.id] = mergeNotes(byId[n.id], n);
      else {
        byId[n.id] = n;
        order.push(n.id);
      }
    }
    for (var k in x) {
      if (!Object.prototype.hasOwnProperty.call(x, k)) continue;
      var v = x[k];
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  var out = [];
  for (var j = 0; j < order.length; j++) out.push(byId[order[j]]);
  return out;
}

function mergeCache(cache, notes, now, cap) {
  var byId = {};
  function add(n, ts) {
    if (!n || !isNoteId(n.id)) return;
    var copy = {
      id: n.id,
      title: n.title || '',
      author: n.author || '',
      imgs: (n.imgs || []).slice(0, 20),
      v: n.v || '',
      share: n.share || '',
      ts: ts || now
    };
    byId[copy.id] = byId[copy.id] ? mergeNotes(byId[copy.id], copy) : copy;
  }
  var i;
  for (i = 0; i < (cache || []).length; i++) add(cache[i], cache[i].ts || 0);
  for (i = 0; i < (notes || []).length; i++) add(notes[i], now);

  var arr = [];
  for (var k in byId) {
    if (Object.prototype.hasOwnProperty.call(byId, k)) arr.push(byId[k]);
  }
  arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return arr.slice(0, cap || 20);
}

function buildPayload(note) {
  return {
    t: note.title || '',
    a: note.author || '',
    i: (note.imgs || []).slice(0, 20),
    v: note.v || '',
    s: note.share || '',
    id: note.id || ''
  };
}

function buildShortcutUrl(name, payload) {
  return 'shortcuts://run-shortcut?name=' + encodeURIComponent(name) +
    '&input=text&text=' + encodeURIComponent(JSON.stringify(payload));
}

function parseNoteId(text) {
  if (text === null || text === undefined) return null;
  var m = String(text).match(/([0-9a-f]{24})/);
  return m ? m[1] : null;
}

function parseLikeBody(body) {
  if (body === null || body === undefined) return null;
  var s = String(body);
  var m = s.match(/oid=(?:discovery\.)?([0-9a-f]{24})/);
  if (m) return m[1];
  var j = tryJSON(s);
  if (j) {
    var id = j.note_id || j.noteId || j.id || j.oid;
    if (isNoteId(id)) return id;
  }
  return parseNoteId(s);
}

function parseCollectBody(body) {
  if (body === null || body === undefined) return null;
  var j = tryJSON(String(body));
  if (j) {
    var id = j.note_id || j.notes_id || j.noteId || j.id;
    if (isNoteId(id)) return id;
  }
  return parseNoteId(body);
}

function parseShareBody(body) {
  var j = tryJSON(typeof body === 'string' ? body : '');
  if (!j || !j.shareChannel) return null;
  var id = j.shareObjectId;
  if (!isNoteId(id)) {
    var extra = j.extraInfo && j.extraInfo.originalShareInfo;
    var content = '';
    if (typeof extra === 'string') content = extra;
    else if (extra && typeof extra === 'object') content = extra.content || extra.urlLink || '';
    id = parseNoteId(content);
  }
  if (!isNoteId(id)) return null;
  return { id: id, channel: String(j.shareChannel) };
}

// ===== Loon runtime glue =================================================

var SHORTCUT_NAME = '小红书源文件';
var CACHE_KEY = 'xhs_cache_v1';
var DONE_KEY = 'xhs_done_v1';
var PENDING_KEY = 'xhs_pending_like_v1';
var WANTED_KEY = 'xhs_wanted_v1';
var CACHE_CAP = 20;
var DONE_TTL = 12 * 60 * 60 * 1000;
var WANTED_TTL = 10 * 60 * 1000;

var CACHE_RE = /\/api\/sns\/(?:v1\/note\/(?:imagefeed|detailfeed\/preload)|v4\/note\/videofeed|v6\/homefeed)(?:[?#]|$)/;
var LIKE_RE = /\/api\/sns\/v1\/note\/like(?:[?#]|$)/;
var COLLECT_RE = /\/api\/sns\/v1\/note\/collect(?:[?#]|$)/;
var SHARE_RE = /\/api\/growth\/schubert\/share\/content(?:[?#]|$)/;

function readJSON(key, fallback) {
  try {
    var s = $persistentStore.read(key);
    if (!s) return fallback;
    var v = JSON.parse(s);
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === null || value === undefined) {
      $persistentStore.write(null, key);
      return;
    }
    $persistentStore.write(JSON.stringify(value), key);
  } catch (e) {}
}

function findNote(id) {
  var cache = readJSON(CACHE_KEY, []);
  for (var i = 0; i < cache.length; i++) {
    if (cache[i] && cache[i].id === id) return cache[i];
  }
  return null;
}

function trigger(note, source) {
  if (!note || !isNoteId(note.id)) return false;
  var now = Date.now();
  var done = readJSON(DONE_KEY, {});
  if (done[note.id] && now - done[note.id] < DONE_TTL) {
    console.log('[xhs] skip duplicate ' + source + ' ' + note.id);
    return false;
  }

  var payload = buildPayload(note);
  var attach = {
    openUrl: buildShortcutUrl(SHORTCUT_NAME, payload),
    clipboard: JSON.stringify(payload)
  };
  var text = '点击保存 ' + payload.i.length + ' 图' + (payload.v ? ' + 视频' : '');
  try {
    $notification.post('小红书 · 源文件', note.title || note.id, text, attach);
  } catch (e) {
    return false;
  }

  done[note.id] = now;
  var keep = {};
  for (var k in done) {
    if (Object.prototype.hasOwnProperty.call(done, k)
      && now - done[k] <= 7 * 24 * 60 * 60 * 1000) {
      keep[k] = done[k];
    }
  }
  writeJSON(DONE_KEY, keep);
  console.log('[xhs] trigger ' + source + ' ' + note.id);
  return true;
}

function triggerById(id, source) {
  if (!isNoteId(id)) return false;
  var note = findNote(id);
  if (!note) {
    var now = Date.now();
    var wanted = readJSON(WANTED_KEY, {});
    wanted[id] = now;
    var stale = [];
    for (var k in wanted) {
      if (Object.prototype.hasOwnProperty.call(wanted, k) && now - wanted[k] > WANTED_TTL) stale.push(k);
    }
    for (var i = 0; i < stale.length; i++) delete wanted[stale[i]];
    writeJSON(WANTED_KEY, wanted);
    console.log('[xhs] wanted ' + source + ' ' + id);
    return false;
  }
  return trigger(note, source);
}

function handleCache() {
  var body = $response && $response.body;
  if (typeof body !== 'string' || !body) return;
  var json = tryJSON(body);
  if (!json) return;
  var notes = extractNotes(json);
  if (!notes.length) return;

  var now = Date.now();
  var cache = mergeCache(readJSON(CACHE_KEY, []), notes, now, CACHE_CAP);
  writeJSON(CACHE_KEY, cache);

  var wanted = readJSON(WANTED_KEY, {});
  var changed = false;
  var ids = [];
  for (var id in wanted) {
    if (Object.prototype.hasOwnProperty.call(wanted, id)) ids.push(id);
  }
  for (var i = 0; i < ids.length; i++) {
    var id2 = ids[i];
    if (now - wanted[id2] > WANTED_TTL) {
      delete wanted[id2];
      changed = true;
      continue;
    }
    var note = null;
    for (var j = 0; j < cache.length; j++) {
      if (cache[j].id === id2) { note = cache[j]; break; }
    }
    if (note && trigger(note, 'wanted')) {
      delete wanted[id2];
      changed = true;
    }
  }
  if (changed) writeJSON(WANTED_KEY, wanted);
}

function handleLikeRequest() {
  var id = parseLikeBody($request && $request.body);
  if (id) writeJSON(PENDING_KEY, { id: id, ts: Date.now() });
}

function handleLikeResponse() {
  var body = $response && $response.body;
  var json = typeof body === 'string' ? tryJSON(body) : null;
  if (!json || !json.data || json.data.inlikes !== true) return;

  var pending = readJSON(PENDING_KEY, null);
  var id = null;
  if (pending && pending.id && Date.now() - (pending.ts || 0) < 60 * 1000) {
    id = pending.id;
  } else {
    id = parseLikeBody($request && $request.body);
  }
  writeJSON(PENDING_KEY, null);
  if (id) triggerById(id, 'like');
}

function handleCollectRequest() {
  var id = parseCollectBody($request && $request.body);
  if (id) triggerById(id, 'collect');
}

function handleShareRequest() {
  var info = parseShareBody($request && $request.body);
  if (info) triggerById(info.id, 'share:' + info.channel);
}

function requestResult() {
  var result = {};
  if (!$request) return result;

  if (typeof $request.body !== 'undefined') result.body = $request.body;

  var headers = {};
  var src = $request.headers || {};
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) headers[k] = src[k];
  }

  var hasContentType = false;
  for (var h in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, h) && h.toLowerCase() === 'content-type') {
      hasContentType = true;
      break;
    }
  }

  // Loon 的 request 脚本在 $done({}) 时可能丢掉 Content-Type，
  // 服务端会把 body 当成空 -> 400 "param is required"。显式回传并补齐。
  if (!hasContentType) {
    var url = $request.url || '';
    if (LIKE_RE.test(url)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
    } else if (COLLECT_RE.test(url) || SHARE_RE.test(url)) {
      headers['Content-Type'] = 'application/json';
    }
  }
  result.headers = headers;
  return result;
}

function main() {
  var isResponse = typeof $response !== 'undefined';
  try {
    var url = ($request && $request.url) || '';

    if (isResponse && CACHE_RE.test(url)) handleCache();
    else if (!isResponse && LIKE_RE.test(url)) handleLikeRequest();
    else if (isResponse && LIKE_RE.test(url)) handleLikeResponse();
    else if (!isResponse && COLLECT_RE.test(url)) handleCollectRequest();
    else if (!isResponse && SHARE_RE.test(url)) handleShareRequest();
  } catch (e) {
    try {
      console.log('[xhs] error: ' + (e && e.message ? e.message : e));
    } catch (e2) {}
  } finally {
    $done(isResponse ? {} : requestResult());
  }
}

// ===== exports for tests =================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isNoteId: isNoteId,
    toHttps: toHttps,
    bareUrl: bareUrl,
    tryJSON: tryJSON,
    imageUrl: imageUrl,
    pickVideoUrl: pickVideoUrl,
    bestVideo: bestVideo,
    parseNote: parseNote,
    mergeNotes: mergeNotes,
    extractNotes: extractNotes,
    mergeCache: mergeCache,
    buildPayload: buildPayload,
    buildShortcutUrl: buildShortcutUrl,
    parseNoteId: parseNoteId,
    parseLikeBody: parseLikeBody,
    parseCollectBody: parseCollectBody,
    parseShareBody: parseShareBody
  };
}

// ===== Loon entry (main is added in Task 2) ===============================

if (typeof $request !== 'undefined' || typeof $response !== 'undefined') {
  main();
}
