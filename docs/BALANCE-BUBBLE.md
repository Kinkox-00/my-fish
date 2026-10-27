# 桌宠余额气泡（无常驻 bar）

目标：让 `dsh-pet-indesktop` 能显示 DSH 账户余额，但不出现顶部灵动岛 bar。

## 结构

1. `integrations/balance_bridge.py` 在本机 `127.0.0.1:8765` 提供 `GET /user/balance`。
2. 它从 `~/.dsh/.credentials.yaml` 读取 DSH 的 `deepseek-account-platform/default` token，查询 `https://platform.deepseek.com/api/v0/users/get_user_summary`。
3. 桌宠的 chat provider 指向本地桥，余额查询使用本地桥；`dynamic_island.enabled=false`，所以不绘制顶部 bar。
4. `feature_activation` 仍保留 `dynamic_island`，只让右键菜单里的「DeepSeek 余额」入口可用。

## 隐私

- 桥只监听 `127.0.0.1`，不对外网开放。
- 不把 token 写进日志或仓库。
- 余额只在本机内存/桌宠缓存中短暂出现。

## 启动

`D:\DSH\pets\start-balance-bridge.vbs` 可通过启动文件夹开机静默拉起。
