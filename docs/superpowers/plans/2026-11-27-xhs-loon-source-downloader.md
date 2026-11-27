# 小红书源图/源视频下载（Loon + 快捷指令）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iPhone 小红书 App 点赞/收藏/复制链接时，经 Loon 通知唤起快捷指令，把该笔记的原始图片和最高清无水印视频存进相册「小红书」。

**Architecture:** Loon 插件 MITM `edith.xiaohongshu.com` 与 `rec.xiaohongshu.com`，把 feed 响应里的笔记媒体地址缓存到 `$persistentStore`；like/collect/share 命中时按 note_id 取出媒体地址，弹一条带 `shortcuts://run-shortcut?...` 通知；快捷指令下载 HTTPS 媒体并保存到相册。无服务器。

**Tech Stack:** Loon 插件（legacy `[Script]` 语法）、JavaScriptCore ES5、Node 24 内置 `node:test` + `vm` 模拟 Loon、iOS 快捷指令、GitHub raw 托管。

**Spec:** `docs/superpowers/specs/2026-11-27-xhs-loon-source-downloader-design.md`

## Global Constraints

- 仓库：public `bin988/xhs-loon`，默认分支 `main`。
- 插件脚本地址：`https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.js?v=20261127`（每次发版改 `?v=YYYYMMDD`，同时改插件 `#!date`）。
- 快捷指令名固定：`小红书源文件`；相簿固定：`小红书`。
- MITM：`edith.xiaohongshu.com, rec.xiaohongshu.com`。
- 所有媒体 URL 传给快捷指令前必须是 `https://`；图片去 query；视频优先 `backup_urls[0]`。
- 脚本只用 ES5：`var` + `function`，不用箭头函数、模板字符串、可选链、`let/const`。
- 公库禁止出现 cookie、token、真实用户 ID、真实抓包内容；fixture 全部合成。
- 持久化 key：`xhs_cache_v1`、`xhs_done_v1`、`xhs_pending_like_v1`、`xhs_wanted_v1`。
- 去重 TTL 12 小时；缓存上限 20 条；单篇图片上限 20 张。
- 通知 attach 同时带 `openUrl` 与 `clipboard`（兜底）。

## Review Focus

- 18 张图的笔记：payload 编码后 URL 长度必须 < 8000，且包含全部图片（Task 1/2 测试）。
- 取消赞（`inlikes:false`）：不能弹通知（Task 2）。
- 分享面板打开但没有 `shareChannel`：不能触发（Task 2）。
- 触发早于 feed 缓存：不能误弹；feed 到达后补发一次（Task 2）。
- 视频笔记：必须选 4K/最高分辨率，且用 `backup_urls[0]`，不能选 720p/master（Task 1/2）。
- 同一笔记 12 小时内多次点赞/收藏/分享：只弹一次（Task 2）。
- 缓存无限增长：超过 20 条要淘汰最旧（Task 1）。
- 视频笔记的封面图：应作为图片一并保存，不能因为“有视频”就丢掉（Task 1/2）。
- raw.githubusercontent.com 被墙时插件/脚本拉不到：README 必须给出排查与镜像办法（Task 4）。

---

### Task 1: 项目骨架 + 纯函数提取器

**Files:**
- Create: `package.json`
- Create: `xhs.js`
- Create: `test/xhs.test.js`
- Create: `test/fixtures/imagefeed.json`
- Create: `test/fixtures/videofeed.json`
- Create: `test/fixtures/homefeed.json`

**Interfaces:**
- Produces:
  - `isNoteId(s: any) -> boolean`
  - `imageUrl(item: object) -> string|null`（https、去 query）
  - `pickVideoUrl(streamItem: object) -> string|null`（优先 `backup_urls[0]`，否则 `master_url`，统一 https）
  - `bestVideo(stream: object) -> {url,w,h,px,br,codec,size}|null`
  - `parseNote(obj: object) -> note|null`；note = `{id,title,author,imgs:string[],v:string,share:string,ts:number}`
  - `extractNotes(json: any) -> note[]`（递归遍历，按 id 合并去重）
  - `mergeCache(cache: note[], notes: note[], now: number, cap: number) -> note[]`
  - `buildPayload(note: note) -> {t,a,i,v,s,id}`
  - `buildShortcutUrl(name: string, payload: object) -> string`
  - `parseNoteId(text: any) -> string|null`
  - `parseLikeBody(body: any) -> string|null`
  - `parseCollectBody(body: any) -> string|null`
  - `parseShareBody(body: any) -> {id:string, channel:string}|null`
