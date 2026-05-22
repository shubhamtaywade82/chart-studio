This carousel explains the internal architecture and workflow model behind [Claude Code](https://www.anthropic.com/claude-code?utm_source=chatgpt.com) — specifically how its `.claude/` ecosystem structures agentic development workflows.

The core idea:

> Claude Code is not just a chatbot in terminal.
> It is a programmable AI operating environment with layered context loading, automation, scoped behaviors, and subagent orchestration.

The slides progressively reveal the architecture.

---

# 1. The Core Thesis

Slide 1:

> “Every file Claude Code actually loads”

The author is explaining that Claude Code operates through filesystem-driven configuration and behavior injection.

This means:

* Behavior is not only prompt-based
* Behavior is assembled dynamically from:

  * markdown files
  * hooks
  * skills
  * agents
  * rules
  * plugins
  * local configs

This is effectively:

```text
LLM Runtime + Context Loader + Workflow Engine
```

not merely “AI autocomplete”.

---

# 2. Claude Code Reads Your Repository Aggressively

Slide 2:

> “Claude Code pulls 15+ files the second it opens your repo”

Critical concept:
Claude Code recursively scans and loads repository metadata/config automatically.

The user is emphasizing:

```text
CLAUDE.md is NOT the system.
It is only one context source.
```

Meaning:

| Layer         | Purpose                        |
| ------------- | ------------------------------ |
| CLAUDE.md     | Global project instructions    |
| hooks         | Automation                     |
| skills        | Reusable workflows             |
| agents        | Isolated subagents             |
| rules         | Scoped contextual instructions |
| output-styles | Response formatting            |
| settings      | Runtime behavior               |
| plugins       | External integrations          |

This is extremely similar to:

* Cursor Rules
* Windsurf memory system
* OpenAI Codex agents
* RooCode modes
* Cline MCP workflows

But more filesystem-native.

---

# 3. Root-Level Files

Slide 3 explains the repository root contracts.

## `CLAUDE.md`

Global project behavior.

Equivalent to:

```text
Repository system prompt
```

Typical contents:

```md
- coding standards
- architecture rules
- testing requirements
- deployment conventions
- naming conventions
- forbidden patterns
```

The image correctly says:

> “suggestion, not promise”

because:
LLMs are probabilistic.

Claude may ignore instructions if:

* context pressure rises
* tool results conflict
* prompt competition occurs
* token truncation happens

This is true for every LLM system.

---

## `CLAUDE.local.md`

Gitignored personal overrides.

Used for:

* local secrets
* personal preferences
* experimental instructions
* machine-specific tooling

Example:

```md
Always use local Ollama first.
Never use cloud models.
Prefer pnpm over npm.
```

This avoids polluting team-wide config.

---

## `.mcp.json`

MCP server configuration.

MCP = Model Context Protocol.

This is the most important modern AI tooling abstraction.

It exposes external tools/resources to the model.

Example:

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"]
    }
  }
}
```

This turns:

* GitHub
* databases
* browsers
* APIs
* trading systems
* filesystem services

into callable AI tools.

For your stack, this is where:

* DhanHQ
* Binance
* PostgreSQL
* Rails console
* Kubernetes
* Pine backtest engine

would integrate.

---

## `.gitignore`

The author emphasizes:

```text
*.local.*
```

should never be committed.

Correct.

Because:

* secrets
* API keys
* local overrides

must stay isolated.

---

# 4. `.claude/` Folder Architecture

Slide 4 is the real architecture map.

This is the operational runtime layer.

---

## `hooks/`

Deterministic automation.

Important distinction:

```text
Hooks are NOT probabilistic AI reasoning.
```

They are guaranteed execution events.

Equivalent to:

* Git hooks
* CI hooks
* lifecycle callbacks

Examples:

| Hook         | Trigger              |
| ------------ | -------------------- |
| SessionStart | repo opens           |
| PostToolUse  | tool finished        |
| PreCompact   | before summarization |
| PreCommit    | before git commit    |

This is extremely powerful.

Example for your workflow:

```bash
PostToolUse.sh
```

could:

* run Rubocop
* run RSpec
* validate Pine syntax
* run TypeScript checks
* auto-format code
* validate trading risk configs

before Claude continues.

This is where deterministic safety belongs.

NOT inside prompts.

---

## `commands/`

Slash command workflows.

Example:

```text
/ship
/review
/refactor
/analyze
```

Each command maps to a workflow file.

This is basically:

```text
Prompt Macros + Tool Pipelines
```

Example:

```text
/ship
```

might:

1. Run tests
2. Lint
3. Build Docker
4. Generate changelog
5. Push branch

This reduces repetitive prompting.

---

## `skills/`

This is one of the most important concepts.

Skills are:

* reusable workflow modules
* invoked on demand
* composable

The slide says:

> “Claude reaches for them ON DEMAND”

Meaning:
skills are not always loaded into context.

This matters because:

```text
Context window efficiency = capability scaling
```

A proper skill system:

* keeps token usage low
* loads expertise lazily
* avoids polluted context

This is exactly how production agent systems should work.

For your architecture:

```text
skills/
  dhan-order-placement/
  websocket-debugging/
  rails-tdd/
  pine-v6-review/
  options-risk-analysis/
