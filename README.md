# magpie-agent-lobehub

一个独立的 Magpie Agent Plugin，加上一个可选的辅助脚本：让 magpie 的 **Usage / Sessions** 把 LobeHub 的流量画成 **LobeHub**（图标 + 名称），同时**完全不动**这个请求在网关里的身份。

- 包名：`magpie-agent-lobehub`
- Agent id：`lobehub`，显示名：`LobeHub`
- License：MIT
- Node **≥ 18**（仅自检与辅助脚本需要；插件本身在 magpie 的 moejs 里跑，不用 Node）

---

## 1. 两层，各管一件事

magpie 里「一个请求叫什么」有两个完全不同的出口，本仓库刻意把它们分开：

| 层 | 实现 | magpie 里的机制 | 影响范围 |
|---|---|---|---|
| **身份层** | `agent.js` 的 `ua: ['lobehub']` + `name` + `icon` | `usage.AgentOf(ua)` | 决定这个请求**是**谁：Routing 日志的 agent、按 agent 索引的各项设置、`IsAgent` 判定 |
| **展示层**（可选） | `scripts/arrange-client.mjs` 写入的 `clientAgents` 映射 | `usage.ReportedAs(ua)`（读 `settings.ClientAgents`） | 只决定 Usage / Sessions **怎么显示**：客户端名、图标、分组、筛选、历史重算 |

所以有两种部署：

- **网关原样透传 `lobehub/…`**：只装插件就够，`ua: ['lobehub']` 直接命中，Usage 与 Sessions 立刻显示 LobeHub。
- **网关发的是别的 product token（例如单字母 `k`）**：插件仍然只写 `lobehub`；另外把 `k → lobehub` 用 `clientAgents` 映射上。请求在网关里**仍是 `k`**，只有那两个页面显示成 LobeHub。

> 一句话：**插件负责「认识 LobeHub 并且有头像」，映射负责「把某个原始 client 报告成 lobehub」。**

---

## 2. 为什么不再往 `ua` 里加 `k`

早期版本试过 `ua: ['lobehub', 'k']`，把部署自己的 product token 塞进插件。**这是错的**，原因都在 magpie 源码里：

| 后果 | 源码 |
|---|---|
| 请求的 `Agent` 字段来自 `agentOf(r)` → `usage.AgentOf(ua)`，`ua` 一改，Routing 日志与 `usage.jsonl` 里的 agent 就跟着改成 `lobehub` | `internal/gateway/gateway.go:61-83` |
| `usage.IsAgent(agent)` 参与 `startedByAgent()` 判定（hook / 子进程发起的调用要靠它区分），`k` 一旦成了已知 agent，这类判定会变 | `internal/gateway/gateway.go:85-95` |
| 一大批设置是**按 agent id 索引**的：`Visible`、`HiddenModels`、`PickedModels`、`OrderedModels`、`AgentEfforts`、`FastPicks`、`AgentOrder`、`AgentsHidden`。身份一换，这些行全部对不上原 key | `internal/settings/settings.go`（`Visible` 等字段定义与 `CarryPerModel` 附近） |
| 映射这条路会被**自己封死**：`countClient` 拒绝「本身已是 agent」的 client，报 `k is counted on its own` | `internal/gui/api.go:2486` |
| `AgentOf()` 只做**前缀**匹配，单字母 `k` 会把 `klm/…` 之类一起吞掉 | `internal/usage/usage.go:333-357` |

结论：`ua` 只留 `lobehub`；部署专属的 token 交给展示层映射。两者互斥，不要同时用。

---

## 3. `clientAgents` 是什么（源码事实）

