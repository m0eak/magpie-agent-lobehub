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
//
// A success is never assumed from a 2xx alone: the answer must be magpie's
// settings state (version, dir and gateway: internal/gui/api.go:346-350)
// and it must show the pair, or for --undo show it gone. A body that is
// not that state is reported as unconfirmed, and the GUI says what it did.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARRANGE_PATH = '/api/usage/arrange';
export const DEFAULT_CLIENT = 'k';
export const DEFAULT_AS = 'lobehub';
export const URL_ENV = 'MAGPIE_WEB_URL';
export const KEY_ENV = 'MAGPIE_WEB_KEY';

// The page's sign-in cookie is named for the port it listens on
// (internal/gui/web.go: webHandler(port, …) -> webGuard("magpie_web_"+port)).
// Behind a reverse proxy that is the port magpie itself listens on, not the
// one the browser used, so --cookie-name can name it outright.
const COOKIE_PREFIX = 'magpie_web_';

// magpie's own shapes: an agent id (internal/agentplug idOK), the key its
// page takes (MAGPIE_WEB_KEY: 16+ letters, digits, - . _ ~), and a cookie
// name, which is an RFC 6265 token.
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY_OK = /^[A-Za-z0-9._~-]+$/;
const COOKIE_NAME_OK = /^[A-Za-z0-9_.-]+$/;
const KEY_MIN = 16; // MAGPIE_WEB_KEY: 16 or more (internal/cli/main.go)

