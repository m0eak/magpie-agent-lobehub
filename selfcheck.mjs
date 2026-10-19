#!/usr/bin/env node
// selfcheck.mjs — a static check of this plugin, runnable without magpie
// and without `npm install`: Node's standard library only.
//
// It re-implements the rules magpie applies, from its source:
//   internal/agentplug/agentplug.go   Desc.check()  — id, config, format,
//                                     model-or-connect, ua lower-cased
//   internal/plugin/agent.go          magpie.agent, agent-only package
//   internal/provider/plugin_icon.go  a data:image/ URI
//   internal/provider/icon.go         MaxIcon, image-format sniffing
//   internal/usage/usage.go           AgentOf() — name, then ua prefix
//   internal/usage/client_agents.go   ReportedAs() — display-only mapping
//   internal/gui/api.go               countClient() — what the API refuses
//
// What it cannot check without magpie: that magpie loads the module in
// moejs (this runs it in Node instead), and what the GUI draws.
//
// Usage: node selfcheck.mjs        (exit 0 = all checks passed)

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let failed = 0;

const ok = (label, note) => console.log(`ok   ${label}${note ? ` — ${note}` : ''}`);
const bad = (label, why) => {
  failed++;
  console.log(`FAIL ${label}${why ? ` — ${why}` : ''}`);
};
const check = (cond, label, note) => (cond ? ok(label, note) : bad(label, note));

// magpie's own patterns and limits.
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const FORMATS = { '.json': 'json', '.jsonc': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.env': 'env' };
const MAX_ICON = 1 << 20;

console.log(`magpie-agent-lobehub selfcheck (${here})\n`);

// ---- the package manifest ------------------------------------------------

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
  ok('package.json parses');
} catch (err) {
  bad('package.json parses', err.message);
  process.exit(1);
}

check(NPM_NAME.test(pkg.name ?? ''), 'package name is a legal npm name', pkg.name);
check(typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version), 'version is semver', pkg.version);
check(pkg.license === 'MIT', 'license is MIT', pkg.license);
const licence = existsSync(join(here, 'LICENSE')) ? readFileSync(join(here, 'LICENSE'), 'utf8') : '';
check(/MIT License/.test(licence) && /Copyright/.test(licence), 'LICENSE file holds the MIT text');
check(pkg.type === 'module', 'package is ESM ("type": "module")', pkg.type);
check(
  Array.isArray(pkg.files) && pkg.files.includes('assets/lobehub-color.png'),
  'package includes the official LobeHub PNG asset',
);

const declared = pkg.magpie?.agent;
check(typeof declared === 'string' && declared.trim() !== '', 'package.json says "magpie": { "agent": … }', declared);
const agentFile = resolve(here, declared ?? '');
check(agentFile.startsWith(here + '/'), 'magpie.agent stays inside the plugin folder', agentFile);
check(existsSync(agentFile), 'magpie.agent points at a file that exists');

// plugin.Agent() reports `only` when the package names no main/exports: an
// agent-only package, which is what this is (internal/plugin/agent.go).
check(pkg.main === undefined && pkg.exports === undefined, 'package is agent-only (no main, no exports)');

// ---- the agent export ----------------------------------------------------

let mod;
try {
  mod = await import(pathToFileURL(agentFile).href);
  ok('agent module imports (ESM)');
} catch (err) {
  bad('agent module imports (ESM)', err.message);
  process.exit(1);
}

const agent = mod.agent;
check(agent !== null && typeof agent === 'object' && !Array.isArray(agent), 'module exports an agent object');
check(typeof mod.default === 'undefined' || typeof mod.default === 'object', 'no conflicting default export');

// Desc.check(): id, config, format.
check(typeof agent.id === 'string' && ID.test(agent.id), 'agent.id is a legal magpie id', agent.id);
check(typeof agent.config === 'string' && agent.config.trim() !== '', 'agent.config names a file', agent.config);

const format = agent.format ?? FORMATS[agent.config.slice(agent.config.lastIndexOf('.')).toLowerCase()] ?? '';
check(['json', 'yaml', 'env'].includes(format), 'agent.format resolves to json, yaml or env', format);

// A module with neither a model key nor a connect has nothing to write;
// with a model key, a connect is optional (agentplug.Compile).
const hasModel = typeof agent.model === 'string' && agent.model.trim() !== '';
const hasConnect = typeof mod.connect === 'function';
check(hasModel || hasConnect, 'agent names a model key or a connect (magpie refuses neither)', hasModel ? `model: ${agent.model}` : 'connect');

