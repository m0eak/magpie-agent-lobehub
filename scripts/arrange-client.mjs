#!/usr/bin/env node
// arrange-client.mjs — count one client as one of magpie's agents, for the
// Usage and Sessions pages only.
//
// magpie records every request under the client its User-Agent names
// (usage.AgentOf: the product token, lower-cased). settings.ClientAgents
// then maps a client magpie doesn't know to an agent it does, and that
// mapping is read back by usage.ReportedAs — the Usage page's agents list,
// its sessions, its filters and the ledger's rows. The gateway's own
// decisions do not read it: routing, caller keys, the model catalogue an
// agent is shown and its caps and budgets all go on by AgentOf. So a
// gateway that sends "k" keeps its identity everywhere it matters, and the
// two pages show it as the agent named here.
//
// This tool speaks magpie's own API, the one the Usage page's row menu
// calls, so nothing is written behind a running magpie's back:
//
//   POST /api/usage/arrange {"count":{"client":"k","as":"lobehub"}}
//
// Nothing is sent unless --apply is given. The address and the key come
// from the environment (or from flags), never from this file, and never
// reach the disk.
//
//   MAGPIE_WEB_URL   the address `magpie web` printed, without its ?k= part
//   MAGPIE_WEB_KEY   the key it printed there (or the one in MAGPIE_WEB_KEY)
//
// Usage:
//   node scripts/arrange-client.mjs                 # preview, sends nothing
//   node scripts/arrange-client.mjs --apply         # k is counted as LobeHub
//   node scripts/arrange-client.mjs --apply --undo  # k counts on its own again

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARRANGE_PATH = '/api/usage/arrange';
export const DEFAULT_CLIENT = 'k';
export const DEFAULT_AS = 'lobehub';
export const URL_ENV = 'MAGPIE_WEB_URL';
export const KEY_ENV = 'MAGPIE_WEB_KEY';

// The page's sign-in cookie is named for the port it listens on
// (internal/gui/web.go: webHandler(port, …) -> webGuard("magpie_web_"+port)).
const COOKIE_PREFIX = 'magpie_web_';

const HELP = `Count a client as one of magpie's agents, on the Usage and Sessions
pages only. Routing, caller keys, model caps and budgets are not touched.

  --apply            send the request (without it this only prints it)
  --dry-run          print the request (the default; refuses with --apply)
  --client <name>    the client as magpie's ledger records it (default: k)
  --as <agent>       the agent to count it as (default: lobehub)
  --undo             count the client on its own again (as "")
  --url <url>        the page's address, without ?k= (or ${URL_ENV})
  --key <key>        the page's key (or ${KEY_ENV}; prefer the variable)
  --json             print the answer as JSON
  --help             this text

The agent must be one magpie knows, so install and enable the LobeHub
agent plugin first: magpie refuses an agent it has no row for.

Exit codes: 0 done (or a preview), 1 the request failed or did not take,
2 the arguments were refused and nothing was sent.`;

// parseArgs reads the command line and the environment into one object. It
// never touches the network and never mutates its inputs; every problem
// lands in `errors`, so a caller can report all of them at once.
export function parseArgs(argv = [], env = {}) {
  const opts = {
    help: false,
    apply: false,
    undo: false,
    json: false,
    client: DEFAULT_CLIENT,
    as: DEFAULT_AS,
    baseUrl: typeof env[URL_ENV] === 'string' ? env[URL_ENV].trim() : '',
    key: typeof env[KEY_ENV] === 'string' ? env[KEY_ENV].trim() : '',
    keyFrom: typeof env[KEY_ENV] === 'string' && env[KEY_ENV].trim() !== '' ? 'env' : '',
    errors: [],
  };
  const err = (why) => opts.errors.push(why);
  let dryRun = false;
  let asGiven = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (flag) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        err(`${flag} needs a value`);
        return null;
      }
      i++;
      return v;
    };
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true;
        return opts;
      case '--apply':
        opts.apply = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--undo':
        opts.undo = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--client': {
        const v = need(a);
        if (v !== null) opts.client = v.trim();
        break;
      }
      case '--as': {
        const v = need(a);
        if (v !== null) {
          opts.as = v.trim();
          asGiven = true;
        }
        break;
      }
      case '--url': {
        const v = need(a);
        if (v !== null) opts.baseUrl = v.trim();
        break;
      }
      case '--key': {
        const v = need(a);
        if (v !== null) {
          opts.key = v.trim();
          opts.keyFrom = 'flag';
        }
        break;
      }
      default:
        err(`unknown argument ${JSON.stringify(a)} (try --help)`);
    }
  }

  if (opts.apply && dryRun) err('--apply and --dry-run contradict each other');
  if (opts.undo && asGiven) err('--undo and --as contradict each other');
  if (opts.undo) opts.as = '';

  // magpie trims and lower-cases the client, and refuses a client that is
  // an agent itself, the nameless "other" and its own calls
  // (internal/gui/api.go countClient).
  const client = opts.client;
  if (!client) err('--client needs a name');
  else if (/\s|\//.test(client)) err(`client ${JSON.stringify(client)} cannot hold a space or a slash`);
  else if (client === 'other') err('"other" is the calls that named no client: magpie counts those on their own');
  else if (/^magpie/i.test(client)) err(`client ${JSON.stringify(client)} is magpie's own call: magpie counts those on their own`);

  if (!opts.undo) {
    if (!opts.as) err('--as needs an agent id (or --undo)');
    else if (/\s/.test(opts.as)) err(`agent ${JSON.stringify(opts.as)} cannot hold a space`);
    else if (opts.as === client) err(`client ${JSON.stringify(client)} is that agent already: the mapping would say nothing`);
  }

  if (!opts.baseUrl) {
    err(`no address: pass --url or set ${URL_ENV} to the address the page printed`);
  } else {
    let u = null;
    try {
      u = new URL(opts.baseUrl);
    } catch {
      err(`--url / ${URL_ENV} is not an address magpie can serve: ${JSON.stringify(opts.baseUrl)}`);
    }
    if (u) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') err(`the address must be http or https, not ${u.protocol}`);
      if (u.username || u.password) err('the address carries credentials: give the key through the cookie, not the address');
      if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
        err('the address is the page itself: no path, no ?k=, no #');
      }
    }
  }

  if (opts.apply && !opts.key) err(`--apply needs the page's key: set ${KEY_ENV} or pass --key`);

  return opts;
}

