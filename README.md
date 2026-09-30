# zack.projects
## Digikala MCP

`.mcp.json` wires Claude Code to the hosted, read-only [mmdju/digikala-mcp](https://github.com/mmdju/digikala-mcp) server
(search, live prices in Toman, product details/specs, reviews, Q&A, comparisons, best-sellers, incredible offers).

In Claude Code on the web, the environment's network access must allow `digikala-mcp.mmdju.workers.dev`.
Direct calls to `api.digikala.com` from the cloud container are reset by Digikala, so go through the MCP server.
Digikala occasionally rate-limits the server; retry after ~30 seconds.