| 事实 | 位置 |
|---|---|
| 字段：`clientAgents map[string]string`，注释写明「只用于页面上报告的内容，ledger 保留 client 自己的名字，routing / keys / caps / budgets 继续按它走」 | `internal/settings/settings.go:541-549` |
| 归一化：key 与 value 都 `TrimSpace`，key 再 `ToLower`，空的丢弃 | `internal/settings/settings.go:1514-1531` |
| 独立读取入口 `ClientAgentsNow()`（按文件变化重解析，供每次读 ledger 用） | `internal/settings/settings.go:1533-1557` |
| 翻译函数 `ReportedAs(ua)`：先 `AgentOf(ua)`，再查映射；`to == a` 视为未映射 | `internal/usage/client_agents.go:41-63` |
| 写入口：`POST /api/usage/arrange`，body `{"count":{"client":"…","as":"…"}}`，`as` 为空字符串表示「取消，按自己算」 | `internal/gui/api.go:1892-1919` |
| 写校验 `countClient()`：`as` 必须是 magpie 认识的 agent；`client` 不能本身是 agent、不能是 `other`、不能是 `magpie*` | `internal/gui/api.go:2473-2495`（`usage.IsAgent(client)` 在 2486） |
| 应用点（全是「读出来展示」）：Usage 汇总、Sessions 分组、ledger 过滤、历史统计 | `internal/usage/direct.go:100`、`gateway_sessions.go:71,186`、`ledger.go:162,375,429`、`usage.go:882,1014` |
| 网关侧**完全不读**它：`internal/gateway/` 内对 `ReportedAs` 零引用 | —— |
| 名字与图标按 agent id 回填，所以映射到 `lobehub` 就直接用上插件的 `name` / `icon` | `internal/usageapi/usageapi.go:22-42`、`internal/gui/usage.go:41-48` |

### 持久化格式

`settings.json`（默认 `~/.config/magpie/settings.json`，容器里是 `/config/settings.json`）：

```json
{
  "clientAgents": {
    "k": "lobehub"
  }
}
```

**不要手改这个文件。** magpie 运行时以整份 `settings.json` 为单位 `Load` + `Save`，手改随时会被覆盖；用下面的脚本或 GUI，走的是它自己的读写路径。

---

## 4. 辅助脚本：`scripts/arrange-client.mjs`

零依赖、只用 Node 标准库。默认**只预览，不发请求**；`--apply` 才真的调用 magpie 的 API。

```sh
export MAGPIE_WEB_URL=<magpie web 打印出来的地址，去掉 ?k= 部分>
export MAGPIE_WEB_KEY=<它打印的 key>

node scripts/arrange-client.mjs            # 预览：打印将要发送的 POST，不发送
node scripts/arrange-client.mjs --apply    # 真的写：k → lobehub
node scripts/arrange-client.mjs --apply --undo   # 撤销：k 按自己算
```

预览输出形如：

```text
dry run — nothing was sent
  POST  <base>/api/usage/arrange
  body  {"count":{"client":"k","as":"lobehub"}}
  auth  magpie_web_<port>=<key from MAGPIE_WEB_KEY, 24 chars>
```

参数：

| 参数 | 作用 |
|---|---|
| `--apply` | 真的发送（缺省只预览） |
| `--dry-run` | 显式预览；与 `--apply` 同时出现会被拒绝 |
| `--client <name>` | 要报告的 client，缺省 `k` |
| `--as <agent>` | 目标 agent，缺省 `lobehub`；会小写化，并按 agent id 格式（`^[a-z0-9][a-z0-9._-]{0,63}$`）校验 |
| `--undo` | 发送 `as: ""`，把该 client 恢复成按自己算；与 `--as` 互斥 |
| `--url <url>` | 页面地址；缺省取 `MAGPIE_WEB_URL` |
| `--key <key>` | 页面 key；缺省取 `MAGPIE_WEB_KEY`（**优先用环境变量**，免得进 shell 历史） |
| `--cookie-name <name>` | 覆盖由 URL 端口推导出的 cookie 名；反代下必须给（见下） |
| `--json` | 输出机器可读结果 |
| `--help` | 帮助 |

退出码：`0` 成功或预览，`1` 请求失败/未被确认，`2` 参数被拒（此时**没有发出任何请求**）。

安全边界（脚本自身保证，且被 `selfcheck.mjs` 断言）：

