# Infinity Studio 子产品模块契约

每个子产品（Craft 九兄弟 / WebViewer / Office / Packages / Integrations / Server / Studio 本体）
在 InfinityStudio/src/apps/ 下有一个同名模块，向外暴露一个纯函数式的能力面。

## 硬性规矩
- 零运行时依赖，只用 node: 内置模块；ESM；不用 TypeScript。
- 不 import 任何第三方包；不写网络请求（除非任务明确要求探测本机服务）。
- 不 git 操作、不弹窗、不重编译、不动别人作用域的文件。
- 每个模块都要能被 node --check 通过，并有一个配套的 work/<name>-smoke.mjs 冒烟脚本，
  脚本最后一行打印 <NAME>-SMOKE-PASS n/n 或 <NAME>-SMOKE-FAIL n/m，失败时 process.exitCode=1。
- 冒烟脚本必须真跑（真读文件、真算哈希、真解析），不允许只断言常量存在。

## 通用导出形状
每个 apps/<id>.js 导出：
- export const META = { id, name, version, branch, codecs: [{ext, since}], hosts: [宿主 id] }
- export function capabilities() -> { id, name, version, features: string[], formats: string[], hosts: string[], implemented: boolean }
- export function plan(action, input) -> { ok, action, steps: [{kind, detail}], warnings: string[] }（纯函数，无副作用）
- export function run(action, input) -> 真做事的入口，返回 { ok, action, result, error? }
- export default { META, capabilities, plan, run }

## 约定
- action 用小写短语：open / render / transcode / chat / probe / export 等。
- 未知 action 返回 { ok: false, error: "UNKNOWN_ACTION" }，绝不抛异常给调用方。
- 所有路径参数按传入值使用，不拼死路径。
- 报错信息用中文短句，错误码用大写蛇形。
