'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'xhs.js'), 'utf8');

const ID_IMG = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_VIDEO = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const URL_CACHE_IMG = 'https://edith.xiaohongshu.com/api/sns/v1/note/imagefeed?note_id=' + ID_IMG;
const URL_CACHE_VIDEO = 'https://rec.xiaohongshu.com/api/sns/v4/note/videofeed?x=1';
const URL_LIKE = 'https://edith.xiaohongshu.com/api/sns/v1/note/like';
const URL_COLLECT = 'https://edith.xiaohongshu.com/api/sns/v1/note/collect';
const URL_UNCOLLECT = 'https://edith.xiaohongshu.com/api/sns/v1/note/uncollect';
const URL_SHARE = 'https://edith.xiaohongshu.com/api/growth/schubert/share/content';

function fixture(name) {
  return JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')));
}

function newEnv() {
  const store = Object.create(null);
  const notices = [];
  const dones = [];

  function run(entry) {
    const sandbox = {
      console: { log: function () {} },
      $persistentStore: {
        read: function (k) { return k in store ? store[k] : ''; },
        write: function (v, k) {
          if (v === null || v === undefined) delete store[k];
          else store[k] = String(v);
          return true;
        },
      },
      $notification: {
        post: function (title, subtitle, content, attach, delay) {
          notices.push({ title: title, subtitle: subtitle, content: content, attach: attach, delay: delay });
        },
      },
      $done: function (v) { dones.push(v === undefined ? {} : v); },
      $request: {
        url: entry.url,
        method: entry.method || 'GET',
        body: entry.reqBody,
        headers: entry.headers || {},
      },
    };
    if (Object.prototype.hasOwnProperty.call(entry, 'respBody')) {
      sandbox.$response = { status: 200, body: entry.respBody };
    }
    vm.runInNewContext(CODE, sandbox, { filename: 'xhs.js' });
  }

  return { store, notices, dones, run };
}

function itemNotices(env) {
  return env.notices.filter(function (n) { return n.title === '小红书 · 单张'; });
}

function summaryNotice(env) {
  return env.notices.find(function (n) { return n.title === '小红书 · 全部'; });
}

test('imagefeed 响应写入缓存', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  const cache = JSON.parse(env.store['xhs_cache_v1']);
  assert.equal(cache.length, 1);
  assert.equal(cache[0].id, ID_IMG);
  assert.equal(cache[0].imgs.length, 2);
  assert.equal(env.dones.length, 1);
});

test('like 请求+响应(true) 拆成逐项通知 + 汇总通知', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  env.run({ url: URL_LIKE, method: 'POST', reqBody: 'oid=discovery.' + ID_IMG });
  assert.equal(env.notices.length, 0, '请求阶段不能弹');
  env.run({ url: URL_LIKE, method: 'POST', reqBody: '', respBody: '{"data":{"inlikes":true}}' });

  const its = itemNotices(env);
  assert.equal(its.length, 2);
  const s = summaryNotice(env);
  assert.ok(s, '应有汇总通知');
  assert.equal(s.subtitle, '测试图文');
  assert.match(s.content, /2 图/);

  const payload = JSON.parse(s.attach.clipboard);
  assert.deepEqual(payload.i, [
    'https://sns-na-i2.xhscdn.com/img1',
    'https://sns-na-i2.xhscdn.com/img2',
  ]);
  assert.deepEqual(payload.l, ['', '']);
  assert.equal(payload.id, ID_IMG);
  assert.equal(payload.f, '作者A_123456789_测试图文');

  const i1 = JSON.parse(its[0].content);
  assert.deepEqual(i1, { f: payload.f, n: 1, u: 'https://sns-na-i2.xhscdn.com/img1', l: '', v: '' });
  assert.equal(JSON.parse(its[1].content).n, 2);
  assert.ok(decodeURIComponent(its[0].attach.openUrl).includes('name=小红书单张'));
  assert.ok(decodeURIComponent(s.attach.openUrl).includes('name=小红书源文件'));
  assert.ok(its[0].content.length < 500);
  assert.equal(env.dones.length, 3);
});

test('like 响应 inlikes:false 不弹', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  env.run({ url: URL_LIKE, method: 'POST', reqBody: 'oid=discovery.' + ID_IMG });
  env.run({ url: URL_LIKE, method: 'POST', reqBody: '', respBody: '{"data":{"inlikes":false}}' });
  assert.equal(env.notices.length, 0);
});

test('collect 触发', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: JSON.stringify({ source: 'explore_feed', note_id: ID_IMG }) });
  assert.equal(itemNotices(env).length, 2);
  assert.equal(JSON.parse(summaryNotice(env).attach.clipboard).id, ID_IMG);
});

test('share COPY 触发；share 面板无 shareChannel 不触发', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });

  env.run({ url: URL_SHARE, method: 'POST', reqBody: JSON.stringify({ businessName: 'NOTE' }) });
  assert.equal(env.notices.length, 0, '打开分享面板不应触发');

  env.run({
    url: URL_SHARE,
    method: 'POST',
    reqBody: JSON.stringify({
      shareChannel: 'COPY',
      shareObjectId: ID_IMG,
      extraInfo: { originalShareInfo: { content: 'https://www.xiaohongshu.com/discovery/item/' + ID_IMG } },
    }),
  });
  assert.equal(itemNotices(env).length, 2);
  assert.ok(summaryNotice(env));
});

