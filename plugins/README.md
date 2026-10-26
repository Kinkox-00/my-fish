# 插件合集

这些是 Amiko 本地环境里实际使用的自建插件源码。

| 插件 | 作用 |
|---|---|
| dsh-agent-md | 全局工作规则 |
| dsh-amiko-p0 | 完整性、生活时间线、自主节奏 |
| dsh-bili-whale | B 站活动与日记 |
| dsh-feiyu-mood | 心情状态 |
| dsh-fish-memory | 热记忆 |
| dsh-fish-tone | 语气层 |
| dsh-qq-bridge | DSH 与 QQ 双向桥 |
| dsh-qq-media | QQ 语音与表情包 |
| dsh-qq-session-opener | 打开/创建 QQ 会话 |
| dsh-qq-session-resumer | 恢复冷会话 |
| dsh-qq-social | QQ 头像与空间 |
| dsh-speak-up | 旧版主动搭话（已停用） |
| dsh-persona-dafeiyu | 旧人格层（保留作历史） |

## 第三方依赖（不 vendored）

- dsh-soul-md 0.10.3：人设卡与自我演化
- dsh-plugin-memory 0.10.0：长期记忆图书馆
- dsh-token-optimizer 0.2.4：工具结果压缩与 spill 恢复

## 安装注意

1. 先把插件放到 DSH 的 plugins 目录。
2. 在 profile 的 package.json 里加 link: 依赖。
3. 把插件名加入 dsh.profile.bundles。
4. 重启或重载 DSH。
5. 不要把任何 token、账号、私聊记录提交进仓库。
