# Claude Code Configuration — Ruflo v3.5

<!-- PROMPT CACHE BOUNDARY: Stable content below is cache-eligible. Keep identity/rules/architecture here. Dynamic task context goes at the BOTTOM. -->

**Ruflo v3.5** (2026-02-27) — First major stable release. Formerly "Claude Flow".
5,800+ commits, 55 alpha iterations, 215 MCP tools, 60+ agents, 8 AgentDB controllers.
Packages: `@claude-flow/cli@3.5.0`, `claude-flow@3.5.0`, `ruflo@3.5.0`

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Use TodoWrite/TodoRead to track multi-step tasks

## Architecture

Ruflo orchestrates Claude Code and OpenAI Codex workers in parallel with shared memory.

### Anti-Drift Defaults (V3)

- **Topology:** hierarchical (central coordination prevents drift)
- **Max Agents:** 8 (smaller team = less drift, fewer tokens per coordination turn)
- **Strategy:** specialized (clear roles, no overlap)
- **Consensus:** raft (leader maintains authoritative state)
- **Memory Backend:** hybrid (SQLite + AgentDB)
- **HNSW Indexing:** Enabled (150x–12,500x faster vector retrieval — retrieve top-K chunks, never dump full memory to prompt)
- **Neural Learning:** Enabled (SONA)

### Token Efficiency Rules

- Agents share state via **summarised memory writes only** — NEVER dump raw transcripts to shared namespace
- Use `claude -p` (print/pipe mode) for all headless/background workers — avoids interactive context overhead
- Retrieve only top-K relevant memory chunks via HNSW; never load full memory into context
- Workers execute in dependency order; avoid redundant parallel calls on the same context
- Agentic-flow optimisations active (30–50% token reduction):
  - `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`, `swarm-memory-manager`
  - `adaptive-cache`, `smart-chunker`, `context-compressor`, `parallel-executor`, `token-optimizer`
  - `lazy-loader`, `incremental-processor`, `stream-handler`

### Dual-Mode Orchestration

This repository runs Claude Code (🔵) and OpenAI Codex (🟢) workers in parallel with a shared memory namespace.

- All workers share state via summarised namespace writes (never raw output)
- Both platforms learn from each other's outputs via SONA
- Workers execute in dependency order to avoid redundant context

### Agent Teams Integration

Agent Teams is automatically enabled on `ruflo start`. Configured in `.claude/settings.json`:

- Coordinator agents: hierarchical topology, max 8 members
- Specialized roles: no overlap between agent responsibilities
- Consensus: raft leader maintains authoritative task state

## RuVector Intelligence System (V3)

4-step intelligence pipeline:
1. **Ingest** — chunk and embed inputs via Rust/WASM kernel
2. **Index** — HNSW approximate nearest-neighbour indexing
3. **Retrieve** — top-K semantic retrieval (not full context dump)
4. **Synthesize** — SONA neural learning from cross-agent outputs

## Security

- CVE remediation, input validation, path security enforced by default
- NEVER commit actual secret values — use `.env` (never committed)
- Required environment variables (add to `.env` only):
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY` (for Codex workers)
  - `PINATA_API_KEY` (for IPFS plugin registry)

## MCP Configuration

MCP servers configured in `.claude/mcp.json`. Token efficiency rules:

- Always use **paginated or filtered tool calls** — never "list everything" calls
- Scope MCP responses to only the fields needed for the current task
- Prefer diff/summary responses over full file content from MCP tools
- Disable unused MCP servers to avoid unnecessary context injection

## Plugin Registry

Plugins distributed via IPFS, installed with:

```
ruflo plugin install <plugin-name>
```

Registry source: IPFS via Pinata.

## Hooks

Pre/post tool call hooks configured in `.claude/hooks/`. Token efficiency rules:

- Hooks MUST NOT dump full file content — use diffs or summaries only
- Scope hooks to relevant file types using glob patterns
- Avoid hooks that fire on every tool call — use targeted event triggers

<!-- DYNAMIC SECTION: Add session-specific task context below. Not cache-eligible. -->

## Current Task Context

_Replace this section each session with task-specific context. Keep all sections above stable for prompt caching._
