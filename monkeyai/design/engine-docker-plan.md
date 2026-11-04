# Docker 执行层实施

目标：使用 Docker Engine + runsc 替换专用 containerd/CNI，保持后台、客户端、持久目录及生命周期协议。

- 已完成：Docker API 驱动、固定摘要镜像、CPU/内存/进程/tmpfs 约束、实例归属、镜像缓存和 standalone 执行。
- 已完成：Docker 自动分配独立 bridge 网络，自动读取宿主 DNS；保留公网出站限制，不需要 network.json、CNI 或手填地址池。
- 已完成：安装器复用已有 Docker，合并专用 runsc runtime 并热加载；无 Docker 时从 server 的静态发行组件安装；拒绝带旧实例或旧管理服务的隐式迁移。
- 已完成：预检与发行依赖适配，依赖版本更新为 v26110302；后台和 server 安装器兼容新旧组件清单。
- 已完成：文档与自动化测试；修改已归并到原工作树：MonkeyCode 的 feat-environment-client-api、MonkeyCodePro 的 feat-engine-installer-oss；安装仓库同步正常子模块引用，后续继续使用这两个原工作树。

## 验证结果

- engine 全模块测试、race、go vet、14 项依赖脚本测试通过。
- 后台全模块测试与 go vet 通过；无数据库配置时数据库集成测试按原有规则跳过。
- server installer 的 deploy 测试与 go vet、21 项 engine 发布/依赖脚本测试通过。
- Linux amd64、arm64 构建通过。v26110401 已从 OSS 下载 v26110302 依赖并完成双架构本地打包，生成 resources.tgz；尚未发布该 engine 版本。
- 在专用 ARM64 Docker-in-Docker 中，真实 Docker 29.4.3 + gVisor 的创建、启动、停止、重复删除、重建通过；项目和用户目录在实例重建后保留。
- 同一隔离测试中，fixture runtime 的状态、设备授权事件、服务执行及恢复观察通过；这不代表真实 runtime 与线上后台的端到端登录已验收。
- DNS 解析及固定公网地址的 HTTP 访问通过；宿主网关、169.254.169.254、100.100.100.200 的访问均被拒绝，并核对 nftables 丢包计数。开发机 DNS 使用 fake-IP 时公网域名会被既定规则拒绝，测试使用真实公网 IP 验证出站。

## 待发布与人工验收

- 已发布依赖 v26110302 的 amd64、arm64 包到 OSS，解决首次打包下载 404；依赖内容按锁定摘要校验。engine 仍需使用新版本发布，随后打包/更新 server；未修改线上宿主。
- 真实 systemd 宿主的全新安装、既有 Docker 热加载与故障回滚、服务/整机重启验收仍需执行。已有安装集成脚本已适配 Docker，本轮未运行该 VM 验收。
- 真实业务 runtime 登录、客户端创建环境、CPU/内存压力和 gVisor 任务上限仍需在目标宿主统一验收；本轮集成测试核对资源配置，不能替代压力验证。
- 旧 containerd 环境不自动转换；使用旧版本清理实例并卸载旧管理服务，持久目录保留后重新接入。磁盘容量管理不在本期范围。

## installer 安装与升级（代码完成）

- 已实现：将安装逻辑从 engine 移到 MonkeyCodePro 统一 installer，新增 `installer monkeyai-engine install/upgrade`，复用 Docker 下载器与进度输出。
- 已实现：发行包携带双架构 installer，后台安装／升级脚本校验后调用；提供管理员固定版本升级命令接口。
- 已实现：保留身份与配置的切换、健康心跳确认、版本上报、失败回滚及中断恢复；Docker/gVisor 依赖保持一致，不做 containerd 迁移。
- 已验证：installer 安装／升级故障注入、engine race 测试、后台完整 check（含 sqlc diff）、独立 PostgreSQL 宿主数据库测试、21 项发行脚本测试、双架构完整打包和 Linux ARM64 installer 入口执行。
- 测试说明：并行构建期间 deploy 包一个 2 秒超时用例在 race 模式超时，单独重跑常规测试通过；未修改该用例或将其视为真实升级验收。
- 待人工验收：真实 systemd 宿主安装及升级、断电恢复和真实环境任务恢复；未发布新版本或更改线上宿主。

## 主线同步

- 已 rebase MonkeyCode origin/main（ace1b923），保留主线统一 Web 错误处理与云环境路由，并接入公共错误翻译入口。
- MonkeyCodePro 已包含其 origin/main（57ded77），同步 rebase 后的 monkeycode 子模块。
- 验证：后台 make check（sqlc、全量测试、vet）、管理端生产构建、installer 相关测试通过。
- 管理端 307 项测试中 305 项通过；模型页 AlertDialog、头像选择组件原生 input 两项样式检查失败，已在 origin/main 的独立源码快照中复现，相关文件与主线一致。
