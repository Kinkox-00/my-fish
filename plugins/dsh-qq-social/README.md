# dsh-qq-social

给 Amiko 的 QQ 社交工具。复用 dsh-qq-bridge 的 NapCat HTTP 配置。

- qq_social_status：查看配额与连接状态
- qq_set_avatar：换 QQ 头像
- qq_post_qzone：发 QQ 空间说说
- qq_delete_qzone_post：删除自己刚发的说说

默认每天最多换 1 次头像、发 1 条说说；默认好友可见。图片只允许来自常用个人目录、临时目录、ase64:// 或 data:image/；远程 URL 默认禁用。