- 默认 dry-run，只有显式 `--apply` 才 `fetch`。
- 不内置任何地址、host 或凭据；源码里没有 URL 字面量。
- 不 import `fs`，不写任何文件；key 只在内存里，只出现在 cookie 头，不出现在 URL 或 body。
- 地址里带 `user:pass@`、非 `http(s)`、或带 `?` / `#` 一律拒绝；path 只接受根 `/`（写成 `…:3430` 或 `…:3430/` 都行），`…:3430/magpie` 这类子路径也拒绝 —— `new URL()` 会静默丢掉它，请求会发去别处。`?k=` 属于浏览器登录用的，不该进脚本。
- 发送前就拒绝 `other`、`magpie*`、以及与目标相同的 client —— 与 `countClient` 的规则对齐。
- 发送后不是「2xx 就算成功」：响应必须能认出是 magpie 的 **settings 状态**（`version`、`dir`、`gateway` 三个字段恒定写出，`internal/gui/api.go:346-350`），并且真的体现了这一对（或撤销后不再体现），才返回成功。非 JSON、`{}`、缺 `clientAgents` 的 apply、撤销后仍列出该对，全部是**未确认**（退出码 1）。

### 为什么用 cookie 而不是 `?k=`

`magpie web` 的页面守卫（`internal/gui/web.go:200-259`）认得两种凭据：URL 上的 `?k=<key>`，或名为 `magpie_web_<port>` 的 cookie（`webHandler` 里 cookie 名就是 `"magpie_web_"+port`，见 `internal/gui/web.go:326-328`）。

`?k=` 那条路径会回 **303 跳转**并把 key 种成 cookie —— 对 `POST` 来说，跳转后 body 就丢了，等于静默不生效。脚本因此直接带 `Cookie: magpie_web_<port>=<key>`，一步到位。

### 反向代理：cookie 名来自 magpie 自己的监听端口

cookie 名里的端口，是 **magpie 后端监听的那个端口**，不是浏览器地址栏里的端口。直连时两者相同，脚本按 URL 端口推导即可；一旦前面挂了 NPM / Caddy / nginx（对外 443、对内 3430 之类），推导出来的名字就错了，请求会以「没有登录 cookie」被拒。

这时显式给名字：

```sh
export MAGPIE_WEB_URL=<反代对外地址，去掉 ?k=>
export MAGPIE_WEB_KEY=<key>
node scripts/arrange-client.mjs --apply --cookie-name magpie_web_3430   # 3430 = magpie 的监听端口
```

名字怎么来的：`webHandler` 用 `net.SplitHostPort` 得到的端口拼出 `"magpie_web_"+port`（`internal/gui/web.go:326-328`）。所以先确认 magpie 实际监听端口（容器端口映射的**内部**端口，或 `MAGPIE_ADDR`），再拼这个名字；名字的字符集限定为字母、数字、`. _ -`。

---

## 5. 前置条件（顺序不能反）

1. **先装并启用本插件**，让 `lobehub` 成为 magpie 认识的 agent。否则写映射会被拒：
   `lobehub is not an agent magpie knows`。
2. **magpie 要有 ClientAgents 这个功能**。判断方法（二选一，都是只读）：
   - GUI：Usage 页的 Agents 列表里，某个 client 行的 ⋮ 菜单里有 **“Count as an agent…”**；
   - 源码：存在 `internal/usage/client_agents.go`，且 `internal/gui/api.go` 里有 `POST /api/usage/arrange` 路由。
   本仓库对照的是 magpie 源码 `5774c790`（2026-10-19）。**更老的版本没有这个能力**，只能升级 magpie，不要试图用 UA 规则替代（见第 2 节）。
3. 拿到页面地址与 key：`magpie web` 启动时会打印一条带 `?k=` 的链接；`--url` 用它去掉 `?k=` 之后的部分，key 用同一个值。容器部署一般设 `MAGPIE_WEB_KEY`，key 在容器日志/环境里。

---

## 6. GUI 手动路径（脚本不方便时）

1. 打开 Usage 页，找到 Agents 列表里 client 名为 `k` 的那一行；
2. 点该行右侧的 ⋮（或右键行）→ **Count as an agent…**；
3. 在弹出的 agent 列表里选 **LobeHub**；
4. 该行名字下方出现 `with k`，说明 `k` 已被计入 LobeHub 行；
5. 撤销：同一行的 ⋮ → **Count k on its own**，或跑 `--apply --undo`。

