// LobeHub — a magpie agent plugin that only names and draws LobeHub.
//
// magpie loads this module in moejs, in its own process: no Node APIs and
// no imports outside the plugin folder. It exports one `agent` object,
// which magpie checks as internal/agentplug's Desc and lists on the
// Agents page.
//
// There is deliberately no `connect`, `bin` or `dir`: nothing here writes
// or reads a LobeHub file. `config` + `model` are the inert placeholder
// the schema needs (agentplug: a module with neither a model key nor a
// connect has nothing to offer), and the path is this plugin's own,
// outside every LobeHub config directory. It is created only if someone
// picks a model for this row by hand — which the README says not to do.
//
// `ua` is what names LobeHub's requests: magpie's usage.AgentOf() takes
// the User-Agent's product token, lower-cases it, and matches this list by
// prefix, so "lobehub/2.2.19" and "lobehub" both count and "lobechat/1.0"
// does not.
//
// Nothing else goes in this list. AgentOf() is not a display rule: magpie
// reads it for the request's identity — the agent named on the Routing
// page, the caller keys, the model catalogue an agent is shown, its caps
// and budgets — so teaching it a deployment's own product token would move
// that traffic under this name everywhere, not only on the Usage and
// Sessions pages. A one-letter token is worse still: the match is by
// prefix, so "k" swallows every other "k..." client.
//
// A deployment whose gateway sends its own token is mapped instead, and
// only where it is reported: settings.ClientAgents (single client counted
// as an agent magpie knows) read back by usage.ReportedAs. scripts/
// arrange-client.mjs sets that pair through magpie's own API, and magpie's
// gateway keeps the client's own name for everything it decides.
//
// `icon` is a data:image URI on purpose: magpie decodes it once, keeps it
// in its own icons folder and serves it from there, so the row needs no
// network. assets/icon.svg is the source this string is made from —
// change that file, then run `node selfcheck.mjs`, which fails while the
// two differ.

export const agent = {
  id: 'lobehub',
  name: 'LobeHub',
  config: '~/.config/magpie-agent-lobehub/placeholder.json',
  format: 'json',
  model: 'model',
  ua: ['lobehub'],
  icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgcm9sZT0iaW1nIiBhcmlhLWxhYmVsPSJMb2JlSHViIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iZyIgeDE9IjgiIHkxPSI2IiB4Mj0iNTYiIHkyPSI1OCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM2RThCRkYiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjOEI1Q0Y2Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNTYiIGhlaWdodD0iNTYiIHJ4PSIxNiIgZmlsbD0idXJsKCNnKSIvPgogIDxwYXRoIGQ9Ik0yNCAxOHYxOGE4IDggMCAwIDAgOCA4aDgiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSI2LjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgogIDxjaXJjbGUgY3g9IjQ0IiBjeT0iMjAiIHI9IjUuNSIgZmlsbD0iI2ZmZiIvPgo8L3N2Zz4K',
};
