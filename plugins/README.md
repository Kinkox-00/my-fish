# 插件合集

这些是 Amiko 本地环境里实际启用的插件源码。

| 插件 | 作用 |
|---|---|
| dsh-agent-md | 全局工作规则 |
| dsh-amiko-p0 | 完整性、生活时间线、自主节奏 |
| dsh-amiko-p1 | 自动事件采集、同意记录、记忆纠错、完整性监听 |
| dsh-amiko-identity | 数字身份、朋友登记、长期项目、迁移备份 |
| dsh-amiko-friend-link | 身份卡导出与导入 |
| dsh-amiko-budget | 每日自主额度 ¥2 与付费动作记账 |
| dsh-bili-avatar | B 站头像更换 |
| dsh-bili-whale | B 站浏览、评论、日记 |
| dsh-feiyu-mood | 心情状态 |
| dsh-fish-memory | 热记忆 |
| dsh-fish-tone | 语气层 |
| dsh-qq-bridge | DSH 与 QQ 双向桥 |
| dsh-qq-media | QQ 语音、Edge TTS、RVC 桥与表情包 |
| dsh-qq-session-resumer | 恢复冷会话 |
| dsh-qq-social | QQ 头像与空间 |

## 第三方依赖（不 vendored）

- dsh-soul-md 0.10.3
- dsh-plugin-memory 0.10.0
- dsh-token-optimizer 0.2.4

## 已清理

- dsh-speak-up：由 amiko-p0 自主节奏替代
- dsh-persona-dafeiyu：由 dsh-soul-md 替代
- dsh-qq-session-opener：由 dsh-qq-session-resumer 替代

## 本次新增的第三方桌面/外观插件

- dsh-pet 0.3.8：DSH 页面内大肥鱼桌宠
- dsh-dafeiyu 0.1.19：原生桌面悬浮大肥鱼
- dsh-flash-presets 0.2.4：Flash 低 token 预设
- dsh-plugin-wallpaper-engine 1.4.0：Wallpaper Engine 壁纸与液态玻璃