> 脚本的撤销会核对返回的 settings 状态：成对映射被清空后，magpie 的 `clientAgents` 因 `omitempty` 整段消失，此时只有响应确认是 magpie settings 状态才算成功。若脚本报「未确认」，以上面第 5 步的 GUI 显示为准 —— 那里画的就是 magpie 真正持有的映射。

（脚本与 GUI 写的是同一个字段、走同一个 API，效果等价。）

---

## 7. 验证清单

- 脚本：`--apply` 后打印 `applied on <origin> — k is counted as lobehub …`（origin 只含 scheme/host/port，不含凭据），且 `--json` 里 `clientAgents` 含 `"k": "lobehub"`。
- 脚本：`--apply --undo` 后 `clientAgents` 里不再有该 client；若报未确认，去 GUI 的 `k` 行看还有没有 `with k`。
- Usage 页：Agents 列表出现/合并到 **LobeHub** 行，像 `with k`，图标是插件那张。
- **Routing 页：`k` 仍然是 `k`。** 这是关键断言 —— 映射不碰网关身份，Routing 日志、caller key、模型目录与 caps 都不变。
- 取消映射后，历史统计立刻按原样重新计算（`ReportedAs` 是读时翻译，不改已写的记录）。

---

## 8. 安装

```sh
magpie plugin add /path/to/magpie-agent-lobehub
```

- 这是**路径安装**：不下载 Bun、不跑 build、不安装依赖、不执行脚本。
- 装完 `magpie plugin list` 应能看到这个路径；magpie 每秒检查一次 `plugins.json` 与模块 mtime，Agents 页刷新即可，通常不用重启。
- 也可以只把 `agent.js` 单独喂给 `magpie plugin add ./agent.js`（单文件模式），但会丢掉 `assets/icon.svg` 与自检，不推荐。

### 卸载

```sh
magpie plugin rm /path/to/magpie-agent-lobehub
```

- 路径插件在 magpie 里 `Name(spec)` 就是**路径本身**（`internal/plugin/store.go`），所以 `rm` 也必须给路径。
- 可选清理：`rm -rf ~/.config/magpie-agent-lobehub`（仅当曾误给该行挑过模型）。
- 映射是另一件事，卸载插件不会撤销它：先 `--undo`，否则 Usage 里会指向一个已不存在的 agent（名字回退成 id）。

---

## 9. 预期视觉效果

1. **Agents 页**多一行 `LobeHub`，图标是蓝紫渐变的圆角方块 + 白色 L 形钩。图标是内嵌的 data URI：magpie 第一次见到就解码，存进自己的 `icons/` 目录并从那里提供，之后离线也有图。
2. `lobehub/2.2.19`（以及映射过的 client）在 Usage / Sessions 里显示 `LobeHub` 与同一张图。
3. 该行**不需要连接**：没有模型路由、没有账号、没有写入。出现即可用。

---

## 10. 关于占位的 config / model（惰性，无副作用）

magpie 的 schema（`internal/agentplug`）要求 agent 有 `config`，且「`model` 与 `connect` 至少给一个」。本插件既不想有写入，也不想要连接开关，于是给了惰性占位：

```js
config: '~/.config/magpie-agent-lobehub/placeholder.json', // 插件自己的路径
format: 'json',
model: 'model',                                            // 一个普通 key 名
// 没有 connect
```

- 没有 `connect`，magpie 除了这个 `model` key 之外**没有任何东西可写**。
- 只要你不碰 Agents 页这一行，`placeholder.json` 连创建都不会发生（只有挑模型才会写）。
- 这个路径在**任何 LobeHub 配置目录之外**，自检会断言这一点。

> **请不要在 Magpie 的 Agents 页面为 `LobeHub` 这一行选模型或打开连接。**

---

## 11. 自检（不需要 magpie，不需要 `npm install`）

```sh
node selfcheck.mjs      # 等价于 npm run check
```

退出码 `0` = 全部通过，`1` = 有失败项（失败行会打印原因）。

