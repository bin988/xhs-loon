# xhs-loon

在 iPhone 小红书 App 里**点赞**、**收藏**或**复制链接分享**时，经 Loon 通知唤起快捷指令，
把当前笔记的**原始图片**和**最高清、无水印的视频**保存到相册「小红书」。

## 它怎么工作

```
小红书 App
  │ 点赞 / 收藏 / 分享
  ▼
Loon（MITM edith.xiaohongshu.com + rec.xiaohongshu.com）
  │ 1. 从 imagefeed / videofeed / detailfeed-preload / homefeed 响应里缓存笔记
  │ 2. like / collect / share-content 命中 → 按 note_id 取出媒体地址
  ▼
Loon 通知：小红书 · 源文件
  openUrl = shortcuts://run-shortcut?name=小红书源文件&input=text&text=<payload>
  ▼
快捷指令「小红书源文件」
  逐张下载 https 原图 + 最高清视频 → 存储到照片相簿「小红书」
```

- **原图**：`images_list[].original` 去掉 query 的裸链（实测就是原始 JPEG，不是 webp 压缩版）。
- **实况照片**：`images_list[].live_photo.media.stream` 里的短视频也会一起下载，存成
  `<文件名>_live.mp4`（图片和视频分开，不重新合成 Live Photo）。
- **视频**：`video_info_v2.media.stream` 里最高分辨率的 h264/h265 码流，优先 `backup_urls[0]`
  （无签名、不过期、实测无水印）。有 h264/h265 时不选 h266(VVC)，避免 iOS 播不了。
- **文件名**：`作者_小红书号_标题_序号.jpg` / `..._live.mp4` / `..._video.mp4`。相册不显示
  文件名，但导出/隔空投送会使用它；要在「文件」App 里直接看到，可再加「存储文件」动作。
- **全程本地**：没有服务器、没有上传、不碰 cookie；媒体由快捷指令直接从小红书 CDN 下载。

## 安装

1. **确认 Loon 的 MITM 证书已信任**（Loon → 配置 → MITM → 安装/信任证书）。
2. **添加插件**：Loon → 插件 → 添加 → 从 URL 添加：

   ```
   https://raw.githubusercontent.com/bin988/xhs-loon/main/xhs.plugin
   ```

   启用插件。插件的 `[Mitm]` 会声明 `edith.xiaohongshu.com`、`rec.xiaohongshu.com`，
   Loon 会自动把它合并到当前 MITM 主机列表，不会覆盖你已有的配置。
3. **建快捷指令**：按 [shortcut-recipe.md](shortcut-recipe.md) 建一个名为
   **`小红书源文件`** 的快捷指令（名称必须完全一致）。
4. **测试**：打开一篇图文笔记 → 点赞 → 通知出现 → 点击 → 相册「小红书」里出现原图。

## 零点击（iOS 27 自动化）

iOS 27 的快捷指令新增了「收到通知」触发器，可以让快捷指令在**后台自动运行**，不用点通知：

1. 快捷指令 → 自动化 → + → **收到通知** → App 选 **Loon**
2. 添加筛选：**标题** 包含 `小红书`（如果标题筛选不生效，改用 **正文** 包含 `"f":`）
3. 动作选 **运行快捷指令** → `小红书源文件`，输入选触发器的 **通知正文（Body）**
4. 关闭「运行前询问」和「运行时通知」，打开 **锁定时允许运行**
5. 设置 → 通知 → Loon → **安静传送**（避免通知正文里的 JSON 弹出来）

Loon 通知的正文现在就是一份最小 JSON（`f/i/l/v`），快捷指令两种入口都能解析：

- 点通知：`openUrl` 里的完整 JSON
- 自动化：通知正文里的最小 JSON

如果 iOS 27 当前版本无法读取通知正文，自动化会拿不到 payload；这种情况只能退回点通知，或者加一个极小的服务器做中转。

## 更新

- 插件和 JS 都从 GitHub 读取。发新版时仓库会同时改插件里的 `?v=20261131` 和 `#!date`。
- 更新方法：Loon → 插件 → 找到本插件 → **更新**。脚本 URL 带了版本号，会强制拉新脚本。
- 快捷指令没有可订阅的更新地址，需要手动改；它的动作很少，基本不用动。

## 排查

| 现象 | 检查 |
|---|---|
| 点赞/收藏后没有通知 | 插件是否启用；MITM 是否包含 `edith.xiaohongshu.com` 和 `rec.xiaohongshu.com`；Loon 证书是否信任；是否先打开过这篇笔记（需要 feed 缓存） |
| 点通知没反应 | 快捷指令名是否完全等于 `小红书源文件`；先手动运行一次并允许网络权限。剪贴板兜底依赖较新的 Loon 版本对 `attach.clipboard` 的支持（官方 Script API 已列该字段）；若你的版本不支持，剪贴板会是空的 |
| 快捷指令报无法下载 | 检查网络；图片裸链和视频备份链本身不过期，通常是 DNS/代理把 `xhscdn.com` 拦了；可临时把 `xhscdn.com` 设为直连或换节点 |
| 拉不到插件/脚本 | `raw.githubusercontent.com` 可能被墙；给该域名配代理规则，或把插件里的脚本 URL 换成可达镜像后重新导入 |
| 同一篇笔记第二次点赞没通知 | 12 小时内按 note_id 去重，属于预期行为 |
| 相册里没有「小红书」 | 在「存储到照片相簿」动作里新建该相簿 |

## 隐私

- 不做任何上传，不需要服务器、账号或 cookie。
- 插件只读取小红书 API 响应，`$done({})` 原样放行，不改请求/响应。
- 仓库里只有代码和合成测试数据，没有真实抓包、token 或用户信息。

## 已知限制

- 默认要点一下通知才会跑快捷指令；iOS 27 可用「收到通知」自动化在后台跑（见上）。
- 仅支持 iOS + Loon；不支持 Android / Surge / Quantumult X。
- 实况照片会保存为“图片 + 单独 `_live.mp4`”，不重新合成 Live Photo（Shortcuts 没有可靠的合成动作）。
- 相册界面不显示文件名；文件名会用于导出/隔空投送。
- 点赞/收藏/分享的笔记需要先在当前会话里打开过（feed 响应已被缓存）；如果触发早于缓存，
  会等 feed 到达后自动补发一次。

## 开发

```bash
npm test          # Node 24 内置 test runner，纯函数 + Loon vm 模拟 + 插件静态校验
```

文件：

- `xhs.js` — Loon 本地/远程脚本，纯函数 + 运行时胶水
- `xhs.plugin` — Loon 插件规则与 MITM
- `shortcut-recipe.md` — 快捷指令动作清单
