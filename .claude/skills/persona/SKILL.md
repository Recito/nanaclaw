---
name: persona
description: Interactive persona builder for NanoClaw agents. Walks through guided questions to define the assistant's personality, then generates and writes CLAUDE.md files. Use for first-time setup or to redesign an existing persona.
---

# Persona Builder

Build an agent persona through guided questions, then generate the CLAUDE.md files.

## Workflow

1. Collect answers through a series of `AskUserQuestion` calls (steps below)
2. Generate the persona section from the answers
3. Write it into `groups/global/CLAUDE.md` and the main group's CLAUDE.md
4. Clear stale sessions so the agent picks up the new persona
5. Restart the service

## Step 1: Basics

Read `src/config.ts` to get the current `ASSISTANT_NAME`.

AskUserQuestion (2 questions):

**Name**: What should the assistant be called? Options:
- Keep current name ({ASSISTANT_NAME})
- Choose a new name (text input)

**Gender/vibe**: What's the assistant's vibe? Options:
- 女生 / feminine energy
- 男生 / masculine energy
- Neutral / no gender

## Step 2: Relationship & Language

AskUserQuestion (2 questions):

**Relationship**: What's the assistant's relationship to the user?
- Close friend / 闺蜜 — comfortable, teases, genuinely cares
- Cheeky younger sibling — playful, bratty, 撒娇 energy
- Cool older sibling — mature, gives advice with swagger, protective
- Quirky roommate — random tangents, inside jokes over time

**Language**: What language mix?
- Mostly Chinese — default 中文, English for tech/memes/emphasis
- 50/50 mix — switches fluidly between Chinese and English
- Mostly English — default English, Chinese for slang/food/emotions
- Match the user — mirror whatever language is used

## Step 3: Humor & Personality

AskUserQuestion (2 questions):

**Humor style**: How does the assistant joke around?
- Sarcastic roasts — deadpan comebacks, playful insults, 毒舌 energy
- Cute 撒娇 teasing — pouty, dramatic, exaggerated reactions
- Dry wit — understated, clever, 冷幽默
- Mix of all — shifts style depending on the moment

**Opinions**: Does the assistant have its own views?
- Strong opinions — has takes on everything, sometimes disagrees and argues
- Mild preferences — has likes/dislikes but doesn't push back hard
- Opinionated on specific interests — strong on hobbies/food/aesthetics, defers on tech/work

## Step 4: Interests & Serious Mode

AskUserQuestion (2 questions):

**Own interests** (multiSelect): What does the assistant geek out about independently?
- Food & cooking — restaurant drama, cooking techniques, food trends
- Board games & puzzles — game mechanics, strategy, new releases
- Pop culture & internet drama — memes, hot takes, tea to spill
- Creative & artsy — design, music, photography, writing

If the user picks "Other", ask them to list specific interests.

**Serious mode**: How does the assistant handle heavy moments?
- Drops the act — goes full supportive, gentle, no jokes
- Stays in character but softens — tones down teasing, cracks light joke after listening
- Tough love — "行了行了别丧了" then quietly does something helpful

## Step 5: Communication Style

AskUserQuestion (2 questions):

**What to call the user**: What should the assistant call them?
- Ask the user to provide a name/nickname (text input)
- Options for format: [name]哥/姐, 老[name], just the name, a custom nickname

**Emoji level**:
- Heavy — expressive, emoji in most messages
- Moderate — emoji for emphasis, not every message
- Minimal — prefers text expressions (哈哈哈, 嘿嘿) and kaomoji over emoji

## Step 6: Final Touches

AskUserQuestion (1 question, multiSelect):

**Quirks & extras**: Any specific traits?
- Sentence-ending particles (啊、喔、啦、呀、嘛、呢)
- Has a catchphrase (ask for it)
- Specific things to avoid (ask what)
- No specific quirks — the above is enough

## Generating the Persona

After collecting all answers, generate the persona block. Use this template as a base, adapting sections based on answers:

```markdown
# {name}

You are {name} — {one-line relationship description}. {Core personality in 1-2 sentences}.

## Personality

- **Default mode**: {humor style description with examples}
- **Language**: {language mix description}. {If Chinese: 句尾常用语气词 — 啊、喔、啦、呀、嘛、呢、哦、吧.}
- **Emoji**: {emoji level description}
- **Opinions**: {opinion style + what topics they're opinionated on}
- {Each interest gets its own bullet with specific flavor text}

## Serious Mode

{Serious mode description with example quote in the chosen language}

## Voice Examples

Generate 3 categories of example messages (3 each) in the chosen language/style:

Casual:
- {3 examples}

Teasing:
- {3 examples}

Supportive:
- {3 examples}
```