// buildCount is the body magpie's POST /api/usage/arrange reads: one
// client counted as one agent, "" counting it on its own again.
export function buildCount(client = DEFAULT_CLIENT, as = DEFAULT_AS) {
  return { count: { client, as } };
}

// buildRequest is the request that body goes in. The key rides in the
// page's sign-in cookie, named for the port the page listens on, so it is
// never part of a URL that a log or a shell history could keep.
export function buildRequest({ baseUrl, key = '', client = DEFAULT_CLIENT, as = DEFAULT_AS }) {
  const u = new URL(ARRANGE_PATH, baseUrl);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (key) headers.cookie = `${COOKIE_PREFIX}${port}=${key}`;
  return {
    url: u.href,
    method: 'POST',
    headers,
    body: JSON.stringify(buildCount(client, as)),
  };
}

const say = (log, line) => log(line);

// run is the whole tool: parse, say what it would do, and only with
// --apply send it. `fetchImpl` and `log` are injectable so a test can see
// exactly what would leave the process.
export async function run({ argv = [], env = {}, fetchImpl, log = console.log } = {}) {
  const opts = parseArgs(argv, env);
  if (opts.help) {
    say(log, HELP);
    return { ok: true, help: true, applied: false, opts };
  }
  if (opts.errors.length > 0) {
    for (const e of opts.errors) say(log, `refused: ${e}`);
    say(log, 'nothing was sent.');
    return { ok: false, applied: false, errors: opts.errors, opts };
  }

  const request = buildRequest({
    baseUrl: opts.baseUrl,
    key: opts.key,
    client: opts.client,
    as: opts.as,
  });
  const auth = opts.key
    ? `${COOKIE_PREFIX}${new URL(request.url).port || 'default'}=<key from ${opts.keyFrom === 'env' ? KEY_ENV : '--key'}, ${opts.key.length} chars>`
    : 'no key set (a preview needs none; --apply does)';

  if (!opts.apply) {
    if (opts.json) {
      say(log, JSON.stringify({ applied: false, dryRun: true, request: { ...request, headers: { ...request.headers, cookie: undefined } } }, null, 2));
    } else {
      say(log, 'dry run — nothing was sent');
      say(log, `  POST  ${request.url}`);
      say(log, `  body  ${request.body}`);
      say(log, `  auth  ${auth}`);
      say(log, '');
      say(log, `add --apply to send it (${opts.client} → ${opts.as || 'on its own'})`);
    }
    return { ok: true, applied: false, dryRun: true, request, opts };
  }

  let res;
  try {
    res = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  } catch (e) {
    say(log, `failed: ${e && e.message ? e.message : e}`);
    return { ok: false, applied: true, error: String(e && e.message ? e.message : e), request, opts };
  }

  const text = typeof res.text === 'function' ? await res.text() : '';
  if (!res.ok) {
    say(log, `failed: magpie answered ${res.status}${text ? ` — ${text.slice(0, 400)}` : ''}`);
    return { ok: false, applied: true, status: res.status, error: text, request, opts };
  }

  let answer = null;
  try {
    answer = text ? JSON.parse(text) : null;
  } catch {
    answer = null;
  }
  const clientAgents = (answer && answer.clientAgents) || {};
  const confirmed = opts.as === '' ? clientAgents[opts.client] === undefined : clientAgents[opts.client] === opts.as;

  if (opts.json) {
    say(log, JSON.stringify({ applied: true, status: res.status, confirmed, clientAgents }, null, 2));
  } else if (confirmed) {
    say(log, opts.as === ''
      ? `applied — ${opts.client} counts on its own again`
      : `applied — ${opts.client} is counted as ${opts.as} on the Usage and Sessions pages`);
    say(log, '  routing, caller keys, the models an agent is shown and its caps and budgets are unchanged');
  } else {
    say(log, `sent, but the settings that came back do not show it: ${JSON.stringify(clientAgents)}`);
    say(log, '  check that the agent exists (install and enable the LobeHub agent plugin) and that this magpie has ClientAgents');
  }

  return { ok: confirmed, applied: true, status: res.status, confirmed, clientAgents, request, opts };
}

// The command line, when this file is the program. Everything above is
// importable without a side effect, which is what the selfcheck leans on.
const invoked = process.argv[1] || '';
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked)) {
  const out = await run({ argv: process.argv.slice(2), env: process.env, fetchImpl: globalThis.fetch });
  const code = out.help ? 0 : out.ok ? 0 : out.errors ? 2 : 1;
  process.exitCode = code;
}