// ua: magpie lower-cases each entry; usage.AgentOf() matches by prefix.
check(Array.isArray(agent.ua) && agent.ua.length > 0, 'agent.ua is a non-empty array');
check(agent.ua.every((u) => typeof u === 'string' && u === u.toLowerCase() && u !== ''), 'every ua entry is a non-empty lower-case string');

// ---- what this plugin is for --------------------------------------------

check(agent.id === 'lobehub', 'agent.id is "lobehub"', agent.id);
check(agent.name === 'LobeHub', 'agent.name is "LobeHub"', agent.name);

// Exactly one rule: the product token LobeHub's own runtime sends. It is a
// prefix rule, so "lobehub/2.2.19" and "lobehub" both count.
check(
  JSON.stringify(agent.ua) === JSON.stringify(['lobehub']),
  'the only ua rule is the "lobehub" prefix',
  JSON.stringify(agent.ua),
);

// A deployment whose gateway sends another product token must NOT be
// taught to magpie here: AgentOf() feeds routing, caller keys, the model
// catalogue an agent is shown and its caps/budgets. A one-letter prefix
// would also swallow unrelated clients. That environment is served by the
// display-only ClientAgents mapping instead (scripts/arrange-client.mjs).
check(
  agent.ua.every((u) => u.length >= 3),
  'no single- or two-letter ua prefix: a short prefix swallows unrelated clients',
  agent.ua.join(', '),
);

check(!hasConnect, 'module exports no connect: magpie has nothing to write', 'inert by construction');

// The placeholder config, and the promise that it is not LobeHub's.
const home = process.env.HOME || process.env.USERPROFILE || '~';
const configPath = agent.config.replace(/^~(?=\/|$)/, home).replace(/\$(\w+)|\$\{(\w+)\}/g, (_, a, b) => process.env[a || b] ?? '');
const lobehubDirs = [
  join(home, '.lobehub'),
  join(home, '.config', 'lobehub'),
  join(home, 'Library', 'Application Support', 'LobeHub'),
];
const insideLobeHub = lobehubDirs.some((d) => configPath.toLowerCase().startsWith(d.toLowerCase() + '/'));
check(!insideLobeHub, 'the placeholder config is outside every LobeHub config directory', configPath);
check(
  configPath === join(home, '.config', 'magpie-agent-lobehub', 'placeholder.json'),
  'the placeholder config is the plugin\'s own path',
  configPath,
);
if (existsSync(configPath)) {
  console.log(`note ${configPath} already exists — it is a leftover of a model pick, not this plugin writing`);
}

