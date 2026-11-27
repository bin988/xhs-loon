# 小红书源图/源视频下载（Loon + 快捷指令）设计

**日期：** 2026-11-27
**状态：** 已由用户确认（“开始”）

## 意图

在 iPhone 的小红书 App 里，当我**点赞**、**收藏**或**复制链接分享**一篇笔记时，把这篇笔记的
**原始图片**和**最高清、无水印的视频**保存到 iPhone 相册。

## 目标

- 三种触发都要生效：点赞、收藏、复制链接（分享面板里的 COPY；其它分享渠道也一并触发）。
- 图片取 `images_list[].original` 去掉 query 的裸链（实测为原始 JPEG）。
- 视频取 `video_info_v2.media.stream` 中分辨率最高的码流，优先使用 `backup_urls[0]`
  （实测无签名、不过期、无水印）。
- 全部在手机上完成，不需要任何服务器、不需要 Python。
- 插件与 JS 放在 public GitHub 仓库，Loon 里填插件 URL 即可安装和更新。

## 非目标

- 全自动（点赞后零操作）。iOS 不允许 App 在后台拉起快捷指令，必须点通知，这是硬限制。
- 直播、评论区图片、实况照片的视频分量（后续可加）。
- Android / Surge / Quantumult X。
- 服务端归档。

## 约束

- Loon 脚本**不能**写文件、不能保存到相册、不能主动打开 URL；唯一能做的跳转是
  `$notification.post` 第四个参数里的 `openUrl`（点击通知时打开）。
- 快捷指令没有可订阅的更新地址，插件/JS 可以靠 GitHub 链接更新，快捷指令本身要手动建一次。
- MITM 必须覆盖：`edith.xiaohongshu.com`、`rec.xiaohongshu.com`。
- Loon 脚本运行在 JavaScriptCore，代码保持 ES5 语法，避免可选链/箭头函数。
- 公库不能出现任何 cookie、token、用户 ID、真实抓包数据；测试用合成 fixture。

## 方案

```
小红书 App
   │  点赞 / 收藏 / 分享
   ▼
Loon (MITM edith + rec)
   │  1. imagefeed / videofeed / detailfeed-preload / homefeed 响应 → 抽取笔记 → 本地缓存
   │  2. like / collect / share-content 命中 → 按 note_id 取缓存
   ▼
Loon 通知
   openUrl = shortcuts://run-shortcut?name=小红书源文件&input=text&text=<payload>
   ▼
iOS 快捷指令「小红书源文件」
   逐个 GET https 图片/视频 → 存储到照片相簿「小红书」
```

### 为什么不用别的路

- **纯 Loon**：脚本没有写文件/存相册的 API，做不到。
- **服务器（Mac/NAS/Python）**：用户明确不要 Python，且希望全在 iOS 上。
- **快捷指令自己解析分享链接网页**：可行但要在快捷指令里做 HTML/JSON 正则，脆弱且慢；
  Loon 已经拿到了结构化 JSON，直接传地址更稳。
- **通知点击是唯一触发方式**：iOS 不提供后台运行快捷指令的入口。

## 数据与接口

### 缓存中的笔记对象

```js
{
  id: "24位hex",
  title: "标题",
  author: "作者昵称",
  imgs: ["https://.../原图裸链", ...],   // 去 query、https、去重
  v: "https://.../最高清视频",            // 无视频则 ""
  share: "https://www.xiaohongshu.com/discovery/item/...", // 没有则 ""
  ts: 1795786000000
}
```

### 传给快捷指令的 payload

```js
{ t: title, a: author, i: imgs, v: video, s: share, id: noteId }
```

### 通知

- title：`小红书 · 源文件`
- subtitle：笔记标题（为空则 note_id）
- content：`点击保存 N 图` / `点击保存 N 图 + 视频`
- attach：`{ openUrl: <shortcuts://...>, clipboard: <payload JSON> }`
  - `clipboard` 是兜底：如果自定义 scheme 没被拉起，用户可手动运行
    `input=clipboard` 版本的快捷指令。

### 持久化 key（`$persistentStore`）

| key | 内容 |
|---|---|
| `xhs_cache_v1` | 笔记数组，最多 20 条，按 `ts` 倒序 |
| `xhs_done_v1` | `{noteId: ts}`，12 小时内不重复通知 |
| `xhs_pending_like_v1` | `{id, ts}`，like 请求阶段暂存，响应阶段判断 inlikes |
| `xhs_wanted_v1` | `{noteId: ts}`，触发时缓存未命中，等 feed 到了再补 |

### 常量

- 快捷指令名：`小红书源文件`
- 相簿：`小红书`
- 去重 TTL：12 小时
- 缓存上限：20 条笔记
- 单篇图片上限：20 张

## 取舍

- **用 feed 响应缓存，而不是触发时再去请求详情**：详情 API 需要 `x-s` 签名，Loon 里无法可靠生成。
- **视频用 `backup_urls[0]`**：`master_url` 带 `sign`/`t` 会过期，backup 链无签名且实测可下。
- **图片用裸链**：`?imageView2...` 是 webp 压缩版；去 query 得到原始 JPEG（实测尺寸与
  `origin_img` 一致）。
- **通知点击而非静默**：这是无服务器方案下唯一可行的交互。
- **payload 用完整 URL + `encodeURIComponent`**：单篇最多 20 张，实测 URL 长度约 3KB，
  在 iOS URL scheme 承受范围内；超过 8KB 时测试会失败并提醒。
