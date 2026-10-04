# .itbt 工具容器格式 v1（Infinity Toolbox 插件二进制）

目的：把「一个工具（插件目录）」打包成单个 .itbt 文件，Infinity Toolbox（cpp/apps/int）可以直接列出、安装并运行，无需目录散落。

## 现状（已核实的加载契约，见 cpp/apps/int/main.cpp）
- 插件根目录：`%LOCALAPPDATA%\Infinity.Inc\plugin`（pluginRoot(), main.cpp:164-172）。
- 每个插件是一个子目录，内含 `item.json`（字段 name / version / filename，见 main.cpp:211-234）与 filename 指向的可执行文件；缺 filename 时回退取目录内第一个 exe（main.cpp:224-228）。
- `int plugin list` 读取该目录（main.cpp:636-652）；插件 present 取决于 filename 对应文件是否存在。

## 文件布局（小端）
```
offset 0      char[4]  "ITBT"          魔数
offset 4      u16      version = 1
offset 6      u16      flags            bit0=1 表示 payload 使用 deflate
offset 8      u32      headerSize       从文件头到 entry 表结束的字节数
offset 12     u32      entryCount
offset 16     u32      totalSize        整个 .itbt 文件字节数
offset 20     u16      nameLen; char name[nameLen]          插件显示名（UTF-8）
              u16      verLen;  char version[verLen]      插件版本（UTF-8）
              u16      exeLen;  char exePath[exeLen]      入口可执行文件相对路径（UTF-8，用 / 分隔）
entry 表（entryCount 条，紧接上面）：
  u16 pathLen; char path[pathLen]   相对路径（UTF-8，/ 分隔）
  u64 offset                        相对文件起始的偏移
  u64 storedSize                    该条目在文件中的字节数
  u64 rawSize                       解压/未压缩字节数
  u8  sha256[32]                    原始内容的 SHA-256
  u8  compression                   0=store, 1=deflate（raw deflate，无 zlib 头）
payload：按 entry 表顺序排列的文件内容
```

## 规则
1. 路径必须相对、不得包含 `..`、不得为绝对路径（C++ 侧与 loader 都要拒绝）。
2. 打包顺序：`item.json` 必须存在（若源目录没有，packer 依据命令行参数生成并写进容器）。
3. 校验：每条 entry 原始内容的 SHA-256 必须写入容器；loader 解包后必须逐条校验，失败即拒绝该插件并给出原因。
4. 兼容：Toolbox 同时支持旧式「目录 + item.json」插件与新版 `.itbt`；`.itbt` 首次使用时解包到 `%LOCALAPPDATA%\Infinity.Inc\plugin\<name>\`（原子写：先写 .tmp 再改名），已存在且校验通过则复用。
5. 命令面（新增）：
   - `int plugin list`：目录插件与容器插件都列出，容器插件标注来源文件名与 sha256 前 8 位。
   - `int plugin install <file.itbt>`：校验 + 解包 + 注册（重复安装同 name 时要求内容一致或覆盖并提示）。
   - `int plugin verify <name|file.itbt>`：逐条 SHA-256 校验并打印摘要。
6. packer（C++）：`cpp/tools/itbt/itbt-pack.cpp`，用法 `itbt-pack --dir <插件目录> --out <name.itbt> [--name N] [--version V] [--exe relative/path] [--deflate]`；无参数时打印用法。构建：加入 cpp/CMakeLists.txt 的 host tool 目标（MinGW g++ 可用），或提供 work/build-itbt.mjs 直接调用 g++。
7. 严谨性：所有整数按小端显式写出（不依赖结构体对齐）；解析时先读 headerSize 再读 entry 表，遇到越界/长度不符立即报错。

## 首批打包目标
- 已知真实工具：`D:\dev\DeepSeekHarnessWorkspace\fastbrowser\fastbrowser.exe`（1,727,345 B，C++ 代理/浏览器工具，来自 ITB Tools 里那份会话记录的主题）。
- `D:\dev\DeepSeekHarnessWorkspace\Infinity.inc\ITB Tools\` 目前只有 `rename to InfinityProxy/session.v4.jsonl`（6.4 MB 会话记录），没有工具二进制 —— 待用户补放后按同一流程打包。