test('触发早于缓存：不弹；缓存到达后补弹一次', () => {
  const env = newEnv();
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: JSON.stringify({ note_id: ID_IMG }) });
  assert.equal(env.notices.length, 0);
  assert.ok(env.store['xhs_wanted_v1'], '应记录 wanted');

  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  assert.equal(itemNotices(env).length, 2, '缓存到达后应补弹');
  assert.ok(summaryNotice(env));
});

test('12h 内重复触发只弹一次', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  const body = JSON.stringify({ note_id: ID_IMG });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: body });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: body });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: body });
  assert.equal(env.notices.length, 3, '2 个逐项 + 1 个汇总');
});

test('视频笔记 payload 含 4K backup 与封面', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_VIDEO, respBody: fixture('videofeed.json') });
  env.run({ url: URL_LIKE, method: 'POST', reqBody: 'oid=discovery.' + ID_VIDEO });
  env.run({ url: URL_LIKE, method: 'POST', reqBody: '', respBody: '{"data":{"inlikes":true}}' });

  const its = itemNotices(env);
  assert.equal(its.length, 2);
  const s = summaryNotice(env);
  const payload = JSON.parse(s.attach.clipboard);
  assert.equal(payload.v, 'https://sns-bak-v1.xhscdn.com/4k.mp4');
  assert.deepEqual(payload.i, ['https://sns-na-i2.xhscdn.com/cover']);
  assert.deepEqual(payload.l, ['']);
  assert.match(s.content, /视频/);

  const imageItem = JSON.parse(its[0].content);
  assert.equal(imageItem.u, 'https://sns-na-i2.xhscdn.com/cover');
  assert.equal(imageItem.n, 1);
  const videoItem = JSON.parse(its[1].content);
  assert.equal(videoItem.v, 'https://sns-bak-v1.xhscdn.com/4k.mp4');
  assert.equal(videoItem.u, '');
  assert.equal(videoItem.n, 0);
  assert.equal(videoItem.f, '作者B_测试视频');
});

test('实况图 payload 带上 live 视频与文件名', () => {
  const env = newEnv();
  const id = 'eeeeeeeeeeeeeeeeeeeeeeee';
  env.run({ url: 'https://edith.xiaohongshu.com/api/sns/v1/note/imagefeed?note_id=' + id, respBody: fixture('livefeed.json') });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: JSON.stringify({ note_id: id }) });
  const its = itemNotices(env);
  assert.equal(its.length, 2);
  const payload = JSON.parse(summaryNotice(env).attach.clipboard);
  assert.deepEqual(payload.l, ['https://sns-bak-v1.xhscdn.com/stream/1/10/66/live1.mp4', '']);
  assert.equal(payload.f, '作者E_123456789_实况测试');
  assert.equal(JSON.parse(its[0].content).l, 'https://sns-bak-v1.xhscdn.com/stream/1/10/66/live1.mp4');
  assert.equal(JSON.parse(its[1].content).l, '');
});

test('uncollect 与 like/page 不触发', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  env.run({ url: URL_UNCOLLECT, method: 'POST', reqBody: JSON.stringify({ notes_id: ID_IMG }) });
  env.run({ url: 'https://edith.xiaohongshu.com/api/sns/v1/note/like/page?num=30', method: 'GET' });
  assert.equal(env.notices.length, 0);
});

test('缓存 miss 写 wanted，且不弹', () => {
  const env = newEnv();
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: JSON.stringify({ note_id: ID_IMG }) });
  const wanted = JSON.parse(env.store['xhs_wanted_v1']);
  assert.ok(wanted[ID_IMG]);
  assert.equal(env.notices.length, 0);
});

test('request 脚本回传原始 body 与 Content-Type（Loon 会丢 CT）', () => {
  const env = newEnv();
  const likeBody = 'oid=discovery.' + ID_IMG;
  env.run({ url: URL_LIKE, method: 'POST', reqBody: likeBody });
  assert.equal(env.dones[0].body, likeBody);
  assert.match(env.dones[0].headers['Content-Type'], /x-www-form-urlencoded/);

  const collectBody = JSON.stringify({ note_id: ID_IMG });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: collectBody });
  assert.equal(env.dones[1].body, collectBody);
  assert.equal(env.dones[1].headers['Content-Type'], 'application/json');
});

test('request 脚本保留原有 headers，不覆盖已有 Content-Type', () => {
  const env = newEnv();
  env.run({
    url: URL_COLLECT,
    method: 'POST',
    reqBody: '{"note_id":"' + ID_IMG + '"}',
    headers: { 'content-type': 'application/json', 'X-Test': '1' },
  });
  assert.equal(env.dones[0].headers['X-Test'], '1');
  assert.equal(env.dones[0].headers['content-type'], 'application/json');
  assert.equal(env.dones[0].headers['Content-Type'], undefined);
});

test('每次运行只调用一次 $done', () => {
  const env = newEnv();
  env.run({ url: URL_CACHE_IMG, respBody: fixture('imagefeed.json') });
  env.run({ url: URL_COLLECT, method: 'POST', reqBody: JSON.stringify({ note_id: ID_IMG }) });
  env.run({ url: 'https://edith.xiaohongshu.com/api/sns/v1/note/metrics_report', method: 'POST', reqBody: '{}' });
  assert.deepEqual(env.dones.map(function () { return 1; }), [1, 1, 1]);
});