- 文件末尾导出：`if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }`
- Loon 入口守卫：`if (typeof $request !== 'undefined' || typeof $response !== 'undefined') { main(); }`

- [ ] **Step 1: 写 fixture 与 package.json**

`package.json`：

```json
{ "name": "xhs-loon", "private": true, "scripts": { "test": "node --test" } }
```

`test/fixtures/imagefeed.json`：一篇 2 图笔记，`id` 用 `aaaaaaaaaaaaaaaaaaaaaaaa`，两张图 `original` 分别为
`https://sns-na-i2.xhscdn.com/img1?imageView2/2/w/5000/format/webp` 与 `.../img2?...`，
`share_info.link` 带假 `xsec_token=TEST`。

`test/fixtures/videofeed.json`：一篇视频笔记，`id` 用 `bbbbbbbbbbbbbbbbbbbbbbbb`，带 1 张封面
`images_list[0].original`，`video_info_v2.media.stream.h264[0]` 为 720×1280 + backup 链，
`h265[0]` 为 2160×3840 + `backup_urls:["http://sns-bak-v1.xhscdn.com/4k.mp4"]` + master 带 `?sign=`。

`test/fixtures/homefeed.json`：`{"data":{"items":[{"note_card":{...同 imagefeed 的 note...}}]}}`，
用于验证递归遍历。

- [ ] **Step 2: 写失败测试 `test/xhs.test.js`**

必须包含这些断言（名称即测试名）：

```js
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
});

test('extractNotes: 视频选 4K backup，封面保留', () => {
  const n = extractNotes(fixture('videofeed.json'))[0];
  assert.equal(n.v, 'https://sns-bak-v1.xhscdn.com/4k.mp4');
  assert.equal(n.imgs.length, 1);
});

test('extractNotes: homefeed 嵌套 note_card 也能找到', () => {
  assert.equal(extractNotes(fixture('homefeed.json'))[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
});

test('bestVideo: 分辨率优先，其次 h264 优先，不选 h266', () => {
  const v = bestVideo({
    h264: [{ width: 720, height: 1280, avg_bitrate: 9e9, video_codec: 'h264', master_url: 'https://a/720.mp4' }],
    h265: [{ width: 2160, height: 3840, avg_bitrate: 1, video_codec: 'hevc', master_url: 'https://a/4k.mp4' }],
    h266: [{ width: 2160, height: 3840, avg_bitrate: 1, video_codec: 'vvc', master_url: 'https://a/4k-vvc.mp4' }],
  });
  assert.equal(v.url, 'https://a/4k.mp4');
});

test('mergeCache: 按 id 去重并按 ts 倒序截断到 cap', () => { /* 3 条 -> cap 2，最旧被淘汰 */ });

test('buildShortcutUrl: 名称与 JSON 都被 encode', () => {
  const u = buildShortcutUrl('小红书源文件', { t: 'a&b', i: ['https://x/1'] });
  assert.match(u, /^shortcuts:\/\/run-shortcut\?name=%E5%B0%8F%E7%BA%A2%E4%B9%A6%E6%BA%90%E6%96%87%E4%BB%B6&input=text&text=/);
  assert.ok(decodeURIComponent(u.split('&text=')[1]).includes('"t":"a&b"'));
});

test('parseLikeBody / parseCollectBody / parseShareBody', () => {
  assert.equal(parseLikeBody('oid=discovery.aaaaaaaaaaaaaaaaaaaaaaaa'), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(parseCollectBody('{"note_id":"aaaaaaaaaaaaaaaaaaaaaaaa"}'), 'aaaaaaaaaaaaaaaaaaaaaaaa');
  assert.deepEqual(parseShareBody(JSON.stringify({ shareChannel: 'COPY', shareObjectId: 'aaaaaaaaaaaaaaaaaaaaaaaa' })),
    { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', channel: 'COPY' });
  assert.equal(parseShareBody(JSON.stringify({ businessName: 'NOTE' })), null);
});

test('18 张图 payload 编码后 < 8000 字符', () => {
  const note = { id: 'a'.repeat(24), title: 't', author: 'a', share: '', v: '',
    imgs: Array.from({ length: 18 }, (_, i) => 'https://sns-na-i2.xhscdn.com/' + 'x'.repeat(60) + i) };
  assert.ok(buildShortcutUrl('小红书源文件', buildPayload(note)).length < 8000);
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `cd ~/xhs-loon && npm test`
Expected: FAIL（`xhs.js` 里函数未定义 / 文件不存在）

- [ ] **Step 4: 在 `xhs.js` 实现纯函数**

要点：
- `extractNotes` 用显式栈遍历任意 JSON；对每个 dict 调 `parseNote`；按 id 合并时保留图片并集、优先有视频的。
- `parseNote` 只在有 `images_list`/`image_list` 或 `video_info_v2.media.stream` 时成立；id 取
  `id|note_id|noteId` 且匹配 `/^[0-9a-f]{24}$/`。
- 图片候选顺序：`original` → `url_size_large` → `url_default` → `url` →
  `url_multi_level.high|medium|low`；`toHttps(bareUrl(...))`。
- 视频候选：遍历 `stream` 的每个数组；按 `width*height` 优先，其次 codec 排名 h264(3) >
  h265/hevc(2) > 其他(1)，再次 `avg_bitrate`；URL 用 `backup_urls[0]`，否则 `master_url`，统一 https。
- `imgs` 去重、最多 20；`share` 取 `share_info.link` → `qq_mini_program_info.webpage_url` →
  `mini_program_info.webpage_url`；`title`/`author` 取常见字段。
- `parseLikeBody` 先 `parseNoteId`，支持 `oid=discovery.<id>`、JSON、URL；`parseShareBody` 要求
  `shareChannel` 非空，id 取 `shareObjectId` 或从 `extraInfo.originalShareInfo.content` 正则提取。

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd ~/xhs-loon && npm test`
Expected: PASS（Task 1 全部测试）

