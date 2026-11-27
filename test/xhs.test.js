'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isNoteId,
  imageUrl,
  pickVideoUrl,
  bestVideo,
  parseNote,
  mergeNotes,
  extractNotes,
  mergeCache,
  buildPayload,
  buildShortcutUrl,
  sanitizeName,
  parseNoteId,
  parseLikeBody,
  parseCollectBody,
  parseShareBody,
} = require('../xhs.js');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

test('isNoteId: 只认 24 位小写 hex', () => {
  assert.equal(isNoteId('aaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(isNoteId('AAAAAAAAAAAAAAAAAAAAAAAA'), false);
  assert.equal(isNoteId('abc'), false);
  assert.equal(isNoteId(null), false);
});

test('imageUrl: original 去 query 并转 https', () => {
  assert.equal(
    imageUrl({ original: 'http://sns-na-i2.xhscdn.com/img1?imageView2/2/w/5000' }),
    'https://sns-na-i2.xhscdn.com/img1'
  );
});

test('imageUrl: original 缺失时按 url_size_large → url → multi_level 回退', () => {
  assert.equal(imageUrl({ url_size_large: 'https://h/a.jpg?x=1' }), 'https://h/a.jpg');
  assert.equal(imageUrl({ url: 'https://h/b.jpg?x=1' }), 'https://h/b.jpg');
  assert.equal(imageUrl({ url_multi_level: { high: 'https://h/c.jpg?x=1' } }), 'https://h/c.jpg');
  assert.equal(imageUrl({}), null);
});

test('pickVideoUrl: 优先 backup_urls[0]，否则 master_url，统一 https', () => {
  assert.equal(
    pickVideoUrl({ backup_urls: ['http://bak/4k.mp4'], master_url: 'http://master/4k.mp4?sign=x' }),
    'https://bak/4k.mp4'
  );
  assert.equal(pickVideoUrl({ master_url: 'http://master/4k.mp4?sign=x' }), 'https://master/4k.mp4?sign=x');
  assert.equal(pickVideoUrl({}), null);
});

test('extractNotes: 图文两图 + 裸链 + 标题作者分享链', () => {
  const notes = extractNotes(fixture('imagefeed.json'));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(notes[0].imgs, [
    'https://sns-na-i2.xhscdn.com/img1',
    'https://sns-na-i2.xhscdn.com/img2',
  ]);
  assert.equal(notes[0].title, '测试图文');
  assert.equal(notes[0].author, '作者A');
  assert.match(notes[0].share, /^https:\/\/www\.xiaohongshu\.com\/discovery\/item\//);
  assert.equal(notes[0].v, '');
});

test('extractNotes: 视频选 4K backup，封面保留', () => {
  const n = extractNotes(fixture('videofeed.json'))[0];
  assert.equal(n.v, 'https://sns-bak-v1.xhscdn.com/4k.mp4');
  assert.equal(n.imgs.length, 1);
  assert.equal(n.imgs[0], 'https://sns-na-i2.xhscdn.com/cover');
});

test('extractNotes: homefeed 嵌套 note_card 也能找到', () => {
  const notes = extractNotes(fixture('homefeed.json'));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(notes[0].imgs.length, 2);
});

test('parseNote: 没有媒体的 dict 不算笔记', () => {
  assert.equal(parseNote({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', user: { nickname: 'x' } }), null);
});

test('extractNotes: 同一 note 出现两次时图片取并集、优先有视频', () => {
  const notes = extractNotes({
    a: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'A',
      images_list: [{ original: 'https://h/1?x' }],
    },
    b: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      title: 'B',
      images_list: [{ original: 'https://h/2?x' }],
      video_info_v2: { media: { stream: { h264: [{ width: 720, height: 1280, master_url: 'https://h/v.mp4' }] } } },
    },
  });
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].imgs.sort(), ['https://h/1', 'https://h/2']);
  assert.equal(notes[0].v, 'https://h/v.mp4');
});

test('bestVideo: 分辨率优先，其次 h264 优先，不选 h266', () => {
  const v = bestVideo({
    h264: [{ width: 720, height: 1280, avg_bitrate: 9e9, video_codec: 'h264', master_url: 'https://a/720.mp4' }],
    h265: [{ width: 2160, height: 3840, avg_bitrate: 1, video_codec: 'hevc', master_url: 'https://a/4k.mp4' }],
    h266: [{ width: 2160, height: 3840, avg_bitrate: 1, video_codec: 'vvc', master_url: 'https://a/4k-vvc.mp4' }],
  });
  assert.equal(v.url, 'https://a/4k.mp4');
  assert.equal(v.px, 2160 * 3840);
});

test('bestVideo: 有 h264/h265 时不选 h266（iOS 可能不支持 VVC）', () => {
  const v = bestVideo({
    h265: [{ width: 1080, height: 1920, video_codec: 'hevc', master_url: 'https://a/1080.mp4' }],
    h266: [{ width: 2160, height: 3840, video_codec: 'vvc', master_url: 'https://a/4k-vvc.mp4' }],
  });
  assert.equal(v.url, 'https://a/1080.mp4');
});

test('bestVideo: 同分辨率码率更高者胜', () => {
  const v = bestVideo({
    h265: [
      { width: 1080, height: 1920, avg_bitrate: 2, master_url: 'https://a/low.mp4' },
      { width: 1080, height: 1920, avg_bitrate: 5, master_url: 'https://a/high.mp4' },
    ],
  });
  assert.equal(v.url, 'https://a/high.mp4');
});

test('extractNotes: 视频记录 vpx/vsrc，便于跨响应合并时比质量', () => {
  const n = extractNotes(fixture('videofeed.json'))[0];
  assert.equal(n.vpx, 2160 * 3840);
  assert.equal(n.vsrc, 1);
});

test('mergeNotes: 后到的高清视频覆盖先前的低清/签名视频', () => {
  const id = 'a'.repeat(24);
  const a = { id: id, imgs: [], v: 'https://master/720.mp4?sign=x', vpx: 720 * 1280, vsrc: 0, vbr: 1, ts: 1 };
  const b = { id: id, imgs: [], v: 'https://bak/4k.mp4', vpx: 2160 * 3840, vsrc: 1, vbr: 5, ts: 2 };
  const m = mergeNotes(a, b);
  assert.equal(m.v, 'https://bak/4k.mp4');
  assert.equal(m.vpx, 2160 * 3840);
  assert.equal(m.vsrc, 1);
});

test('mergeNotes: 同分辨率优先 backup 链而不是签名 master', () => {
  const id = 'a'.repeat(24);
  const a = { id: id, imgs: [], v: 'https://master/4k.mp4?sign=x', vpx: 2160 * 3840, vsrc: 0, vbr: 9, ts: 1 };
  const b = { id: id, imgs: [], v: 'https://bak/4k.mp4', vpx: 2160 * 3840, vsrc: 1, vbr: 1, ts: 2 };
  assert.equal(mergeNotes(a, b).v, 'https://bak/4k.mp4');
});

test('pickVideoUrl: backup_urls[0] 为空串时回退 master_url', () => {
  assert.equal(
    pickVideoUrl({ backup_urls: [''], master_url: 'http://master/v.mp4?sign=x' }),
    'https://master/v.mp4?sign=x'
  );
});

test('mergeCache: 按 id 去重并按 ts 倒序截断到 cap', () => {
  const out = mergeCache(
    [
      { id: '111111111111111111111111', title: 'old', imgs: [], ts: 1 },
      { id: '222222222222222222222222', title: 'mid', imgs: [], ts: 2 },
    ],
    [{ id: '333333333333333333333333', title: 'new', imgs: [], ts: 3 }],
    10,
    2
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].id, '333333333333333333333333');
  assert.equal(out[1].id, '222222222222222222222222');
});

test('buildPayload: 键固定为 t/a/i/l/v/s/id/f，l 与 i 对齐', () => {
  const p = buildPayload({
    id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    title: 't',
    author: 'a',
    uid: 'u1',
    imgs: ['https://x/1', 'https://x/2'],
    live: { 'https://x/2': 'https://live/2' },
    v: '',
    share: 'https://s',
  });
  assert.deepEqual(Object.keys(p).sort(), ['a', 'f', 'i', 'id', 'l', 's', 't', 'v']);
  assert.deepEqual(p.i, ['https://x/1', 'https://x/2']);
  assert.deepEqual(p.l, ['', 'https://live/2']);
  assert.equal(p.f, 'a_u1_t');
});

test('sanitizeName: 去掉文件名非法字符', () => {
  const s = sanitizeName('a/b:c*?"<>|d');
  assert.ok(!/[\\/:*?"<>|]/.test(s), s);
  assert.ok(s.startsWith('a-b-c'), s);
  assert.ok(s.endsWith('d'), s);
});

test('extractNotes: 实况图的 live 视频与图片配对', () => {
  const n = extractNotes(fixture('livefeed.json'))[0];
  assert.equal(n.imgs.length, 2);
  assert.equal(n.uid, '123456789');
  assert.equal(
    n.live['https://sns-na-i4.xhscdn.com/liveimg1'],
    'https://sns-bak-v1.xhscdn.com/stream/1/10/66/live1.mp4'
  );
  assert.equal(n.live['https://sns-na-i4.xhscdn.com/liveimg2'], undefined);

  const p = buildPayload(n);
  assert.deepEqual(p.i, [
    'https://sns-na-i4.xhscdn.com/liveimg1',
    'https://sns-na-i4.xhscdn.com/liveimg2',
  ]);
  assert.deepEqual(p.l, [
    'https://sns-bak-v1.xhscdn.com/stream/1/10/66/live1.mp4',
    '',
  ]);
  assert.equal(p.f, '作者E_123456789_实况测试');
});

test('mergeNotes: live 映射按图片并集合并', () => {
  const id = 'a'.repeat(24);
  const a = { id: id, imgs: ['https://x/1'], live: { 'https://x/1': 'https://l/1' }, v: '', ts: 1 };
  const b = { id: id, imgs: ['https://x/2'], live: { 'https://x/2': 'https://l/2' }, v: '', ts: 2 };
  const m = mergeNotes(a, b);
  assert.equal(m.live['https://x/1'], 'https://l/1');
  assert.equal(m.live['https://x/2'], 'https://l/2');
});

test('buildShortcutUrl: 名称与 JSON 都被 encode', () => {
  const u = buildShortcutUrl('小红书源文件', { t: 'a&b', i: ['https://x/1'] });
  assert.match(u, /^shortcuts:\/\/run-shortcut\?name=%E5%B0%8F%E7%BA%A2%E4%B9%A6%E6%BA%90%E6%96%87%E4%BB%B6&input=text&text=/);
  assert.ok(decodeURIComponent(u.split('&text=')[1]).includes('"t":"a&b"'));
});

test('parseNoteId / parseLikeBody / parseCollectBody / parseShareBody', () => {
  assert.equal(parseNoteId('x=deadbeef'), null);
  assert.equal(parseNoteId('oid=discovery.aaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseLikeBody('oid=discovery.aaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseLikeBody('{"note_id":"bbbbbbbbbbbbbbbbbbbbbbbb"}'), 'bbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(parseCollectBody('{"note_id":"aaaaaaaaaaaaaaaaaaaaaaaa"}'), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseCollectBody('{"notes_id":"bbbbbbbbbbbbbbbbbbbbbbbb"}'), 'bbbbbbbbbbbbbbbbbbbbbbbb');
  assert.deepEqual(
    parseShareBody(JSON.stringify({ shareChannel: 'COPY', shareObjectId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })),
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', channel: 'COPY' }
  );
  assert.equal(parseShareBody(JSON.stringify({ businessName: 'NOTE' })), null);
});

test('parseShareBody: 从 originalShareInfo 兜底提取 note id', () => {
  const body = JSON.stringify({
    shareChannel: 'WECHAT',
    extraInfo: {
      originalShareInfo:
        '{"content":"https://www.xiaohongshu.com/discovery/item/bbbbbbbbbbbbbbbbbbbbbbbb?xsec_token=T"}',
    },
  });
  assert.deepEqual(parseShareBody(body), { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', channel: 'WECHAT' });
});

test('18 张实况图 payload 编码后 < 12000 字符且包含全部图片', () => {
  const imgs = Array.from({ length: 18 }, (_, i) => 'https://sns-na-i2.xhscdn.com/' + 'x'.repeat(60) + i);
  const live = {};
  imgs.forEach(function (u, i) { live[u] = 'https://sns-bak-v1.xhscdn.com/' + 'y'.repeat(50) + i; });
  const note = {
    id: 'a'.repeat(24),
    title: 't',
    author: 'a',
    uid: 'u',
    share: '',
    v: '',
    imgs: imgs,
    live: live,
  };
  const payload = buildPayload(note);
  const url = buildShortcutUrl('小红书源文件', payload);
  assert.equal(payload.i.length, 18);
  assert.equal(payload.l.length, 18);
  assert.ok(url.length < 12000, 'url length ' + url.length);
});
