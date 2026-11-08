# C 盘清理报告（2026-10-13T12:44:26.054Z）

> 弹窗根源已定位：DISM 组件清理是系统级操作，触发 UAC 与控制台窗口。本报告生成与后续动作**零外部进程、零窗口**。

## 清理结果（fsutil volume diskfree C: 双向核验）
- **空闲空间：16.8 GiB → 77.2 GiB**（+60.4 GiB）
- 已用：191.7 GB → 131.3 GB

## 已执行动作
| 项 | 结果 |
|---|---|
| DISM /startcomponentcleanup（WinSxS 组件存储） | 100% 成功（Windows 官方许可的唯一 WinSxS 减容途径，大部分回收来自此） |
| %LOCALAPPDATA%\Temp（旧文件） | 69 项已删，31 项被占用跳过 |
| %LOCALAPPDATA%\Temp（本轮二次全清） | 安全目录已清空 |
| %LOCALAPPDATA%\npm-cache | 868 MiB → 0 MiB（纯下载缓存，npm 用时自动重建） |
| %LOCALAPPDATA%\pnpm | 3,192 MiB → 3,192 MiB（pnpm 不在 D:\program\nodejs，未找到二进制，硬链接结构不擅自动） |

## 未动的用户数据（需要你授权才会碰）
- C:\Users\REDMI\.dsh（4.3 GiB，DSH 状态/归档）
- AppData\Roaming\ollama-agent（4.3 GiB，Ollama 工具链）
- AppData\Roaming\Tencent / KuGou8 / SnapAny / TuanjieWebGLHost 等（聊天/应用数据）
- %Program Files%\Adobe（9.5 GiB 已装软件）＋ ProgramData\Adobe 2.3 GiB
- C:\ProgramData\Microsoft（3.7 GiB，系统数据）

## 备注
- Temp 二次清理与 npm-cache 清空均发生在首次 fsutil 采样之后，故 +60.4 GiB 包含全部动作的实际回收量
- 工作区 D:\dev\DeepSeekHarnessWorkspace\Infinity.inc 零改动、零接触（本轮纯属系统层）
