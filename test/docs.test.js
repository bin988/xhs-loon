'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

test('README 有安装/更新/排查/隐私', () => {
  const t = read('README.md');
  for (const s of ['安装', '更新', '排查', '隐私', 'bin988/xhs-loon']) {
    assert.ok(t.includes(s), s);
  }
});

test('README 有插件 URL、脚本版本号与“必须点通知”限制', () => {
  const t = read('README.md');
  assert.ok(t.includes('https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.plugin'));
  assert.ok(t.includes('?v=20261130'));
  assert.ok(t.includes('点通知'));
  assert.ok(t.includes('12 小时'));
});

test('recipe 覆盖输入解析、循环下载、存相簿、视频分支', () => {
  const t = read('shortcut-recipe.md');
  for (const s of ['小红书源文件', '从输入获取词典', '对每个项目重复', '获取 URL 内容',
    '存储到照片相簿', '小红书', '如果']) {
    assert.ok(t.includes(s), s);
  }
});

test('recipe 视频分支先把文件改名为 video.mp4 再存相簿', () => {
  const t = read('shortcut-recipe.md');
  assert.ok(t.includes('设定名称'), 'Set Name action');
  assert.ok(t.includes('video.mp4'));
});

test('文档说明 clipboard 兜底依赖较新的 Loon 版本', () => {
  const readme = read('README.md');
  const recipe = read('shortcut-recipe.md');
  assert.ok(readme.includes('clipboard'));
  assert.ok(readme.includes('较新的 Loon') || readme.includes('Loon 版本'));
  assert.ok(recipe.includes('较新的 Loon') || recipe.includes('Loon 版本'));
});

test('recipe 明确 payload 键 t/a/i/u/l/f/v/s/id 与兜底 clipboard', () => {
  const t = read('shortcut-recipe.md');
  for (const s of ['`t`', '`i`', '`l`', '`f`', '`v`', '`s`', '`id`', 'clipboard']) {
    assert.ok(t.includes(s), s);
  }
});

test('文档覆盖实况视频与文件名规则', () => {
  const readme = read('README.md');
  const recipe = read('shortcut-recipe.md');
  for (const t of [readme, recipe]) {
    assert.ok(t.includes('实况'));
    assert.ok(t.includes('_live.mp4'));
  }
  assert.ok(readme.includes('文件名'));
  assert.ok(recipe.includes('作者_小红书号_标题'));
});
