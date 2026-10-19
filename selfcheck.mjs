#!/usr/bin/env node
// selfcheck.mjs — a static check of this plugin, runnable without magpie
// and without `npm install`: Node's standard library only.
//
// It re-implements the rules magpie applies, from its source:
//   internal/agentplug/agentplug.go   Desc.check()  — id, config, format,
//                                     model-or-connect, ua lower-cased
//   internal/plugin/agent.go          magpie.agent, agent-only package
//   internal/provider/plugin_icon.go  a data:image/ URI
//   internal/provider/icon.go         MaxIcon, SVG sniffing
//   internal/usage/usage.go           AgentOf() — name, then ua prefix
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
check(
  JSON.stringify(agent.ua) === JSON.stringify(['lobehub']),
  'the only ua rule is the "lobehub" prefix',
  JSON.stringify(agent.ua),
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

// ---- the icon ------------------------------------------------------------

const icon = agent.icon;
check(typeof icon === 'string' && /^data:image\//i.test(icon), 'agent.icon is a data:image URI');
const comma = typeof icon === 'string' ? icon.indexOf(',') : -1;
const meta = comma > 0 ? icon.slice('data:'.length, comma) : '';
const payload = comma > 0 ? icon.slice(comma + 1) : '';
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
  bytes !== null && bytes.subarray(0, 1024).toString('utf8').toLowerCase().includes('<svg'),
  'icon sniffs as SVG (magpie looks for "<svg" in the first 1024 bytes)',
);

const svgFile = join(here, 'assets', 'icon.svg');
if (!existsSync(svgFile)) {
  bad('assets/icon.svg is the source of the embedded icon', 'missing');
} else {
  const svg = readFileSync(svgFile);
  const same = bytes !== null && svg.equals(bytes);
  check(same, 'the embedded icon is exactly assets/icon.svg');
  if (!same) {
    console.log(`     assets/icon.svg is ${svg.length} bytes; paste this into agent.js:`);
    console.log(`     ${svg.toString('base64')}`);
  }
  const text = svg.toString('utf8');
  check(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(text) && /viewBox="/.test(text), 'icon SVG has xmlns and viewBox');
}

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
  ['lobechat/1.0', 'lobechat'],
  ['curl/8.5.0', 'curl'],
];
for (const [ua, want] of cases) {
  const got = agentOf(ua);
  check(got === want, `UA ${JSON.stringify(ua)} is named ${JSON.stringify(want)}`, got === want ? '' : `got ${JSON.stringify(got)}`);
}

// ---- summary -------------------------------------------------------------

console.log('');
if (failed === 0) {
  console.log('all checks passed');
} else {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
