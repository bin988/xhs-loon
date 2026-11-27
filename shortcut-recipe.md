# 快捷指令配方：小红书源文件

Loon 通知里的 `openUrl` 会这样调用快捷指令：

```
shortcuts://run-shortcut?name=小红书源文件&input=text&text=<payload>
```

`<payload>` 是 URL 编码后的 JSON，键固定为：

| 键 | 含义 |
|---|---|
| `t` | 标题 |
| `a` | 作者昵称 |
| `f` | 文件名基名，`作者_小红书号_标题`（已清洗非法字符，最多 80 字） |
| `i` | 图片 URL 数组 |
| `l` | 实况视频 URL 数组，与 `i` 一一对应；非实况位置为空串 |
| `v` | 笔记视频 URL（最高清备份链，https；没有则空字符串） |
| `s` | 分享长链 |
| `id` | note_id |

## 建快捷指令

在「快捷指令」App 新建一个快捷指令，**名称必须完全等于 `小红书源文件`**。
动作名称在不同系统语言下可能略有差异，括号里给英文名方便查找。

1. 不需要额外加“接收输入”动作；从 URL 运行时，快捷指令输入就是那段 JSON 文本。
2. **从输入获取词典**（Get Dictionary from Input）
3. **获取词典值**（Get Dictionary Value）：键填 `f` → 文件名基名
4. **获取词典值**（Get Dictionary Value）：键填 `i` → 图片数组
5. **获取词典值**（Get Dictionary Value）：键填 `l` → 实况视频数组（与 `i` 对齐）
6. **对每个项目重复**（Repeat with Each），输入选 `i`：
   1. **获取 URL 内容**（Get Contents of URL）：URL 选「重复项目」，方法 GET
   2. **设定名称**（Set Name）：`f` + `_` + **重复索引**（Repeat Index）+ `.jpg`
   3. **存储到照片相簿**（Save to Photo Album）：相簿「小红书」
   4. **从列表获取项目**（Get Item from List）：输入选 `l`，位置选 **Item At Index**，索引用 **重复索引**
   5. **如果**（If）上一步 **有任何值**：
      1. **获取 URL 内容**（Get Contents of URL）：URL 选上一步的实况 URL
      2. **设定名称**（Set Name）：`f` + `_` + 重复索引 + `_live.mp4`
      3. **存储到照片相簿**（Save to Photo Album）：相簿「小红书」
7. **获取词典值**（Get Dictionary Value）：键填 `v` → 笔记视频 URL
8. **如果**（If）`v` **有任何值**：
   1. **获取 URL 内容**（Get Contents of URL）：URL 选 `v`
   2. **设定名称**（Set Name）：`f` + `_video.mp4`
      - 4K 视频常用 fMP4（`.m4s`），不改成 `.mp4` 时「照片」可能不认它是视频
   3. **存储到照片相簿**（Save to Photo Album）：相簿「小红书」
9. **显示通知**（Show Notification）：`已保存到相册「小红书」`
10. 在快捷指令详情里确认允许访问网络（第一次运行会弹权限，选择允许）。

保存后可以先用一段假 JSON 手动测试：

```
{"t":"测试","a":"作者","f":"作者_123_测试","i":[""],"l":[""],"v":"","s":"","id":"aaaaaaaaaaaaaaaaaaaaaaaa"}
```

## 零点击自动化（iOS 27）

快捷指令的输入既可以是 Loon 通知 `openUrl` 里的完整 JSON，也可以是「收到通知」自动化传入的
通知正文（最小 JSON，只有 `f/i/l/v`）。两者的解析方式完全相同，不用改动作。

自动化设置见 README 的「零点击（iOS 27 自动化）」一节。

## 实况照片

小红书实况图的 `live_photo.media.stream` 里有一段短视频。Loon 会把每张图的实况视频放进
`i[].l`，快捷指令会把图片和 `_live.mp4` 分别存进相册。

> 注意：这是**图片 + 单独的视频**，不是重新合成的 Live Photo。iOS 快捷指令没有可靠的
> “图片+视频合成 Live Photo”内置动作；如果你需要真正的实况格式，得用第三方 App 再合成。

## 文件名

- 图片：`作者_小红书号_标题_1.jpg`
- 实况视频：`作者_小红书号_标题_1_live.mp4`
- 笔记视频：`作者_小红书号_标题_video.mp4`

相册界面不显示文件名，但导出/隔空投送时会使用设定名。如果要在「文件」App 里直接看到
有名字的文件，可以在每个「存储到照片相簿」前再加一个「存储文件」动作。

## 兜底：用剪贴板输入

新版 Loon 支持在点击通知时把同一份 JSON 写入剪贴板（官方 `attach.clipboard`）。
如果你的 Loon 版本支持，且 `shortcuts://` 没被拉起，可以手动运行一个
`input=clipboard` 版本的快捷指令：把第 2 步换成 **获取剪贴板**（Get Clipboard），
其余动作相同。

若你的 Loon 版本不支持 `clipboard`，这一兜底不可用，请优先检查快捷指令名
是否完全一致、以及快捷指令是否有网络权限。

## 注意

- 相簿「小红书」不存在时，先手动建一个，或在「存储到照片相簿」里新建。
- 视频是 HEVC（h265）/H.264 的 MP4，iOS 照片可直接播放和保存。