```

would be ideal.

---

## `agents/`

Subagents with isolated context.

This is VERY important.

Without isolation:

* context contamination happens
* reasoning degrades
* tool noise accumulates

Agents allow specialized workers.

Examples from slide:

```text
code-reviewer
researcher
log-analyzer
```

Architecture:

```text
Main Agent
 ├── Research Agent
 ├── Code Review Agent
 ├── Trading Risk Agent
 └── Pine Validation Agent
```

This is effectively:
multi-agent orchestration.

Your current local-agent direction aligns strongly with this model.

---

# 5. Hooks vs Commands

Slide 5 explains automation separation.

## Hooks

Automatic.

Deterministic lifecycle execution.

Equivalent to:

```text
event-driven architecture
```

---

## Commands

User-triggered workflows.

Equivalent to:

```text
manual orchestration endpoints
```

Correct separation.

Most AI tooling mixes these badly.

---

# 6. Skills + Agents

Slide 6 highlights the real scaling layer.

This is the transition from:

```text
LLM assistant
```

to:

```text
AI operating system
```

Key insight:

> Skills = reusable capabilities
> Agents = isolated execution units

This is architecturally correct.

---

# 7. Plugins / Rules / Output Styles

Slide 7 introduces contextual specialization.

---

## `plugins/`

Packaged integrations.

Could include:

* MCP servers
* prompts
* tools
* agents
* workflows

Similar to:

* VSCode extensions
* LangChain toolkits
* OpenAI GPT actions

---

## `rules/`

Path-scoped instructions.

Very important for large repos.

Example:

```text
rules/api.md
```

only applies to:

```text
src/api/**
```

This avoids:

* irrelevant prompt pollution
* conflicting instructions

Massively improves large monorepo performance.

---

## `output-styles/`

Response formatting contracts.

Example:

```text
terse.md
```

forces:

* code only
* no explanations
* compact responses

This is useful for:

* automation
* CI
* patch generation
* batch refactors

---

# 8. Runtime Config

Slide 8 explains runtime settings.

---

## `statusline`

Terminal UI metadata.

Pure UX layer.

Shows:

* branch
* model
* session
* repo
* tokens

---

## `settings.json`

Global runtime config.

Controls:

* permissions
* model selection
* hooks
* execution policies

Example:

```json
{
  "model": "claude-opus",
  "allow": ["Bash", "Edit"],
  "hooksEnabled": true
}
```

---

## `settings.local.json`

Local machine overrides.

Gitignored.

Equivalent to:
developer-local runtime state.

---

# 9. Three Critical Rules

Slide 9 contains the most accurate engineering insights.

---

## Rule 1

> CLAUDE.md is a suggestion.

Correct.

LLMs are not deterministic parsers.

Prompt obedience is probabilistic.

The fix is:

* hooks
* validation
* constrained tooling
* deterministic pipelines

NOT bigger prompts.

---

## Rule 2

> hooks are guaranteed.

Correct.

Hooks are the true reliability layer.

Production systems should:

* minimize prompt reliance
* maximize deterministic enforcement

---

## Rule 3

> skills load just-in-time.

Correct.

This is effectively:
RAG for workflows.

Critical for:

* token efficiency
* capability modularity
* large systems

---

# 10. Final Philosophy

Slide 10:

> “go build something reckless”

Meaning:

The barrier to building sophisticated AI-native tooling is collapsing.

This ecosystem enables:

* autonomous coding systems
* multi-agent orchestration
* AI-assisted CI/CD
* AI-native developer tooling
* local-first copilots
* deterministic AI workflows

---

# What Actually Matters Technically

The truly important concepts from this carousel are:

| Concept         | Importance           |
| --------------- | -------------------- |
| Hooks           | Extremely high       |
| Skills          | Extremely high       |
| Agent isolation | Extremely high       |
| Scoped rules    | High                 |
| MCP integration | Extremely high       |
| Output styles   | Medium               |
| CLAUDE.md       | Useful but overrated |

---

# Most Important Insight

The author indirectly reveals the correct modern AI architecture pattern:

```text
LLM
  +
Deterministic Runtime
  +
Tool Layer
  +
Context Loader
  +
Workflow Modules
  +
Subagents
```

That is the real direction of production AI systems.

Not:

* giant prompts
* monolithic agents
* chat-only workflows

Your current direction with:

* Ollama
* planners
* validators
* deterministic execution
* event-driven systems
* isolated analyzers

is already converging toward this architecture.
A generic architecture for **all coding agents** should not be Claude-specific.

The correct abstraction is:

```text
Agent Runtime
├── instructions/
├── rules/
├── skills/
├── agents/
├── hooks/
├── commands/
├── memory/
├── tools/
├── styles/
├── context/
└── runtime/
```

This works for:

* Claude Code
* OpenAI Codex
* Cursor
* Cline
* RooCode
* Aider
* Gemini CLI
* OpenHands
* Devin-like systems
* Local Ollama agents
* Custom orchestration runtimes

The filesystem becomes the AI operating system.

---

# Universal Coding-Agent Architecture

```text
.ai/
├── instructions/
│   ├── global.md
│   ├── architecture.md
│   ├── coding-standards.md
│   └── testing.md
│
├── rules/
│   ├── rails-api.md
│   ├── react-ts.md
│   ├── trading-risk.md
│   └── db-migrations.md
│
├── skills/
│   ├── code-review/
│   ├── debugging/
│   ├── websocket-analysis/
│   ├── rails-tdd/
│   ├── pine-v6/
│   └── dhanhq/
│
├── agents/
│   ├── reviewer.md
│   ├── researcher.md
│   ├── architect.md
│   ├── debugger.md
│   └── risk-manager.md
│
├── hooks/
│   ├── session-start.sh
│   ├── post-edit.sh
│   ├── pre-commit.sh
│   └── pre-response.sh
│
├── commands/
│   ├── review.md
│   ├── ship.md
│   ├── analyze.md
│   └── refactor.md
│
├── tools/
│   ├── mcp.json
│   ├── docker.json
│   ├── kubernetes.json
│   └── postgres.json
│
├── styles/
│   ├── terse.md
│   ├── architect.md
│   └── production.md
│
├── memory/
│   ├── decisions.md
│   ├── architecture-history.md
│   └── known-issues.md
│
├── context/
│   ├── domain.md
│   ├── glossary.md
│   └── workflows.md
│
└── runtime/
    ├── settings.json
    ├── permissions.json
    └── models.json
```

---

# What Each Layer Actually Does

# 1. `instructions/`

Global behavioral constraints.

Equivalent to:

* system prompts
* repository conventions
* engineering contracts

Example:

```md
Use strict TypeScript.
Never use ActiveRecord callbacks for orchestration.
RSpec coverage minimum 90%.
```

Should remain:

* short
* stable
* foundational

Do NOT overload this.

---

# 2. `rules/`

Scoped contextual instructions.

This is critical in large repos.

Example:

```text
rules/react-ts.md
```

applies only to:

```text
frontend/**
```

Benefits:

* lower token pollution
* fewer instruction conflicts
* better specialization

This is the future of scalable agentic coding.

---

# 3. `skills/`

Reusable capability modules.

Most important layer after tools/hooks.

A skill should contain:

```text
skill/
├── SKILL.md
├── examples/
├── templates/
├── validators/
└── workflows/
```

Example:

```text
skills/rails-tdd/
```

could include:

* service patterns
* RSpec conventions
* factory patterns
* transaction patterns
* API test templates

Loaded only when needed.

This is effectively:

```text
On-demand workflow retrieval
```

instead of giant prompts.

---

# 4. `agents/`

Specialized isolated workers.

Example:

| Agent        | Responsibility       |
| ------------ | -------------------- |
| reviewer     | PR analysis          |
| debugger     | stacktrace diagnosis |
| architect    | system design        |
| risk-manager | trading safety       |
| researcher   | web + docs synthesis |

Key property:

```text
Isolated context windows
```

Without this:

* reasoning collapses
* token pollution grows
* hallucinations increase

Subagent isolation is mandatory for serious systems.

---

# 5. `hooks/`

Deterministic automation.

The reliability layer.

This is where production guarantees belong.

Example:

```bash
post-edit.sh
```

```bash
#!/bin/bash

bundle exec rubocop
bundle exec rspec spec/services
npm run typecheck
```

Hooks should enforce:

* linting
* validation
* safety
* formatting
* policy compliance

Never rely on prompts for enforcement.

---

# 6. `commands/`

User-triggered workflows.

Equivalent to:

* slash commands
* macros
* orchestrators

Example:

```text
/review
```

Workflow:

```text
1. Analyze diff
2. Run tests
3. Check architecture rules
4. Generate findings
```

This is reusable orchestration.

---

# 7. `tools/`

External system integrations.

Usually:

* MCP
* APIs
* databases
* terminals
* Kubernetes
* browser automation

Example:

```json
{
  "postgres": {
    "command": "mcp-postgres"
  }
}
```

This converts the LLM into:

* an operator
* not merely a text generator

Most agent systems become useful only after this layer.

---

# 8. `styles/`

Output contracts.

Example:

```md
Return:
- no prose
- code only
- unified diff format
```

Useful for:

* CI systems
* automation
* patch pipelines
* structured outputs

---

# 9. `memory/`

Persistent project intelligence.

This is massively underrated.

Store:

* architecture decisions
* historical failures
* known edge cases
* migration notes
* production incidents

Example:

```md
Avoid Sidekiq retries for order placement.
Duplicate retries caused live duplicate trades on 2025-05-18.
```

This dramatically improves future reasoning.

---

# 10. `context/`

Domain knowledge.

Separate from instructions.

Contains:

* business flows
* domain models
* glossary
* protocols
* architecture maps

Example:

```md
DhanHQ Super Orders require boProfitValue and boStopLossValue.
```

This is not “behavior”.
This is “knowledge”.

Important distinction.

---

# 11. `runtime/`

Execution policy layer.

Controls:

* model routing
* permissions
* temperature
* token limits
* tool access
* sandboxing

Example:

```json
{
  "default_model": "deepseek-v4",
  "coding_model": "qwen3-coder",
  "review_model": "claude-opus"
}
```

---

# Correct Mental Model

Most people think:

```text
AI Agent = Prompt
```

Wrong.

Real architecture:

```text
AI Agent
=
LLM
+ Runtime
+ Tools
+ Memory
+ Retrieval
+ Workflows
+ Deterministic Validation
+ Specialized Subagents
```

---

# What Actually Scales

The highest leverage layers are:

| Layer        | Importance |
| ------------ | ---------- |
| hooks        | Critical   |
| tools        | Critical   |
| skills       | Critical   |
| agents       | Critical   |
| memory       | Very high  |
| rules        | Very high  |
| instructions | Medium     |

Most beginners overinvest in:

* prompts
* CLAUDE.md
* personality engineering

Production systems scale through:

* deterministic enforcement
* workflow modularity
* isolation
* retrieval
* tool orchestration

---

# Best Architecture Pattern Today

For your type of systems:

```text
Planner Agent
    ↓
Specialized Subagents
    ↓
Deterministic Hooks
    ↓
Validators
    ↓
Execution Layer
    ↓
Memory Update
```

That is the modern production-grade agent stack.

Especially for:

* trading systems
* Rails monoliths
* infra automation
* multi-service repos
* AI-assisted CI/CD
* autonomous debugging systems

---

# What You Should Build

For your local-first Ollama architecture:

```text
core/
├── planner
├── validator
├── executor
├── memory
├── tools
└── workflows
```

Then add:

* isolated coding agents
* skills retrieval
* deterministic hooks
* MCP tools
* runtime policies

That is the correct direction.