// moejs runs the module, not Node: no Node APIs, no imports.
const source = readFileSync(agentFile, 'utf8');
check(!/\bimport\s[^;]*from\s*['"]node:/.test(source) && !/\brequire\s*\(/.test(source), 'module uses no Node API or import');
check(!/\bprocess\./.test(source), 'module reads no process state');

// ---- where this agent shows up, and where it does not -------------------
//
// Loading the module makes `lobehub` a known agent — usage.PluginAgents
// reads agentplug.List() — which is what names a request on the Usage and
// Sessions pages, gives that name this row's icon (usageapi.Clients is
// agent.Clients: "every agent, detected or not") and lets countClient
// accept it as the agent a client is counted as.
//
// It is not an agent magpie detects: agent.Detected() wants a config file
// that exists, a folder, a bin on PATH or a sign-in, and this plugin has
// none of them, so the Agents page draws no row for it. The docs may not
// say otherwise.
const readmeText = readFileSync(join(here, 'README.md'), 'utf8');
check(agent.bin === undefined && agent.dir === undefined, 'agent.js declares no bin or dir, so magpie does not detect it');
check(/detected/i.test(source), 'agent.js says it is not an agent magpie detects');
check(!/Agents 页[^。\n]{0,12}多一行/.test(readmeText), 'README does not claim a row on the Agents page');
check(!/为 `LobeHub` 这一行选模型/.test(readmeText), 'README does not send the reader to an Agents row that is not there');
check(/已知客户端/.test(readmeText) && /不会出现/.test(readmeText), 'README says where the id does show up, and where it does not');

// ---- the icon ------------------------------------------------------------

const OFFICIAL_ICON_URL = 'https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/lobehub-color.png';
const icon = agent.icon;
check(
  typeof icon === 'string' && icon.startsWith('data:image/png;base64,'),
  'agent.icon is a base64 PNG data URI',
);
const comma = typeof icon === 'string' ? icon.indexOf(',') : -1;
const meta = comma > 0 ? icon.slice('data:'.length, comma) : '';
const payload = comma > 0 ? icon.slice(comma + 1) : '';
check(meta === 'image/png;base64', 'icon URI declares the PNG MIME type', meta || '(no metadata)');
check(/;base64$/i.test(meta), 'icon URI is base64', meta || '(no metadata)');

let bytes = null;
try {
  bytes = Buffer.from(payload.replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== payload.replace(/\s+/g, '').replace(/=+$/, '')) {
    bytes = null;
  }
} catch {
  bytes = null;
}
check(bytes !== null, 'icon payload decodes as base64');
check(bytes !== null && bytes.length > 0 && bytes.length <= MAX_ICON, 'icon is not over 1 MB (magpie MaxIcon)', `${bytes?.length ?? 0} bytes`);
check(
  bytes !== null && bytes.length >= 128 && bytes.length <= 256 * 1024,
  'PNG asset has a reasonable size (128 B–256 KiB)',
  `${bytes?.length ?? 0} bytes`,
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
check(
  bytes !== null && bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
  'icon has the PNG signature',
);

const pngFile = join(here, 'assets', 'lobehub-color.png');
if (!existsSync(pngFile)) {
  bad('assets/lobehub-color.png is the official icon source', 'missing');
} else {
  const png = readFileSync(pngFile);
  const same = bytes !== null && png.equals(bytes);
  check(same, 'the embedded PNG is byte-for-byte assets/lobehub-color.png');
  check(
    png.length >= 128 && png.length <= 256 * 1024 && png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    'official PNG asset has a valid signature and reasonable size',
    `${png.length} bytes; source: ${OFFICIAL_ICON_URL}`,
  );
}
check(!existsSync(join(here, 'assets', 'icon.svg')), 'legacy assets/icon.svg is removed');

// ---- usage.AgentOf(), as magpie classifies a request --------------------

// The gateway names a request by its User-Agent: the product token before
// "/" and before " ", lower-cased; an exact id or alias first, then a ua
// prefix. magpie's own agents are not in play here (none is named or
// prefixed "lobehub").
const known = { id: agent.id, names: [agent.id], ua: agent.ua };
const agentOf = (raw) => {
  const ua = String(raw).trim();
  let name = ua.split('/')[0];
  name = name.split(' ')[0];
  const lower = name.toLowerCase();
  if (known.names.includes(lower)) return known.id;
  if (known.ua.some((p) => lower.startsWith(p))) return known.id;
  return name || 'other';
};

const cases = [
  ['lobehub/2.2.19', 'lobehub'],
  ['lobehub', 'lobehub'],
  ['LobeHub/2.2.19', 'lobehub'],
  ['LobeHub Desktop/2.2.19', 'lobehub'],
  // A deployment whose gateway sends "k" is NOT named here. The plugin
  // leaves it alone so the request keeps its own gateway identity, and
  // scripts/arrange-client.mjs maps it for the Usage and Sessions pages
  // only (internal/usage/client_agents.go).
  ['k/2.2.19', 'k'],
  ['k', 'k'],
  ['K/2.2.19', 'K'],
  // ... and a token that merely starts with "k" is untouched, which the
  // one-letter prefix rule could not promise.
  ['klm/1.0', 'klm'],
  ['lobechat/1.0', 'lobechat'],
  ['codex/0.1.0', 'codex'],
  ['openai-python/1.0', 'openai-python'],
  ['python-requests/2.32', 'python-requests'],
  ['node-fetch/3.0', 'node-fetch'],
  ['okhttp/4.12', 'okhttp'],
  ['curl/8.5.0', 'curl'],
];
for (const [ua, want] of cases) {
  const got = agentOf(ua);
  check(got === want, `UA ${JSON.stringify(ua)} is named ${JSON.stringify(want)}`, got === want ? '' : `got ${JSON.stringify(got)}`);
}

// ---- scripts/arrange-client.mjs -----------------------------------------
//
// The display-only half: settings.ClientAgents maps a client the ledger
// records ("k") to an agent magpie knows ("lobehub"), and only what the
// Usage and Sessions pages report — routing, caller keys, caps and budgets
// stay on AgentOf (internal/usage/client_agents.go:41-49).
//
// The tool must be safe by default: a dry run unless --apply, no URL or
// credential baked in, nothing written to disk.

const toolFile = join(here, 'scripts', 'arrange-client.mjs');
let tool = null;
if (!existsSync(toolFile)) {
  bad('scripts/arrange-client.mjs exists', 'missing');
} else {
  try {
    tool = await import(pathToFileURL(toolFile).href);
    ok('scripts/arrange-client.mjs imports');
  } catch (err) {
    bad('scripts/arrange-client.mjs imports', err.message);
  }
}

if (tool) {
  const {
    ARRANGE_PATH,
    DEFAULT_CLIENT,
    DEFAULT_AS,
    parseArgs,
    buildRequest,
    run,
  } = tool;

  check(ARRANGE_PATH === '/api/usage/arrange', 'the tool targets magpie\'s POST /api/usage/arrange', ARRANGE_PATH);
  check(DEFAULT_CLIENT === 'k', 'the tool\'s default client is "k"', DEFAULT_CLIENT);
  check(DEFAULT_AS === 'lobehub', 'the tool\'s default agent is "lobehub"', DEFAULT_AS);
  check(typeof parseArgs === 'function' && typeof buildRequest === 'function' && typeof run === 'function', 'the tool exports parseArgs, buildRequest and run');

  const quiet = () => {};
  const URL_ = 'http://magpie.test:3430';
  const KEY = 'test-key-0123456789';
  const ORIGIN = 'http://magpie.test:3430';

  // What magpie answers a settings write with: settingsState(), whose
  // version, dir and gateway are always there (internal/gui/api.go:346-350),
  // while clientAgents rides along only when some pair is set — its
  // `omitempty` (internal/settings/settings.go:549) leaves the field out of
  // an empty map.
  const stateReply = (clientAgents) => {
    const body = {
      version: 'v0.1.1290',
      dir: '~/.config/magpie',
      gateway: 'http://magpie.test:3425',
      builtins: [],
      jsRoutings: [],
    };
    if (clientAgents !== undefined) body.clientAgents = clientAgents;
    return body;
  };

  const fakeFetch = (reply = stateReply({ k: 'lobehub' }), status = 200, asText = false) => {
    const calls = [];
    const text = asText ? String(reply) : JSON.stringify(reply);
    const fn = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => JSON.parse(text),
        text: async () => text,
      };
    };
    fn.calls = calls;
    return fn;
  };

  // ---- arguments ---------------------------------------------------------

  const defaults = parseArgs([], { MAGPIE_WEB_URL: URL_ });
  check(defaults.apply === false, 'parseArgs: --apply is off by default', JSON.stringify(defaults.apply));
  check(defaults.client === 'k' && defaults.as === 'lobehub', 'parseArgs: the default mapping is k → lobehub', `${defaults.client} → ${defaults.as}`);
  check(Array.isArray(defaults.errors) && defaults.errors.length === 0, 'parseArgs: no errors without arguments', (defaults.errors || []).join('; '));
  check(defaults.cookieName === 'magpie_web_3430', 'parseArgs: the cookie name is derived from the port by default', defaults.cookieName);

  check(parseArgs(['--apply', '--dry-run'], { MAGPIE_WEB_URL: URL_ }).errors.length > 0, 'parseArgs refuses --apply together with --dry-run');
  check(parseArgs(['--nope'], { MAGPIE_WEB_URL: URL_ }).errors.length > 0, 'parseArgs refuses an unknown flag');

  // a root slash is the page itself; anything below it is a different page,
  // which new URL() would silently drop
  check(parseArgs([], { MAGPIE_WEB_URL: URL_ + '/' }).errors.length === 0, 'parseArgs accepts the root "/"');
  check(parseArgs([], { MAGPIE_WEB_URL: URL_ + '/magpie' }).errors.length > 0, 'parseArgs refuses a base URL below the root');

  const noPath = await run({ argv: [], env: { MAGPIE_WEB_URL: URL_ + '/magpie' }, fetchImpl: fakeFetch(), log: quiet });
  check(noPath.ok === false, 'run refuses a base URL below the root before sending');

  const creds = await run({ argv: [], env: { MAGPIE_WEB_URL: 'http://user:pw@magpie.test:3430' }, fetchImpl: fakeFetch(), log: quiet });
  check(creds.ok === false, 'run refuses a base URL carrying credentials');

  const scheme = await run({ argv: [], env: { MAGPIE_WEB_URL: 'ftp://magpie.test:3430' }, fetchImpl: fakeFetch(), log: quiet });
  check(scheme.ok === false, 'run refuses a non-http(s) base URL');

  // magpie's own agent ids are ^[a-z0-9][a-z0-9._-]{0,63}$ and the agent it
  // is given must be one (countClient: usage.IsAgent), so --as is lowered
  // and held to that shape
  const asUpper = parseArgs(['--as', 'LobeHub'], { MAGPIE_WEB_URL: URL_ });
  check(asUpper.errors.length === 0 && asUpper.as === 'lobehub', 'parseArgs lower-cases --as', asUpper.as);
  for (const bad of ['lobe hub', 'LobeHub!', '-lobe', 'lobe/hub']) {
    const f = fakeFetch();
    const r = await run({ argv: ['--apply', '--as', bad], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: f, log: quiet });
    check(r.ok === false && f.calls.length === 0, `run refuses the agent ${JSON.stringify(bad)} before sending`);
  }

  // the page's key is 16+ of letters, digits, - . _ ~ (MAGPIE_WEB_KEY)
  for (const bad of ['abc def', 'abc=def', 'abc;def', 'abc"def']) {
    const f = fakeFetch();
    const r = await run({ argv: ['--apply'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: bad }, fetchImpl: f, log: quiet });
    check(r.ok === false && f.calls.length === 0, `run refuses the key ${JSON.stringify(bad)} before sending`);
  }

  // magpie's countClient refuses clients that are agents themselves, the
  // nameless "other" and magpie's own calls (internal/gui/api.go:2473-2495)
  for (const client of ['other', 'magpie', 'Magpie-router', 'lobehub']) {
    const f = fakeFetch();
    const r = await run({ argv: ['--apply', '--client', client], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: f, log: quiet });
    check(r.ok === false && f.calls.length === 0, `run refuses client ${JSON.stringify(client)} before sending`);
  }

  const noKeyFetch = fakeFetch();
  const noKey = await run({ argv: ['--apply', '--url', URL_], env: {}, fetchImpl: noKeyFetch, log: quiet });
  check(noKey.ok === false, 'run --apply without a key fails', JSON.stringify(noKey.errors || noKey.error));
  check(noKeyFetch.calls.length === 0, 'run --apply without a key sends nothing', `${noKeyFetch.calls.length} call(s)`);

  // ---- the default: a preview, and nothing sent --------------------------

  const previewFetch = fakeFetch();
  const preview = await run({ argv: [], env: { MAGPIE_WEB_URL: URL_ }, fetchImpl: previewFetch, log: quiet });
  check(previewFetch.calls.length === 0, 'run without --apply sends no request', `${previewFetch.calls.length} call(s)`);
  check(preview.ok === true && preview.applied === false, 'run without --apply reports a preview, not a write', JSON.stringify({ ok: preview.ok, applied: preview.applied }));

  // ---- the request ------------------------------------------------------

  const applyFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const lines = [];
  const applied = await run({
    argv: ['--apply'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: applyFetch,
    log: (l) => lines.push(l),
  });
  check(applied.ok === true && applied.applied === true, 'run --apply sends the mapping', JSON.stringify({ ok: applied.ok, applied: applied.applied, errors: applied.errors }));
  check(applyFetch.calls.length === 1, 'run --apply sends exactly one request', `${applyFetch.calls.length} call(s)`);

  const sent = applyFetch.calls[0] || { url: '', init: { headers: {}, body: '' } };
  check(sent.url === URL_ + ARRANGE_PATH, 'the request goes to <base>/api/usage/arrange', sent.url);
  check(sent.init.method === 'POST', 'the request is a POST', sent.init.method);
  check(sent.init.body === JSON.stringify({ count: { client: 'k', as: 'lobehub' } }), 'the body is {"count":{"client":"k","as":"lobehub"}}', sent.init.body);
  check(
    String(sent.init.headers?.cookie || sent.init.headers?.Cookie || '') === `magpie_web_3430=${KEY}`,
    'the key rides in the page cookie named for the port',
    String(sent.init.headers?.cookie || sent.init.headers?.Cookie || '').replace(KEY, '<key>'),
  );
  check(
    String(sent.init.headers?.['content-type'] || sent.init.headers?.['Content-Type'] || '').startsWith('application/json'),
    'the request declares a JSON body',
  );
  check(applied.confirmed === true, 'run --apply reads the answer back and confirms the mapping', JSON.stringify(applied.clientAgents));
  check(lines.join('\n').includes(ORIGIN), 'a successful apply names the target origin');
  check(!lines.join('\n').includes(KEY), 'a successful apply never prints the key');

  // the client is kept as typed; magpie lower-cases the key it stores
  // (internal/settings/settings.go:1514-1531) and ReportedAs looks up by
  // that lower-cased name, so confirmation must too
  const upperFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const upper = await run({
    argv: ['--apply', '--client', 'K'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: upperFetch,
    log: quiet,
  });
  check(
    upperFetch.calls[0]?.init?.body === JSON.stringify({ count: { client: 'K', as: 'lobehub' } }),
    '--client K keeps the case it was given in the body',
    upperFetch.calls[0]?.init?.body,
  );
  check(upper.ok === true && upper.confirmed === true, 'a pair stored under the lower-cased client confirms --client K', JSON.stringify(upper.clientAgents));

  // a reverse proxy's cookie name is the one magpie itself set, which is
  // named for the port magpie listens on, not the port the browser saw
  const overFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const over = await run({
    argv: ['--apply', '--cookie-name', 'magpie_web_8080'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: overFetch,
    log: quiet,
  });
  check(
    overFetch.calls[0]?.init?.headers?.cookie === `magpie_web_8080=${KEY}`,
    '--cookie-name overrides the name derived from the URL',
    String(overFetch.calls[0]?.init?.headers?.cookie || '').replace(KEY, '<key>'),
  );
  check(over.ok === true, 'the override is what authenticates');
  check(
    buildRequest({ baseUrl: URL_, key: KEY }).headers.cookie === `magpie_web_3430=${KEY}`,
    'without the flag the name is still derived from the port',
  );
  check(parseArgs(['--cookie-name', 'bad name'], { MAGPIE_WEB_URL: URL_ }).errors.length > 0, 'parseArgs refuses a cookie name that is not a token');

  // ---- confirmation, and the undo shapes it must not mistake for success --

  const bare = fakeFetch({});
  const bareRun = await run({ argv: ['--apply'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: bare, log: quiet });
  check(bareRun.ok === false && bareRun.confirmed === false, 'apply does not succeed on a bare {}');

  const noMap = fakeFetch(stateReply());
  const noMapRun = await run({ argv: ['--apply'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: noMap, log: quiet });
  check(noMapRun.ok === false && noMapRun.confirmed === false, 'apply does not succeed when clientAgents is absent');

  const undoAbsentFetch = fakeFetch(stateReply());
  const undoAbsent = await run({
    argv: ['--apply', '--undo'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: undoAbsentFetch,
    log: quiet,
  });
  check(
    undoAbsentFetch.calls[0]?.init?.body === JSON.stringify({ count: { client: 'k', as: '' } }),
    '--undo sends as "" (count it on its own again)',
    undoAbsentFetch.calls[0]?.init?.body,
  );
  check(
    undoAbsent.ok === true && undoAbsent.confirmed === true,
    'undo succeeds on a settings state whose clientAgents is omitted (omitempty)',
    JSON.stringify({ ok: undoAbsent.ok, confirmed: undoAbsent.confirmed }),
  );

  const undoBareFetch = fakeFetch({});
  const undoBare = await run({ argv: ['--apply', '--undo'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: undoBareFetch, log: quiet });
  check(undoBare.ok === false && undoBare.confirmed === false, 'undo does not succeed on a bare {} (no settings state)');

  const undoTextFetch = fakeFetch('ok', 200, true);
  const undoText = await run({ argv: ['--apply', '--undo'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: undoTextFetch, log: quiet });
  check(undoText.ok === false && undoText.confirmed === false, 'undo does not succeed on a non-JSON body');

  const undoStillFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const undoStill = await run({ argv: ['--apply', '--undo'], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: undoStillFetch, log: quiet });
  check(undoStill.ok === false && undoStill.confirmed === false, 'undo does not succeed while the pair is still listed');

  const undoUpperFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const undoUpper = await run({
    argv: ['--apply', '--undo', '--client', 'K'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: undoUpperFetch,
    log: quiet,
  });
  check(undoUpper.ok === false, 'undo reads the lower-cased key too, so a pair under k is not missed');

  // an error answer is never a success, and it says where it failed
  const failLines = [];
  const failFetch = fakeFetch('no such route', 404, true);
  const failed = await run({
    argv: ['--apply'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: failFetch,
    log: (l) => failLines.push(l),
  });
  check(failed.ok === false && failed.confirmed === undefined, 'a 404 is a failure');
  check(failLines.join('\n').includes(ORIGIN), 'a failed apply names the target origin');
  check(!failLines.join('\n').includes(KEY), 'a failed apply never prints the key');

  // ---- --flag=value, and nothing secret in a message ---------------------

  const eq = parseArgs(
    ['--url=' + URL_, '--key=' + KEY, '--client=K', '--as=LobeHub', '--cookie-name=magpie_web_3430'],
    {},
  );
  check(eq.errors.length === 0, 'parseArgs reads --flag=value', (eq.errors || []).join('; '));
  check(
    eq.key === KEY && eq.client === 'K' && eq.as === 'lobehub' && eq.baseUrl === URL_,
    'the values after = are the ones taken',
    JSON.stringify({ client: eq.client, as: eq.as }),
  );
  check(eq.cookieName === 'magpie_web_3430', '--cookie-name=value is read too', eq.cookieName);

  const eqFetch = fakeFetch(stateReply({ k: 'lobehub' }));
  const eqApply = await run({ argv: ['--apply', '--key=' + KEY], env: { MAGPIE_WEB_URL: URL_ }, fetchImpl: eqFetch, log: quiet });
  check(eqApply.ok === true, '--key=value authenticates like --key value');
  check(eqFetch.calls[0]?.init?.headers?.cookie === `magpie_web_3430=${KEY}`, 'the value after = becomes the cookie');

  check(parseArgs(['--key='], { MAGPIE_WEB_URL: URL_ }).errors.length > 0, 'an empty --key= is refused');

  // a value typed after = never comes back, whatever the flag is
  // a value that must never come back: named so a stray copy is greppable
  const VALUE = 'leaked-if-printed-0123456789';
  const unknownLines = [];
  const unknownRun = await run({
    argv: ['--nope=' + VALUE],
    env: { MAGPIE_WEB_URL: URL_ },
    fetchImpl: fakeFetch(),
    log: (l) => unknownLines.push(l),
  });
  check(unknownRun.ok === false, 'an unknown --flag=value is refused');
  check(!unknownLines.join('\n').includes(VALUE), 'a refused value never reaches the output');
  check(unknownLines.join('\n').includes('--nope'), 'the refusal still names the flag');

  const mixedLines = [];
  const mixedRun = await run({
    argv: ['--key=' + VALUE, '--nope'],
    env: { MAGPIE_WEB_URL: URL_ },
    fetchImpl: fakeFetch(),
    log: (l) => mixedLines.push(l),
  });
  check(mixedRun.ok === false && !mixedLines.join('\n').includes(VALUE), 'a parsed key stays out of another argument\'s error');

  const bareLines = [];
  const barePos = await run({ argv: [VALUE], env: { MAGPIE_WEB_URL: URL_ }, fetchImpl: fakeFetch(), log: (l) => bareLines.push(l) });
  check(barePos.ok === false && !bareLines.join('\n').includes(VALUE), 'a value where a flag belongs is not echoed back');

  // --json answers refused arguments with JSON too, and no key in it
  const jsonLines = [];
  const jsonRun = await run({
    argv: ['--json', '--apply', '--key=' + VALUE],
    env: {},
    fetchImpl: fakeFetch(),
    log: (l) => jsonLines.push(l),
  });
  check(jsonRun.ok === false, '--json with refused arguments fails');
  let jsonErr = null;
  try {
    jsonErr = JSON.parse(jsonLines.join('\n'));
  } catch {
    jsonErr = null;
  }
  check(
    jsonErr !== null && jsonErr.ok === false && Array.isArray(jsonErr.errors),
    '--json prints one machine-readable error object',
    jsonLines.join(' ').slice(0, 120),
  );
  check(!jsonLines.join('\n').includes(VALUE), 'the machine-readable error carries no key');

  // undo reports what the answer shows, not that a write happened
  const undoWordLines = [];
  const undoWord = await run({
    argv: ['--apply', '--undo'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: fakeFetch(stateReply()),
    log: (l) => undoWordLines.push(l),
  });
  check(
    undoWord.ok === true && undoWordLines.join('\n').includes('no mapping'),
    'undo reports that no mapping is shown now',
    undoWordLines.join(' ').slice(0, 120),
  );

  // ---- a switch is a switch: no =value, and never a silent ignore --------

  const switchCases = [
    ['--apply', 'false'],
    ['--apply', '0'],
    ['--apply', 'true'],
    ['--undo', 'false'],
    ['--dry-run', '0'],
  ];
  for (const [flag, v] of switchCases) {
    const f = fakeFetch();
    const r = await run({ argv: [`${flag}=${v}`], env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY }, fetchImpl: f, log: quiet });
    check(r.ok === false && f.calls.length === 0, `${flag}=${v} is refused and sends nothing`);
  }

  const applyFalse = parseArgs(['--apply=false'], { MAGPIE_WEB_URL: URL_ });
  check(applyFalse.errors.length > 0 && applyFalse.apply === false, '--apply=false does not turn into a write');

  const undoFalse = parseArgs(['--undo=false'], { MAGPIE_WEB_URL: URL_ });
  check(undoFalse.errors.length > 0 && undoFalse.undo === false, '--undo=false does not turn into an undo');

  const switchLines = [];
  const switchRun = await run({
    argv: ['--apply=' + VALUE],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: fakeFetch(),
    log: (l) => switchLines.push(l),
  });
  check(switchRun.ok === false && !switchLines.join('\n').includes(VALUE), 'a value on a switch is refused without echoing it');

  const jsonSwitchLines = [];
  const jsonSwitch = await run({
    argv: ['--json', '--apply=false'],
    env: { MAGPIE_WEB_URL: URL_, MAGPIE_WEB_KEY: KEY },
    fetchImpl: fakeFetch(),
    log: (l) => jsonSwitchLines.push(l),
  });
  let jsonSwitchDoc = null;
  try {
    jsonSwitchDoc = JSON.parse(jsonSwitchLines.join('\n'));
  } catch {
    jsonSwitchDoc = null;
  }
  check(
    jsonSwitch.ok === false && jsonSwitchDoc !== null && jsonSwitchDoc.ok === false && Array.isArray(jsonSwitchDoc.errors),
    '--json reports a switch misuse as JSON too',
    jsonSwitchLines.join(' ').slice(0, 120),
  );
  check(!jsonSwitchLines.join('\n').includes('=false'), 'the JSON error repeats no value');

  // ---- an address is never echoed back -----------------------------------
  //
  // A pasted link carries ?k=<MAGPIE_WEB_KEY>, so the message for an address
  // that does not parse must be fixed text, not the address.

  const urlLeakLines = [];
  const urlLeak = await run({
    argv: ['--url=not a url/?k=' + KEY],
    env: {},
    fetchImpl: fakeFetch(),
    log: (l) => urlLeakLines.push(l),
  });
  check(urlLeak.ok === false, 'an address that does not parse is refused');
  check(!urlLeakLines.join('\n').includes(KEY), 'the refused address is not echoed (it may carry ?k=)');

  const queryLeakLines = [];
  const queryLeak = await run({
    argv: ['--url=' + URL_ + '/?k=' + KEY],
    env: {},
    fetchImpl: fakeFetch(),
    log: (l) => queryLeakLines.push(l),
  });
  check(queryLeak.ok === false && !queryLeakLines.join('\n').includes(KEY), 'an address carrying ?k= is refused without repeating the key');

  // ---- the key magpie itself would take ----------------------------------
  //
  // MAGPIE_WEB_KEY is 16 or more characters (main.go), and the value is never
  // repeated: a short key is refused by its length alone.

  const shortKey = parseArgs(['--apply', '--key=short-key'], { MAGPIE_WEB_URL: URL_ });
  check(shortKey.errors.length > 0, 'a key shorter than 16 characters is refused');
  check(!shortKey.errors.join(' ').includes('short-key'), 'the short key is not echoed');
  check(parseArgs(['--apply', '--key=0123456789abcdef'], { MAGPIE_WEB_URL: URL_ }).errors.length === 0, 'a 16-character key is accepted');
  check(parseArgs(['--apply', '--key=' + KEY], { MAGPIE_WEB_URL: URL_ }).errors.length === 0, 'the fixture key is accepted');

  // ---- the key stays off the wire's readable parts ----------------------

  const req = buildRequest({ baseUrl: URL_, key: KEY, client: 'k', as: 'lobehub' });
  check(!req.url.includes(KEY), 'the key never appears in the URL');
  check(!req.body.includes(KEY), 'the key never appears in the body');
  check(
    Object.keys(req.headers).some((h) => h.toLowerCase() === 'cookie' && req.headers[h].includes(KEY)),
    'the key appears only in the cookie header',
  );

  // ---- the tool's own hygiene -------------------------------------------

  const toolSrc = readFileSync(toolFile, 'utf8');
  check(!/https?:\/\//.test(toolSrc), 'the tool bakes in no URL');
  check(!/127\.0\.0\.1|localhost/i.test(toolSrc), 'the tool bakes in no default host');
  check(!/from\s*['"]node:fs['"]|require\(\s*['"]fs['"]\s*\)/.test(toolSrc), 'the tool writes nothing to disk (no fs)');
  check(!/process\.env\.\w+\s*=/.test(toolSrc), 'the tool sets no environment variables');
}
// ---- summary -------------------------------------------------------------

console.log('');
if (failed === 0) {
  console.log('all checks passed');
} else {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}