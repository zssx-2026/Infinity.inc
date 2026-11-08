# InfinityServer · 图灵完备的机架级计算架构

Electron 控制台 + 无依赖 Node 服务，把《InfinityServer：图灵完备的机架级计算架构》里的模型落成一台能跑、能看、能验的机器。

## 跑起来

```bash
node src/cli.js 7711          # 只有服务，控制台在浏览器打开 http://127.0.0.1:7711/
```

Electron 窗口（需要本地 `shell/node_modules/electron`）：

```bash
node build.mjs                # 打包到 build/win-x64
```

不联网、不下载：控制台页面与所有数据都由本机进程提供，页面里没有任何外链资源。

## 目录

```
src/core/config.js     六级缓存表、计费权重、调度水位（唯一的事实来源）
src/core/cache.js      块/层级/迁移/版本：CacheBlock 的全部语义
src/core/billing.js    Fee(R) 公式与 prev_hash + merkle_root 哈希链
src/core/schedule.js   一致性哈希环、负载感知路由、资源池伸缩
src/core/pipeline.js   七阶段流水线 P(R) 与 InfinityServer 门面
src/core/turing.js     图灵机 + simulateOnRack 嵌入 + verifyEmbedding 一致性校验
src/server.js          编排 API 与自带控制台页面（零外链）
src/main.js            Electron 外壳：起服务 → 等端口 → 开窗
src/cli.js             无窗口启动
```

## 六级缓存

| 层级 | 介质 | 延迟 | 权重 | 默认容量 |
|---|---|---|---|---|
| L1 | CPU 片内 SRAM | 1 ns | w1 | 64 KiB |
| L2 | CPU 片内 SRAM | 10 ns | w2 | 2 MiB |
| L3 | CPU 片内 SRAM | 30 ns | w4 | 384 MiB |
| L4 | DDR5 + CXL 内存池 | 200 ns | w16 | 1 TiB |
| L5 | NVMe 闪存池 | 100 µs | w64 | 1 PiB |
| L6 | SMR/ePMR 磁盘池 | 10 ms | w256 | 4 PiB |

## 计费

```
Fee(R) = BaseRate × Weight(level) × SizeFactor(|body|) × PriorityFactor(priority)
```

- BaseRate = 0.000001
- |body| ≤ 1 KiB 时 SizeFactor = 1.0，超出线性增长
- priority：high 1.5 / normal 1.0 / low 0.5

每条 `BillingEvent` 带 `prev_hash` 与 `merkle_root`，`GET /v1/verify` 会整链重算。

## 编排 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/request` | 走一遍七阶段流水线 |
| POST | `/v1/cache/hint` | 预取（概率 ≥ 0.6 才提升到 L4） |
| GET | `/v1/cache/stats` | 层级表 + 实时计数 |
| GET | `/v1/billing/events` | 哈希链（`?limit=`） |
| GET | `/v1/billing/summary` | 按层级/用户汇总 |
| GET | `/v1/resource/pool` | 节点、核数、水位 |
| POST | `/v1/resource/scale` | 伸缩（`delta`） |
| PUT | `/v1/schedule/policy` | 改副本数/策略 |
| POST | `/v1/turing/run` | 图灵机在机架上运行并与普通机比对 |
| GET | `/v1/health` / `/v1/verify` | 全量状态 / 不变式 |

## 不变式

1. 任一层用量不超过该层容量
2. 计费链 `prev_hash` 逐条自洽
3. 未授权或超体积的请求被拒，且**不计费**
4. 图灵机：普通执行与机架执行在纸带与终态上一致（第 12 章嵌入）

## 界面语言

控制台提供 51 个语言/地区选项，切换偏好保存在本机浏览器存储中；阿拉伯语、波斯语、希伯来语和乌尔都语会切换为从右向左布局。随包提供简体中文、繁体中文、英语、西班牙语、法语、日语、德语、意大利语、巴西葡萄牙语、俄语、阿拉伯语和韩语完整文案，其余选项暂以英语显示。语言资源位于 `src/i18n.js`，无需联网。
