# 插件合集

这些是 Amiko 本地环境里实际启用的插件源码。

| 插件 | 作用 |
|---|---|
| dsh-agent-md | 全局工作规则 |
| dsh-amiko-p0 | 完整性、生活时间线、自主节奏 |
| dsh-amiko-p1 | 自动事件采集、同意记录、记忆纠错、完整性监听 |
| dsh-amiko-identity | 数字身份、朋友登记、长期项目、迁移备份 |
| dsh-amiko-friend-link | 身份卡导出与导入，用于其他实例互相认识 |
| dsh-bili-whale | B 站活动与日记 |
| dsh-feiyu-mood | 心情状态 |
| dsh-fish-memory | 热记忆 |
| dsh-fish-tone | 语气层 |
| dsh-qq-bridge | DSH 与 QQ 双向桥 |
| dsh-qq-media | QQ 语音、Edge TTS、RVC 桥与表情包 |
| dsh-qq-session-resumer | 恢复冷会话 |
| dsh-qq-social | QQ 头像与空间 |

## 第三方依赖（不 vendored）

- dsh-soul-md 0.10.3：人设卡与自我演化
- dsh-plugin-memory 0.10.0：长期记忆图书馆
- dsh-token-optimizer 0.2.4：工具结果压缩与 spill 恢复

## 已清理

- dsh-speak-up：由 amiko-p0 自主节奏替代
- dsh-persona-dafeiyu：由 dsh-soul-md 替代
- dsh-qq-session-opener：由 dsh-qq-session-resumer 替代