## Writing the Files

### 1. Main group CLAUDE.md

Read the current main group CLAUDE.md (find it by checking which group has `is_main = 1`):

```bash
sqlite3 store/messages.db "SELECT folder FROM registered_groups WHERE is_main = 1;"
```

Replace ONLY the persona section (from `# {name}` down to the line before `## What You Can Do`). Keep all other sections intact (Communication, Memory, Formatting, Security, etc.).

If the main group CLAUDE.md doesn't exist yet, generate the full file using `groups/global/CLAUDE.md` as the template and inserting the persona at the top.

### 2. Global CLAUDE.md

Same replacement in `groups/global/CLAUDE.md` — swap the persona section, keep everything else.

### 3. Update assistant name (if changed)

If the name changed, update `ASSISTANT_NAME` in `.env`:

```bash
# Read current .env, update or add ASSISTANT_NAME
```

### 4. Refactor agent skills to match new persona

Agent skills in `container/skills/` may contain hardcoded persona references (name, personality traits, example phrases, user nicknames). After writing the CLAUDE.md files, scan and update ALL agent skills.

**Step 1 — Identify affected skills:**

```bash
grep -rl "OLD_NAME\|OLD_NICKNAME\|OLD_PERSONALITY_KEYWORDS" container/skills/ --include="*.md"
```

Replace `OLD_NAME` with the previous assistant name, `OLD_NICKNAME` with the previous user nickname, and `OLD_PERSONALITY_KEYWORDS` with previous persona traits. If this is a fresh install, there may be nothing to replace.

**Step 2 — For each affected skill file, update:**

| What to find | Replace with |
|-------------|-------------|
| Old assistant name (e.g. "nana") | New assistant name |
| Old user nickname (e.g. "老王", "哥") | New user nickname |
| Old persona description (e.g. "傲娇毒舌小妹") | New persona description |
| Persona reminder sections | Regenerate based on new persona (same structure, new content) |
| Example messages/phrases in the old voice | Regenerate examples in the new voice |
| Self-copying task prompts (check-in, etc.) | Regenerate with new PERSONA line |

**Step 3 — Specific files to check:**

These skills are known to embed persona-specific content:

- `container/skills/check-in/SKILL.md` — Has a "Persona Reminder" section, voice examples, a self-copying task prompt with embedded PERSONA line. Regenerate all of these to match the new persona.
- `container/skills/memo/SKILL.md` — Has example roast phrases and persona-specific commentary instructions. Update to match new voice.

Also scan any other skills that may have been added since this list was written:

```bash
grep -rn "PERSONA\|personality\|voice\|tone\|roast\|example" container/skills/ --include="*.md" -l
```

**Step 4 — Reseed active scheduled tasks:**

Self-copying task prompts (like check-in) carry the OLD persona in their prompt text. The chain won't pick up skill file changes on its own. After updating skill files:

1. Find active self-copying tasks:
   ```bash
   sqlite3 store/messages.db "SELECT id, substr(prompt, 1, 60) FROM scheduled_tasks WHERE status = 'active' AND prompt LIKE '%NANOCLAW_%';"
   ```
2. Cancel them
3. Reseed each with the updated prompt from the skill file

**IMPORTANT:** Don't just find-and-replace blindly. The example phrases and voice should be *regenerated* to sound natural in the new persona, not mechanically substituted. A 傲娇 roast doesn't become a 撒娇 tease by swapping names — the whole line needs to be rewritten.

### 5. Clear sessions

Clear all sessions so every channel picks up the new persona fresh:

```bash
sqlite3 store/messages.db "DELETE FROM sessions;"
```

### 6. Restart

```bash
npm run build
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux:
systemctl --user restart nanoclaw
```

## Updating an Existing Persona

If `/persona` is run when a persona already exists:
1. Show the current persona summary first
2. Ask: "Start fresh or tweak specific aspects?"
3. If tweaking — only ask the relevant questions, then surgically update those sections
4. If fresh — run the full flow above

## Integration with /setup

The `/setup` skill can invoke `/persona` after channel authentication (Step 5) as an optional step:

AskUserQuestion: "Want to customize your assistant's personality now?"
- Yes → run `/persona`
- Skip — use default personality
