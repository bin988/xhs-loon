# 快捷指令配方：小红书源文件

Loon 通知里的 `openUrl` 会这样调用快捷指令：

```
shortcuts://run-shortcut?name=小红书源文件&input=text&text=<payload>
```

`<payload>` 是 URL 编码后的 JSON，键固定为：

| 键 | 含义 |
|---|---|
| `t` | 标题 |
| `a` | 作者 |
| `i` | 图片 URL 数组（原始 JPEG，https） |
| `v` | 视频 URL（最高清备份链，https；没有则空字符串） |
| `s` | 分享长链 |
| `id` | note_id |

## 建快捷指令

在「快捷指令」App 新建一个快捷指令，**名称必须完全等于 `小红书源文件`**。
动作名称在不同系统语言下可能略有差异，括号里给英文名方便查找。

1. 不需要额外加“接收输入”动作；从 URL 运行时，快捷指令输入就是那段 JSON 文本。
2. **从输入获取词典**（Get Dictionary from Input）
3. **获取词典值**（Get Dictionary Value）：键填 `i`，得到图片列表
4. **对每个项目重复**（Repeat with Each）：
   1. **获取 URL 内容**（Get Contents of URL）：URL 选「重复项目」，方法 GET
   2. **存储到照片相簿**（Save to Photo Album）：相簿选/新建「小红书」
5. **获取词典值**（Get Dictionary Value）：键填 `v`，得到视频 URL
6. **如果**（If）`视频` **有任何值**：
   1. **获取 URL 内容**（Get Contents of URL）：URL 选 `视频`
   2. **设定名称**（Set Name）：改成 `video.mp4`
      - 4K 视频常用 fMP4（`.m4s`），不改成 `.mp4` 时「照片」可能不认它是视频
   3. **存储到照片相簿**（Save to Photo Album）：相簿「小红书」
7. **显示通知**（Show Notification）：`已保存：` + `t`
8. 在快捷指令详情里确认允许访问网络（第一次运行会弹权限，选择允许）。

保存后可以先用一段假 JSON 手动测试：

```
{"t":"测试","a":"作者","i":[],"v":"","s":"","id":"aaaaaaaaaaaaaaaaaaaaaaaa"}
```

## 兜底：用剪贴板输入

Loon 的通知同时把同一份 JSON 写进了剪贴板。如果 `shortcuts://` 没被拉起，
可以复制通知里的内容后手动运行一个 `input=clipboard` 版本的快捷指令：
把第 2 步换成 **获取剪贴板**（Get Clipboard），其余动作相同。

## 注意

- 相簿「小红书」不存在时，先手动建一个，或在「存储到照片相簿」里新建。
- 视频是 HEVC（h265）/H.264 的 MP4，iOS 照片可直接播放和保存。
- 实况照片（Live Photo）暂不支持，会把封面当普通图片保存。
