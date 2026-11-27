'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'xhs.plugin');
const SCRIPT_URL = 'https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.js?v=20261127';

test('头部与 MITM', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  assert.match(text, /^#!name\s*=/m);
  assert.match(text, /^\[Mitm\]/mi);
  assert.match(text, /hostname\s*=\s*%APPEND%\s*edith\.xiaohongshu\.com,\s*rec\.xiaohongshu\.com/);
});

test('8 条脚本规则且 URL 带版本号', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  const lines = text.split('\n').filter(function (l) { return /^https?-(request|response)\s/.test(l); });
  assert.equal(lines.length, 8);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    assert.ok(l.includes('script-path=' + SCRIPT_URL), 'script-path: ' + l);
    assert.match(l, /requires-body=true/);
    assert.match(l, /tag=[^,]+/);
    assert.match(l, /timeout=10/);
  }
});

test('规则覆盖 4 个缓存接口 + 3 个触发接口（like 双规则）', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  for (const p of ['note\\/imagefeed', 'note\\/videofeed', 'note\\/detailfeed\\/preload', 'homefeed']) {
    assert.match(text, new RegExp('http-response .*' + p), p);
  }
  assert.match(text, /^http-request .*note\/like/m);
  assert.match(text, /^http-response .*note\/like/m);
  assert.match(text, /^http-request .*note\/collect/m);
  assert.match(text, /^http-request .*share\/content/m);
});

test('公库不含真实 token', () => {
  const text = fs.readFileSync(FILE, 'utf8');
  assert.ok(!/xsec_token=[A-Za-z0-9+/=]{20,}/.test(text));
});