- [ ] **Step 6: Commit**

```bash
cd ~/xhs-loon
git add package.json xhs.js test/
git commit -m "feat: xhs note media extractor"
```

---

### Task 2: Loon 运行时胶水 + vm 集成测试

**Files:**
- Modify: `xhs.js`
- Create: `test/loon.test.js`

**Interfaces:**
- Consumes: Task 1 的全部纯函数。
- Produces（Loon 全局函数）：
  - `main()`：按 `$request.url` + `typeof $response` 路由
  - `handleCache()`：解析 `$response.body`，合并 `xhs_cache_v1`，处理 `xhs_wanted_v1`
  - `handleLikeRequest()`：`parseLikeBody($request.body)` → 写 `xhs_pending_like_v1`
  - `handleLikeResponse()`：读 pending 或 `$request.body`；`$response.body.data.inlikes === true` 才触发
  - `handleCollectRequest()` / `handleShareRequest()`：直接触发
  - `trigger(note, source)`：去重、弹通知、写 done
  - `findNote(id)` / `readJSON(key, fallback)` / `writeJSON(key, value)`

- [ ] **Step 1: 写 vm 模拟器与失败测试 `test/loon.test.js`**

模拟器（`runLoon({ url, method, reqBody, respBody })`）：
- 用 `vm.runInNewContext(fs.readFileSync('xhs.js'), sandbox)`；
- sandbox 提供 `$request = {url, method, body}`、`$response = respBody === undefined ? undefined : {status:200, body: respBody}`、
  `$persistentStore` 内存实现、`$notification.post` 收集器、`$done` 收集器；不提供 `module`。

必须包含：

