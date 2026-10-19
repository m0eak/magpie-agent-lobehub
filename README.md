# magpie-agent-lobehub

一个独立的 Magpie Agent Plugin：让 magpie 把 `User-Agent: lobehub/...` 的请求认成 **LobeHub**，并在 Agents 页、Usage、Sessions 里用 LobeHub 的图标画出来。

**只做识别与图标。** 不碰会话 ID、不做会话归组、不改写请求、不注册网关中间件、不读写任何 LobeHub 配置。

- 包名：`magpie-agent-lobehub`
- Agent id：`lobehub`，显示名：`LobeHub`
- License：MIT

```
magpie-agent-lobehub/
├── package.json        # ESM；"magpie": { "agent": "./agent.js" }
├── agent.js            # 唯一的 agent 导出（含内嵌 SVG data URI 图标）
├── assets/icon.svg     # 图标的可编辑源文件（自检会比对它与内嵌 base64）
├── selfcheck.mjs       # 无需 magpie、无需 npm install 的静态自检
├── README.md
└── LICENSE
```

## 安装

```sh
magpie plugin add /path/to/magpie-agent-lobehub
```

- 这是**路径安装**：不下载 Bun、不跑 build、不安装任何依赖，也不执行脚本。
- 装完 `magpie plugin list` 应能看到这个路径。magpie 每秒检查一次 `plugins.json` 与模块 mtime，Agents 页刷新即可看到新行，通常不用重启。
- 也可以只把 `agent.js` 单独喂给 `magpie plugin add ./agent.js`（单文件模式），但那样会丢掉 `assets/icon.svg` 与自检，不推荐。

## 预期视觉效果

1. **Agents 页**多一行 `LobeHub`，图标是蓝紫渐变的圆角方块 + 白色 L 形钩。图标来自内嵌的 `data:image/svg+xml;base64,…`：magpie 第一次见到就解码，存进它自己的 `icons/` 目录并从那里提供，之后离线也有图。
2. **Usage / Sessions** 里，形如 `lobehub/2.2.19` 的请求，客户端列显示 `LobeHub`，并按 `agent=lobehub` 归入统计与分组。
3. 该行**不需要连接**：它没有模型路由、没有账号、没有写入。出现即可用。

## 它是怎么被认出来的

magpie 的归类逻辑在 `internal/usage/usage.go` 的 `AgentOf()`：取 User-Agent 的 product token（`/` 之前、空格之前），转小写；先按 agent id / 别名**精确**比对，再按各 agent 的 `ua` 列表做**前缀**匹配。

所以本插件 `ua: ["lobehub"]` 覆盖：

| User-Agent | 归类 |
|---|---|
| `lobehub/2.2.19` | `lobehub` |
| `lobehub` | `lobehub` |
| `LobeHub/2.2.19` | `lobehub` |
| `LobeHub Desktop/2.2.19` | `lobehub` |
| `lobechat/1.0` | `lobechat`（不归本插件） |
| `curl/8.5.0` | `curl` |

LobeHub 侧实际发送该 UA 的位置（只读核对用）：`packages/model-runtime/src/core/anthropicCompatibleFactory/index.ts` 中的 `'User-Agent': \`lobehub/${CURRENT_VERSION}\``。升级 LobeHub 后若归类失效，先回这里确认这一行是否还在。

## 范围 / 非目标

**做：**
- 把 `lobehub` 前缀的 User-Agent 归为一个 agent（id `lobehub`，名字 `LobeHub`）。
- 给这个 agent 一个内嵌图标。

**明确不做：**
- 不处理、不推导、不改写会话 ID；不做会话归组（那是 magpie 的 sessions 子系统，与此无关）。
- 不做请求/响应重写；不实现 `onRequest`/`onEvent`；不注册 gateway middleware。
- 不读写 LobeHub 的配置、数据目录、数据库或网关；不安装任何东西到系统。
- 不做模型路由、账号、计价、限流。

## 关于占位的 config / model（惰性，无副作用）

magpie 的 schema（`internal/agentplug`）要求 agent 必须有 `config`，且「`model` 与 `connect` 至少给一个」。本插件既不想有写入，也不想要连接开关，于是给了惰性占位：

```js
config: '~/.config/magpie-agent-lobehub/placeholder.json', // 插件自己的路径
format: 'json',
model: 'model',                                            // 一个普通 key 名
// 没有 connect
```

