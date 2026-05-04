# First Run Checklist

用于首次公开发布前的最终检查。

## 1. 安装与启动
- Windows/macOS/Linux 安装包可安装。
- 首次启动无崩溃，无关键报错。

## 2. 连接与会话
- 新建连接、编辑连接、删除连接正常。
- SSH 会话可连接、重连、断线提示正常。
- 多标签与分屏行为稳定。

## 3. 文件传输
- SFTP 双栏浏览正常。
- 拖拽上传成功，进度与状态显示正确。
- 下载、重命名、删除、新建目录正常。
- 打包传输（如启用）可用。

## 4. 系统监控
- uptime/load/cpu/memory/network 3 秒内出首屏。
- 磁盘与多网卡数据展示正确。
- 进程与连接状态列表可刷新。

## 5. 命令效率
- 命令历史检索与回填可用。
- 系统识别（Ubuntu/CentOS）与命令差异提示可用。
- 终端取词填充可把选中内容插入光标处。

## 6. 视觉与可读性
- 终端背景自定义可用。
- 字体与配色可调且重启后保留。
- 低对比提示与一键增强可用。

## 7. 安全与日志
- 凭据不明文落盘。
- 指纹变化触发阻断与风险提示。
- 错误日志含 requestId。

## 8. 部署与回滚
- Docker Compose 自部署流程可跑通。
- 升级、回滚、备份恢复流程可执行。

## 9. 发布材料
- Release Notes 已准备。
- 已知问题列表已附带。
- 文档入口与版本说明已同步。


## 10. Update & Redeploy Readiness
- Client update center page can check/download/install/restart successfully.
- Signature/checksum verification failure blocks install with clear warning.
- Docker redeploy path (`pull` + `up -d`) is executable and recorded.
- Rollback drill to previous stable image tag has passed.
- DB restore drill (if schema change involved) has passed.