```js
test('imagefeed 响应写入缓存', () => {
  run({ url: 'https://edith.xiaohongshu.com/api/sns/v1/note/imagefeed?note_id=x', respBody: fixture('imagefeed.json') });
  assert.equal(JSON.parse(store['xhs_cache_v1'])[0].id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
});

test('like 请求+响应(true) 弹通知，openUrl 含原图', () => {
  run({ url: '.../note/imagefeed', respBody: fixture('imagefeed.json') });
  run({ url: '.../api/sns/v1/note/like', reqBody: 'oid=discovery.aaaaaaaaaaaaaaaaaaaaaaaa' });
  run({ url: '.../api/sns/v1/note/like', reqBody: '', respBody: '{"data":{"inlikes":true}}' });
  assert.equal(notices.length, 1);
  const url = decodeURIComponent(notices[0].attach.openUrl);
  assert.ok(url.includes('https://sns-na-i2.xhscdn.com/img1'));
  const payload = JSON.parse(notices[0].attach.clipboard);
  assert.deepEqual(payload.i, ['https://sns-na-i2.xhscdn.com/img1', 'https://sns-na-i2.xhscdn.com/img2']);
  assert.equal(payload.id, 'aaaaaaaaaaaaaaaaaaaaaaaa');
});

test('like 响应 inlikes:false 不弹', () => { /* ... */ });
test('collect 触发', () => { /* {"note_id":"aaaa..."} */ });
test('share COPY 触发；share 面板无 shareChannel 不触发', () => { /* ... */ });
test('触发早于缓存：不弹；缓存到达后补弹一次', () => { /* wanted */ });
test('12h 内重复触发只弹一次', () => { /* ... */ });
test('视频笔记 payload 含 4K backup 与封面', () => { /* ... */ });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/xhs-loon && npm test`
Expected: FAIL（`main` 未定义 / 没有写入 store）

- [ ] **Step 3: 实现胶水**

路由（严格按顺序）：
1. `isResponse && CACHE_RE.test(url)` → `handleCache()`
2. `!isResponse && LIKE_RE.test(url)` → `handleLikeRequest()`
3. `isResponse && LIKE_RE.test(url)` → `handleLikeResponse()`
4. `!isResponse && COLLECT_RE.test(url)` → `handleCollectRequest()`
5. `!isResponse && SHARE_RE.test(url)` → `handleShareRequest()`
6. 其他 → `$done({})`

`trigger(note, source)`：
- `xhs_done_v1[note.id]` 在 12h 内 → 返回 false，不弹
- payload = `buildPayload(note)`；`$notification.post('小红书 · 源文件', note.title || note.id,
  '点击保存 ' + note.imgs.length + ' 图' + (note.v ? ' + 视频' : ''),
  { openUrl: buildShortcutUrl('小红书源文件', payload), clipboard: JSON.stringify(payload) })`
- 写 `xhs_done_v1`，剪掉 7 天前的条目
- 返回 true；**不调用 `$done`**

缓存合并后：对 `xhs_wanted_v1` 里仍在缓存中的 id 调 `trigger`，成功则删 wanted。
缓存 miss 的触发：写 `xhs_wanted_v1[id]=now`，不弹通知。