- 没有 `connect`，magpie 除了这个 `model` key 之外**没有任何东西可写**。
- 只要你不碰 Agents 页这一行，`placeholder.json` 连创建都不会发生（只有挑模型才会写）。
- 这个路径在**任何 LobeHub 配置目录之外**（不在 `~/.lobehub`、`~/.config/lobehub`、`LobeHub/Application Support` 里），自检会断言这一点。

> **请不要在 Magpie 的 Agents 页面为 `LobeHub` 这一行选模型或打开连接。** 你不需要连接它，也不应该让它去写任何 LobeHub 配置。
>
> 唯一的副作用场景：手动给这一行挑了一个模型，magpie 会创建上述 `placeholder.json` 并写入 `{"model": "..."}`。删掉该文件即可，与 LobeHub 无关。

## 自检（不需要 magpie，不需要 npm install）

```sh
cd /path/to/magpie-agent-lobehub
node selfcheck.mjs      # 等价于 npm run check，但不安装任何依赖
```

退出码 0 = 全部通过，1 = 有失败项（失败行会打印原因）。

它按 magpie 源码复刻校验：

| 复刻的规则 | magpie 出处 |
|---|---|
| `magpie.agent` 可解析、包内相对路径、文件存在；无 `main`/`exports`（agent-only） | `internal/plugin/agent.go` |
| `id` 形如 `^[a-z0-9][a-z0-9._-]{0,63}$`；`config` 非空；`format` ∈ json/yaml/env；`model` 或 `connect` 至少一个 | `internal/agentplug/agentplug.go` `Desc.check()` |
| `ua` 逐项小写；按 `AgentOf()` 的名字→前缀两段规则对样例 UA 归类 | `internal/usage/usage.go` |
| icon 是 `data:image/…`、base64 可解码、≤ 1 MB、前 1024 字节含小写 `<svg` | `internal/provider/plugin_icon.go`、`icon.go` |
| 内嵌 base64 与 `assets/icon.svg` **逐字节相同** | 本项目自己的约束 |

它**不做**的事：不启动 magpie，不证明 moejs 能编译该模块（它用 Node 导入验证 ESM 形状），也不验证 GUI 实际绘制。模块因此刻意只用纯对象字面量与字符串，不含 Node API、不含 import，自检会做静态断言。

## 卸载

```sh
magpie plugin rm /path/to/magpie-agent-lobehub
```

- 路径插件在 magpie 里 `Name(spec)` 就是**路径本身**（`internal/plugin/store.go`），所以 `rm` 也必须给路径；给包名 `magpie-agent-lobehub` 匹配不上。
- 可选清理：`rm -rf ~/.config/magpie-agent-lobehub`（仅当曾误给该行挑过模型）。

## 已知限制

1. **UA 覆盖面**：`lobehub/<version>` 只由 Anthropic 兼容 runtime 设置。走 OpenAI 兼容等其它路径时，LobeHub 可能发的是 `LobeChat/1.0`、`LobeHub Desktop/<ver>` 或调用方自带的 UA。其中 `LobeHub Desktop/…` 因 product token 是 `LobeHub` 也会被归到本插件；`LobeChat/1.0` 不会（它属于另一条产品线）。
2. **UA 可被调用方覆盖**：该 header 写在 `...options.defaultHeaders` 之前展开，调用方自带 `User-Agent` 会覆盖它；这类请求不会被识别。
3. **只认 UA**：不看 host、路径、模型 id。模型名里的 `lobehub/<catalogId>` 不参与归类。
4. **图标是手绘近似**：渐变圆角方块 + L 形钩，用于在列表里可辨认，并非 LobeHub 官方商标资源的拷贝。要换图：改 `assets/icon.svg`，跑 `node selfcheck.mjs`，它会把新的 base64 打印出来，粘回 `agent.js` 即通过。
5. **插件卡片图标**：本插件没有给 `package.json` 的 `magpie.icon`，所以 Plugins › Installed 里插件自己的卡片仍是 magpie 的通用图标；Agents 页 `LobeHub` 这一行用的是 `agent.icon`。要连卡片一起换，把同一串 data URI 加到 `"magpie": { "icon": … }`。
6. **归类只影响展示**：Usage/Sessions 的客户端名与图标；不改变任何请求内容与计费之外的统计口径。