const HELP = `Count a client as one of magpie's agents, on the Usage and Sessions
pages only. Routing, caller keys, model caps and budgets are not touched.

  --apply            send the request (without it this only prints it)
  --dry-run          print the request (the default; refuses with --apply)
  --client <name>    the client as magpie's ledger records it (default: k)
  --as <agent>       the agent to count it as (default: lobehub); lower-cased
  --undo             count the client on its own again (as "")
  --url <url>        the page's address, without ?k= (or ${URL_ENV})
  --key <key>        the page's key, 16+ of letters, digits, - . _ ~
                     (or ${KEY_ENV}; prefer the variable)
  --cookie-name <n>  the sign-in cookie's name, when a proxy hides the port
                     magpie listens on (default: magpie_web_<url port>)
  --flag=<value>     every flag also takes =value; a value after = is never
                     echoed, so --key=<key> is safe here
  --json             print the answer as JSON
  --help             this text

The agent must be one magpie knows, so install and enable the LobeHub
agent plugin first: magpie refuses an agent it has no row for.

The switches — --apply, --dry-run, --undo, --json, --help — take no
value: --apply=false is refused, not read as "do not".

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
    cookieName: '',
    errors: [],
  };
  const err = (why) => opts.errors.push(why);
  let dryRun = false;
  let asGiven = false;
  let cookieFlag = '';

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    // --flag=value: the split happens here so what followed = never reaches
    // a message — it may be a key someone pasted
    let a = raw;
    let inline;
    if (raw.startsWith('--')) {
      const eq = raw.indexOf('=');
      if (eq > 2) {
        a = raw.slice(0, eq);
        inline = raw.slice(eq + 1);
      }
    }
    const need = (flag) => {
      if (inline !== undefined) {
        if (inline === '') {
          err(`${flag} needs a value`);
          return null;
        }
        return inline;
      }
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        err(`${flag} needs a value`);
        return null;
      }
      i++;
      return v;
    };
    switch (a) {
      // a switch is a switch: --apply=false is neither "no" nor "yes", and
      // guessing which one the caller meant is how a preview becomes a write
      case '--help':
      case '-h':
        if (inline !== undefined) {
          err(`${a} takes no value (it is a switch)`);
          break;
        }
        opts.help = true;
        return opts;
      case '--apply':
        if (inline !== undefined) err('--apply takes no value (it is a switch)');
        else opts.apply = true;
        break;
      case '--dry-run':
        if (inline !== undefined) err('--dry-run takes no value (it is a switch)');
        else dryRun = true;
        break;
      case '--undo':
        if (inline !== undefined) err('--undo takes no value (it is a switch)');
        else opts.undo = true;
        break;
      case '--json':
        if (inline !== undefined) err('--json takes no value (it is a switch)');
        else opts.json = true;
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
      case '--cookie-name': {
        const v = need(a);
        if (v !== null) cookieFlag = v.trim();
        break;
      }
      default: {
        // the flag alone when there is one: whatever followed an = could be
        // a key, and a value where a flag belongs is never echoed
        const shown = a.startsWith('--') ? JSON.stringify(a.split('=')[0]) : '(a value where a flag belongs)';
        err(`unknown argument ${shown} (try --help)`);
      }
    }
  }

  if (opts.apply && dryRun) err('--apply and --dry-run contradict each other');
  if (opts.undo && asGiven) err('--undo and --as contradict each other');

  const client = opts.client;
  opts.as = opts.undo ? '' : opts.as.trim().toLowerCase();

  // magpie trims and lower-cases the client, and refuses a client that is
  // an agent itself, the nameless "other" and its own calls
  // (internal/gui/api.go countClient).
  if (!client) err('--client needs a name');
  else if (/\s|\//.test(client)) err(`client ${JSON.stringify(client)} cannot hold a space or a slash`);
  else if (client === 'other') err('"other" is the calls that named no client: magpie counts those on their own');
  else if (/^magpie/i.test(client)) err(`client ${JSON.stringify(client)} is magpie's own call: magpie counts those on their own`);

  // The agent is stored as given but checked by usage.IsAgent, an exact
  // match against lowercase ids, so it is lower-cased here and held to the
  // id shape magpie uses.
  if (!opts.undo) {
    if (!opts.as) err('--as needs an agent id (or --undo)');
    else if (!AGENT_ID.test(opts.as)) {
      err(`agent ${JSON.stringify(opts.as)} is not a magpie agent id (lower-case letters, digits, . _ -, starting with one of the first two)`);
    } else if (client && opts.as === client.toLowerCase()) {
      err(`client ${JSON.stringify(client)} is that agent already: the mapping would say nothing`);
    }
  }

  // magpie's page key is 16+ of letters, digits, - . _ ~ (main.go); a key
  // that holds anything else is a copy/paste accident, not a key
  if (opts.key && !KEY_OK.test(opts.key)) {
    err(`the key holds something a key cannot: letters, digits, - . _ ~ only (${opts.key.length} chars given)`);
  } else if (opts.key && opts.key.length < KEY_MIN) {
    err(`the key is shorter than magpie's own: ${KEY_MIN} characters at least (${opts.key.length} given)`);
  }

  if (cookieFlag && !COOKIE_NAME_OK.test(cookieFlag)) {
    err(`--cookie-name ${JSON.stringify(cookieFlag)} is not a cookie name (letters, digits, . _ -)`);
  }

  if (!opts.baseUrl) {
    err(`no address: pass --url or set ${URL_ENV} to the address the page printed`);
  } else {
    let u = null;
    try {
      u = new URL(opts.baseUrl);
    } catch {
      // never the address itself: a pasted link carries ?k=<the page's key>
      err(`--url / ${URL_ENV} is not an address this tool can read: give the page's own address, without ?k=`);
    }
    if (u) {
      if (u.protocol !== 'http:' && u.protocol !== 'https:') err(`the address must be http or https, not ${u.protocol}`);
      if (u.username || u.password) err('the address carries credentials: give the key through the cookie, not the address');
      // the page itself is the root; a path below it would be dropped by
      // new URL() and the request would go somewhere else unannounced
      if ((u.pathname && u.pathname !== '/') || u.search || u.hash) {
        err('the address is the page itself: the root only, with no ?k= and no #');
      }
      const port = u.port || (u.protocol === 'https:' ? '443' : '80');
      opts.cookieName = cookieFlag || COOKIE_PREFIX + port;
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
export function buildRequest({ baseUrl, key = '', client = DEFAULT_CLIENT, as = DEFAULT_AS, cookieName = '' }) {
  const u = new URL(ARRANGE_PATH, baseUrl);
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (key) headers.cookie = `${cookieName || COOKIE_PREFIX + port}=${key}`;
  return {
    url: u.href,
    method: 'POST',
    headers,
    body: JSON.stringify(buildCount(client, as)),
  };
}

// isSettingsState is what magpie answers a settings write with: settingsState()
// (internal/gui/api.go settingsState), whose version, dir and gateway are
// always written — none of them is omitempty — unlike clientAgents, which an
// empty map leaves out (internal/settings/settings.go:549).
export function isSettingsState(answer) {
  return Boolean(answer)
    && typeof answer === 'object'
    && !Array.isArray(answer)
    && typeof answer.version === 'string' && answer.version !== ''
    && typeof answer.dir === 'string' && answer.dir !== ''
    && typeof answer.gateway === 'string' && answer.gateway !== '';
}

// readClientAgents separates "no pairs left" from "not an answer this tool
// can read": magpie writes no clientAgents at all when the map is empty, and
// Go writes a nil map as null, but anything else that is not an object is a
// malformed answer, never a silent success.
export function readClientAgents(state) {
  if (!Object.prototype.hasOwnProperty.call(state, 'clientAgents')) return { ok: true, map: null };
  const v = state.clientAgents;
  if (v === null) return { ok: true, map: null };
  if (typeof v === 'object' && !Array.isArray(v)) return { ok: true, map: v };
  return { ok: false, map: null };
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
    if (opts.json) {
      // the same machine-readable shape as every other --json answer
      say(log, JSON.stringify({ ok: false, applied: false, errors: opts.errors }, null, 2));
    } else {
      for (const e of opts.errors) say(log, `refused: ${e}`);
      say(log, 'nothing was sent.');
    }
    return { ok: false, applied: false, errors: opts.errors, opts };
  }

  const request = buildRequest({
    baseUrl: opts.baseUrl,
    key: opts.key,
    client: opts.client,
    as: opts.as,
    cookieName: opts.cookieName,
  });
  // scheme, host and port only: the address never carries credentials here
  const origin = new URL(request.url).origin;
  const auth = opts.key
    ? `${opts.cookieName}=<key from ${opts.keyFrom === 'env' ? KEY_ENV : '--key'}, ${opts.key.length} chars>`
    : 'no key set (a preview needs none; --apply does)';

  if (!opts.apply) {
    if (opts.json) {
      const shown = { ...request, headers: { ...request.headers, cookie: undefined } };
      say(log, JSON.stringify({ applied: false, dryRun: true, origin, request: shown }, null, 2));
    } else {
      say(log, 'dry run — nothing was sent');
      say(log, `  POST  ${request.url}`);
      say(log, `  body  ${request.body}`);
      say(log, `  auth  ${auth}`);
      say(log, '');
      say(log, `add --apply to send it (${opts.client} → ${opts.as || 'on its own'})`);
    }
    return { ok: true, applied: false, dryRun: true, request, origin, opts };
  }

  let res;
  try {
    res = await fetchImpl(request.url, { method: request.method, headers: request.headers, body: request.body });
  } catch (e) {
    const why = String(e && e.message ? e.message : e);
    say(log, `failed on ${origin}: ${why}`);
    return { ok: false, applied: true, error: why, request, origin, opts };
  }

  const text = typeof res.text === 'function' ? await res.text() : '';
  if (!res.ok) {
    say(log, `failed on ${origin}: magpie answered ${res.status}${text ? ` — ${text.slice(0, 400)}` : ''}`);
    return { ok: false, applied: true, status: res.status, error: text, request, origin, opts };
  }

  let answer = null;
  try {
    answer = text ? JSON.parse(text) : null;
  } catch {
    answer = null;
  }

  const state = isSettingsState(answer);
  const pairs = state ? readClientAgents(answer) : { ok: false, map: null };
  const lower = opts.client.toLowerCase();
  let confirmed = false;
  if (pairs.ok) {
    // the pair is stored under the lower-cased client (settings.clientAgents)
    // and reported back the same way, so the lookup lower-cases too
    if (opts.as === '') confirmed = pairs.map === null || pairs.map[lower] === undefined;
    else confirmed = pairs.map !== null && pairs.map[lower] === opts.as;
  }
  const clientAgents = pairs.map || {};

  if (opts.json) {
    say(log, JSON.stringify({ applied: true, status: res.status, origin, confirmed, clientAgents }, null, 2));
  } else if (confirmed) {
    say(log, opts.as === ''
      ? `on ${origin} — ${opts.client} now has no mapping (the answer shows none)`
      : `applied on ${origin} — ${opts.client} is counted as ${opts.as} on the Usage and Sessions pages`);
    say(log, '  routing, caller keys, the models an agent is shown and its caps and budgets are unchanged');
  } else if (!state) {
    say(log, `sent to ${origin}, but the answer is not magpie's settings state: not confirmed`);
    say(log, `  ${text ? text.slice(0, 200) : '(empty body)'}`);
    say(log, '  check the address and the key, then the Usage page: it shows what took');
  } else {
    say(log, `sent to ${origin}, but the settings that came back do not show it: ${JSON.stringify(clientAgents)}`);
    say(log, '  check that the agent exists (install and enable the LobeHub agent plugin) and that this magpie has ClientAgents');
    say(log, '  the Usage page is the verdict: it draws the pairs magpie holds');
  }

  return { ok: confirmed, applied: true, status: res.status, confirmed, clientAgents, request, origin, opts };
}

// The command line, when this file is the program. Everything above is
// importable without a side effect, which is what the selfcheck leans on.
const invoked = process.argv[1] || '';
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked)) {
  const out = await run({ argv: process.argv.slice(2), env: process.env, fetchImpl: globalThis.fetch });
  const code = out.help ? 0 : out.ok ? 0 : out.errors ? 2 : 1;
  process.exitCode = code;
}