`main()` 用 `try/catch` 包住全部处理，并在 `finally` 里**只调用一次** `$done({})`；各 handler 都不调用 `$done`。

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd ~/xhs-loon && npm test`
Expected: PASS（Task 1 + Task 2）

- [ ] **Step 5: Commit**

```bash
cd ~/xhs-loon
git add xhs.js test/loon.test.js
git commit -m "feat: loon handlers for like/collect/share triggers"
```

---

### Task 3: Loon 插件文件 + 静态校验

**Files:**
- Create: `xhs.plugin`
- Create: `test/plugin.test.js`

**Interfaces:**
- Consumes: 脚本 URL 约定 `https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.js?v=20261127`。
- Produces: Loon 可直接导入的 `xhs.plugin`。

- [ ] **Step 1: 写失败测试 `test/plugin.test.js`**

```js
const text = fs.readFileSync('xhs.plugin', 'utf8');
test('头部与 MITM', () => {
  assert.match(text, /^#!name\s*=/m);
  assert.match(text, /^\[Mitm\]/mi);
  assert.match(text, /hostname\s*=\s*%APPEND%\s*edith\.xiaohongshu\.com,\s*rec\.xiaohongshu\.com/);
});
test('8 条脚本规则且 URL 带版本号', () => {
  const lines = text.split('\n').filter(l => /^https?-(request|response)\s/.test(l));
  assert.equal(lines.length, 8);
  for (const l of lines) {
    assert.match(l, /script-path=https:\/\/raw\.githubusercontent\.com\/bin988\/xhs-loon\/main\/xhs\.js\?v=\d{8}/);
    assert.match(l, /requires-body=true/);
    assert.match(l, /tag=[^,]+/);
  }
});
test('like 同时有 request 与 response 规则', () => {
  assert.match(text, /^http-request .*note\/like/m);
  assert.match(text, /^http-response .*note\/like/m);
});
test('公库不含真实 token', () => {
  assert.ok(!/xsec_token=[A-Za-z0-9+/=]{20,}/.test(text));
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/xhs-loon && npm test`
Expected: FAIL（`xhs.plugin` 不存在）

- [ ] **Step 3: 写 `xhs.plugin`**

```text
#!name = 小红书源文件下载
#!desc = 点赞/收藏/复制链接后，点击通知唤起快捷指令，保存原图与最高清无水印视频
#!author = bin988
#!homepage = https://github.com/bin988/xhs-loon
#!date = 2026-11-27 22:00:00

[Script]
http-response ^https?:\/\/edith\.xiaohongshu\.com\/api\/sns\/v1\/note\/imagefeed script-path=https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.js?v=20261127, requires-body=true, timeout=10, tag=小红书-缓存图文
http-response ^https?:\/\/rec\.xiaohongshu\.com\/api\/sns\/v4\/note\/videofeed script-path=..., requires-body=true, timeout=10, tag=小红书-缓存视频
http-response ^https?:\/\/edith\.xiaohongshu\.com\/api\/sns\/v1\/note\/detailfeed\/preload script-path=..., requires-body=true, timeout=10, tag=小红书-缓存预载
http-response ^https?:\/\/rec\.xiaohongshu\.com\/api\/sns\/v6\/homefeed script-path=..., requires-body=true, timeout=10, tag=小红书-缓存首页
http-request  ^https?:\/\/edith\.xiaohongshu\.com\/api\/sns\/v1\/note\/like script-path=..., requires-body=true, timeout=10, tag=小红书-点赞请求
http-response ^https?:\/\/edith\.xiaohongshu\.com\/api\/sns\/v1\/note\/like script-path=..., requires-body=true, timeout=10, tag=小红书-点赞响应
http-request  ^https?:\/\/edith\.xiaohongshu\.com\/api\/sns\/v1\/note\/collect script-path=..., requires-body=true, timeout=10, tag=小红书-收藏
http-request  ^https?:\/\/edith\.xiaohongshu\.com\/api\/growth\/schubert\/share\/content script-path=..., requires-body=true, timeout=10, tag=小红书-分享

[Mitm]
hostname = %APPEND% edith.xiaohongshu.com, rec.xiaohongshu.com
```

（`...` 处全部替换为同一个带 `?v=20261127` 的脚本 URL。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd ~/xhs-loon && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/xhs-loon
git add xhs.plugin test/plugin.test.js
git commit -m "feat: loon plugin rules and mitm"
```

---

### Task 4: 快捷指令配方 + README

**Files:**
- Create: `shortcut-recipe.md`
- Create: `README.md`
- Create: `test/docs.test.js`

**Interfaces:**
- Consumes: payload 键 `t,a,i,v,s,id`；快捷指令名 `小红书源文件`；相簿 `小红书`。

- [ ] **Step 1: 写失败测试 `test/docs.test.js`**

```js
test('README 有安装/更新/排查/隐私', () => {
  const t = fs.readFileSync('README.md', 'utf8');
  for (const s of ['安装', '更新', '排查', '隐私', 'bin988/xhs-loon']) assert.ok(t.includes(s), s);
});
test('recipe 覆盖输入解析、循环下载、存相簿、视频分支', () => {
  const t = fs.readFileSync('shortcut-recipe.md', 'utf8');
  for (const s of ['小红书源文件', '从输入获取词典', '对每个项目重复', '获取 URL 内容',
                   '存储到照片相簿', '小红书', '如果']) assert.ok(t.includes(s), s);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/xhs-loon && npm test`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 写 `shortcut-recipe.md`**

动作清单（中文名，系统语言不同可能略有差异）：
1. （输入自动为快捷指令输入）
2. **从输入获取词典**
3. **获取词典值**：键 `i` → 图片列表
4. **对每个项目重复**：
   1. **获取 URL 内容**（URL = 重复项目，方法 GET）
   2. **存储到照片相簿**（相簿：新建/选择「小红书」）
5. **获取词典值**：键 `v` → 视频
6. **如果** `视频` 有任何值：
   1. **获取 URL 内容**（URL = 视频）
   2. **存储到照片相簿**（相簿「小红书」）
7. **显示通知**：`已保存：{t}`
8. 快捷指令命名为 **小红书源文件**（必须完全一致），并在设置里允许访问网络。

补充：手动兜底——把 Loon 通知里 `clipboard` 写入的 JSON 作为输入，用 `input=clipboard` 版本运行。

- [ ] **Step 4: 写 `README.md`**

必须包含：
- 功能与原理（一段话，含“必须点通知”的限制）。
- 安装：Loon 信任证书 → 添加插件 URL `https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.plugin` → 启用 → 按 recipe 建快捷指令。
- 更新：push 后改 `?v=` 和 `#!date` → Loon 插件页点更新；快捷指令需手动改。
- 排查：通知不弹（检查插件启用/MITM 主机）、点了没反应（快捷指令名不一致）、下载失败（raw 被墙/媒体 URL 失效）、重复（12h 去重）。
- 隐私：无服务器、无上传、无 cookie；仓库只有代码。
- 已知限制：必须点通知；不支持实况照片；仅 iOS Loon。

- [ ] **Step 5: 运行测试，确认通过**

Run: `cd ~/xhs-loon && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/xhs-loon
git add README.md shortcut-recipe.md test/docs.test.js
git commit -m "docs: install, update, shortcut recipe"
```

---

### Task 5: 发布到 GitHub 并验证链接

**Files:**
- Create: `.gitignore`
- Modify: `package.json`（`"test": "node --test"`）

- [ ] **Step 1: 初始化 git 与本地身份**

```bash
cd ~/xhs-loon
printf 'node_modules/\n.DS_Store\n' > .gitignore
git init -b main
git config user.name "bin988"
git config user.email "bin988@users.noreply.github.com"
```

- [ ] **Step 2: 提交并建 public 仓库**

```bash
git add -A
git commit -m "feat: xhs source downloader for loon + shortcuts"
gh repo create bin988/xhs-loon --public --source=. --remote=origin --push \
  --description "Loon plugin + iOS Shortcut: save Xiaohongshu source images/videos on like/collect/share"
```

Expected: 输出仓库 URL，push 成功。

- [ ] **Step 3: 验证 raw 链接**

```bash
curl -fsS https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.plugin | head -5
curl -fsS "https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.js?v=20261127" | head -5
curl -fsS https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.plugin | grep -c '^http-'
```

Expected: 前两条返回内容；计数为 `8`。

- [ ] **Step 4: 最终提交（如有改动）**

```bash
git status --short
git add -A && git commit -m "chore: publish" || true
git push
```

---

### Task 6: 手动验收（用户执行）

- [ ] Loon 添加插件 URL，启用；确认 MITM 证书已信任。
- [ ] 按 `shortcut-recipe.md` 建好名为 `小红书源文件` 的快捷指令，允许网络访问。
- [ ] 图文笔记：点赞 → 收到通知 → 点击 → 相册「小红书」出现原图（数量与笔记一致）。
- [ ] 图文笔记：收藏 → 通知 → 保存成功。
- [ ] 图文笔记：分享 → 复制链接 → 通知 → 保存成功。
- [ ] 视频笔记：点赞 → 保存的是视频（4K/最高清）+ 封面图。
- [ ] 取消赞不再弹通知。
- [ ] 同一笔记 12 小时内重复操作只弹一次。
- [ ] 把结果（成功/失败现象、Loon 脚本日志）反馈；若 `shortcuts://` 未被拉起，
      记录现象并改用 `input=clipboard` 兜底方案。
