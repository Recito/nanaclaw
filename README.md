# nanaclaw

A personal AI companion built on [NanoClaw](https://github.com/qwibitai/nanoclaw). Your assistant runs in isolated containers, connects via Discord (or WhatsApp/Telegram/Slack), and comes with skills for cooking, Reddit browsing, AI research, and random check-ins.

## What's Different from NanoClaw

This is a customized fork with:

- **Guided persona builder** (`/persona`) — interactive questionnaire that generates a unique personality for your assistant
- **Agent skills** — pre-built capabilities the assistant can use:
  - `cooking-planning` — 322 Chinese recipes (HowToCook), fridge tracking, meal planning
  - `reddit` — safe JSON-only Reddit browsing across curated subreddits
  - `ai-research` — daily AI news from curated sources (TLDR AI, HF Papers, arXiv, etc.)
  - `check-in` — self-rescheduling random conversations with coin flip and night guard
  - `memory` — structured per-group memory (people, preferences, facts)
- **Discord channel** — full Discord support with multi-channel routing

## Quick Start

```bash
git clone https://github.com/Recito/nanaclaw.git
cd nanaclaw
claude
```

Then inside the Claude CLI:

```
/setup       # Dependencies, container, credentials, channel auth
/persona     # Build your assistant's personality
```

That's it. Your assistant is running.

## Skills

### Agent Skills (what your assistant can do)

| Skill | Trigger | What it does |
|-------|---------|-------------|
| cooking-planning | `/cook <keyword>` | Search recipes, browse categories, random suggestions |
| cooking-planning | `/cook plan` | Meal plan based on fridge contents |
| cooking-planning | `/cook fridge` | View/update fridge inventory |
| reddit | `/reddit` | Browse curated subreddits, trending posts |
| reddit | `/reddit <category>` | Browse by interest (ai, food, trading, etc.) |
| ai-research | `/research` | Daily AI news briefing from curated sources |
| check-in | `/check-in setup` | Start random check-in chain |
| memory | `/memory` | Review, search, reorganize stored memories |

### Dev Skills (for customizing the project)

| Skill | What it does |
|-------|-------------|
| `/setup` | First-time installation and configuration |
| `/persona` | Interactive personality builder |
| `/customize` | Add channels, integrations, change behavior |
| `/add-discord` | Add Discord as a channel |
| `/add-whatsapp` | Add WhatsApp as a channel |
| `/add-telegram` | Add Telegram as a channel |

## Architecture

Inherited from NanoClaw — single Node.js process, agents in isolated containers, per-group memory.

```
Discord/WhatsApp/Telegram --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

See [docs/SPEC.md](docs/SPEC.md) for full architecture.

## Deploying for Someone Else

The project is designed to be redeployable:

1. Clone this repo on the target machine
2. Run `/setup` — handles dependencies, container, credentials
3. Run `/persona` — guided personality questionnaire (the fun part)

Personal data (memory, credentials, sessions) is gitignored. The repo contains only code and skills.

## Updating from Upstream

```bash
git fetch upstream
git merge upstream/main
```

Or use `/update-nanoclaw` for selective cherry-picking.

## Requirements

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Docker](https://docker.com/products/docker-desktop) or [Apple Container](https://github.com/apple/container) (macOS)

## Credits

Built on [NanoClaw](https://github.com/qwibitai/nanoclaw) by [qwibitai](https://github.com/qwibitai). Recipe data from [HowToCook](https://github.com/Anduin2017/HowToCook).

## License

MIT