| 复刻的规则 | magpie 出处 |
|---|---|
| `magpie.agent` 可解析、包内相对路径、文件存在；无 `main`/`exports` | `internal/plugin/agent.go` |
| `id` 形如 `^[a-z0-9][a-z0-9._-]{0,63}$`；`config` 非空；`format` ∈ json/yaml/env；`model` 或 `connect` 至少一个 | `internal/agentplug/agentplug.go` `Desc.check()` |
| `ua` 逐项小写；按 `AgentOf()` 的名字→前缀两段规则对样例 UA 归类 | `internal/usage/usage.go` |
| icon 是 data URI、base64 可解码、≤ 1 MB、前 1024 字节含小写 `<svg` | `internal/provider/plugin_icon.go`、`icon.go` |
| 内嵌 base64 与 `assets/icon.svg` **逐字节相同** | 本项目自己的约束 |

此外还断言（本项目自己的不变量）：

- `agent.ua` **精确等于** `["lobehub"]`；`k/2.2.19`、`klm/1.0` 不被吞。
- 任何 `ua` 项长度 ≥ 3，防止单字母前缀再次混进来。
- 辅助脚本：默认 dry-run（不调用 `fetch`）、`--apply` 才发一次 POST、body 精确为 `{"count":{"client":"k","as":"lobehub"}}`、cookie 名为 `magpie_web_<port>`、`--undo` 发 `as: ""`、缺 key / `other` / `magpie*` / 非法 agent id / 非法 key 字符集 / 带凭据或非 http 的地址 / 非根 path 都在发送前被拒。
- 回读确认：`--client K` 的 body 保留原样，但按 magpie 的存储方式用小写 `k` 回读确认；`{}`、非 JSON 一律不算成功；`--undo` 只在确认是 magpie settings 状态时，才把「字段缺失」当作清空成功。
- `--cookie-name` 覆盖按端口推导的名字，不覆盖时仍推导；成功/失败输出回显目标 origin，且从不打印 key。
- 脚本源码不含 URL 字面量、不含默认 host、不 import `fs`、不写环境变量。

它**不做**的事：不启动 magpie，不证明 moejs 能编译该模块（用 Node 导入验证 ESM 形状），也不验证 GUI 实际绘制。

---

## 12. 已知限制

1. **映射只影响展示**：Usage / Sessions 的客户端名、图标、分组、筛选与历史重算。Routing、caller key、模型目录、caps/budgets 仍是原始 client。
2. **映射按小写匹配**：ledger 存的是 `AgentOf` 的原始大小写（`K/2.2.19` 记作 `K`），而查表时 `ReportedAs` 会 `ToLower`，所以 `k` 与 `K` 都能命中同一条映射。
3. **一条映射对应一个 client**：别的 client 要单独映射，脚本可重复执行（`--client <name>`）。
4. **需要 magpie 有 ClientAgents**：更老的版本没有这个 API；不要退回「加 UA 规则」的老路（第 2 节）。
5. **`lobehub/<version>` 是当前版本观察到的行为，不是长期契约**：它出现在 LobeHub 的 Anthropic 兼容 runtime 里，上游随时可能改。升级 LobeHub 后如果 Usage 里不再出现 LobeHub 行，先看实际 UA 的 product token，再决定是保留 `ua` 还是改用映射。走其它协议时 LobeHub 也可能发 `LobeChat/1.0`、`LobeHub Desktop/<ver>` 或调用方自带的 UA：`LobeHub Desktop/…` 因 product token 是 `LobeHub` 仍会命中；`LobeChat/1.0` 不会（另一条产品线）。
6. **UA 可被调用方覆盖**：这类请求不会被识别，可用映射兜底。
7. **只认 UA**：不看 host、路径、模型 id。
8. **图标是手绘近似**，不是官方商标资源。换图：改 `assets/icon.svg`，跑 `node selfcheck.mjs`，它会把新的 base64 打印出来，粘回 `agent.js` 即通过。
9. **插件卡片图标**：本包没给 `package.json` 的 `magpie.icon`，Plugins › Installed 里插件自己的卡片仍是通用图标；Agents 页 `LobeHub` 那一行用的是 `agent.icon`。
