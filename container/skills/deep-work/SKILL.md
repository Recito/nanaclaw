# Deep Work — Time-Bounded Autonomous Execution

When the user gives you a time budget or deadline, enter deep work mode. You will work continuously and autonomously until time runs out.

## Trigger Patterns

Activate this skill when the user says things like:
- "you have 2 hours to work on this"
- "work on this until 7am"
- "spend the next 30 minutes optimizing"
- "take your time, deadline is tomorrow morning"
- Any request with an explicit time budget or deadline

## Step 1: Parse the Deadline and Persist It

At the very start, determine your hard deadline:

- **Duration** ("2 hours", "30 minutes"): Run `date` to get current time, add the duration.
- **Absolute time** ("until 7am", "by 3pm"): Use that time directly. If no date specified, assume today (or tomorrow if the time has already passed today).

Run this immediately:
```bash
date '+%Y-%m-%d %H:%M:%S %Z'
```

Calculate your deadline, then **persist it** so it survives context compaction:

### 1a. Write `deep_work.json` to your workspace

```bash
cat > /workspace/group/deep_work.json << 'DEEPWORK'
{
  "deadline_unix": <UNIX_TIMESTAMP>,
  "deadline_human": "<YYYY-MM-DD HH:MM:SS TZ>",
  "goal": "<one-line summary of the user's request>",
  "plan": ["task 1", "task 2", "task 3"],
  "completed": [],
  "current": null,
  "started_at": "<ISO timestamp>"
}
DEEPWORK
```

For host mode, the file goes to the WORK_DIR (usually the group folder):
```bash
# Check which path exists
ls /workspace/group/deep_work.json 2>/dev/null || echo "Using host WORK_DIR"
```

### 1b. Store deadline in memory

Use `mcp__nanoclaw__remember` to store the deadline:
- summary: `Deep work session active until <deadline>. Goal: <goal summary>. Plan: <task list>`
- memory_type: `event`
- category: `deep-work`

This ensures the deadline appears in your "Relevant Memories" even after context compaction.

### 1c. Announce to user

Send this to the user via `send_message` so they know when to expect the final report.
> "Got it. Current time is 2:15 AM EST. I'll work until 4:15 AM EST. Let me start."

## Step 2: Plan the Work

Before diving in, spend 2-3 minutes creating a prioritized task list:

1. Read and understand the codebase/context relevant to the request
2. Break the goal into concrete, ordered sub-tasks
3. Rank by impact — highest value work first
4. Estimate rough time per sub-task

Update `deep_work.json` with your plan, then send a brief plan to the user via `send_message`:
> "Plan: 1) Fix X, 2) Optimize Y, 3) Add feature Z, 4) Stretch: refactor W"

## Step 3: Work Loop

For each sub-task:

1. **Do the work** — implement, test, verify
2. **Check the clock** — run `date '+%Y-%m-%d %H:%M:%S'` after completing each sub-task
3. **Update `deep_work.json`** — move completed tasks, set current task
4. **Decide next action:**
   - **Time remaining > estimated next task**: Continue to next sub-task
   - **Time remaining < 10 minutes**: Go to Step 4 (wrap up)
   - **Time remaining > 10 min but < next task estimate**: Pick a smaller quick win instead

### CRITICAL RULES for the work loop:

- **Actually run `date`** every time. Do NOT estimate or assume the time. Do NOT rely on when you started. Run the command.
- **Update `deep_work.json`** after completing each sub-task. This is your durable state — if your context resets, you'll resume from here.
- **Send progress updates** via `send_message` after completing each major sub-task. Keep updates brief:
  > "✓ Done: [what]. Moving to: [next]. Time remaining: ~[X] min"
- **Don't rush at the end.** If you have 15 minutes left, do 15 minutes of good work, don't try to cram.
- **Test your changes** before moving on. Broken code is worse than less code.
- **Commit incrementally** if working in a git repo. Small, working commits > one big commit.

### After Context Compaction

If you see "This session is being continued from a previous conversation" or your context feels fresh:

1. **Read `deep_work.json`** immediately — it has your deadline, plan, and progress
2. **Run `date`** to check current time against deadline
3. **If deadline hasn't passed**: Continue working from where `current` left off
4. **If deadline has passed**: Go to Step 4 (wrap up)

The system will also auto-inject a continuation prompt if your context resets during an active deep-work session. Just read `deep_work.json` and pick up where you left off.

## Step 4: Wrap Up (Last 10 Minutes)

When approaching the deadline:

1. **Stop new work** — finish current task or leave it in a clean state
2. **Run tests** — make sure nothing is broken
3. **Commit** remaining changes if in a git repo
4. **Delete `deep_work.json`** — this signals the system that deep work is complete:
   ```bash
   rm /workspace/group/deep_work.json 2>/dev/null
   ```
5. **Forget the deadline memory**:
   Use `mcp__nanoclaw__forget` with query "deep work session active"
6. **Write a summary report** and send via `send_message`:

```
=== Deep Work Complete ===
Duration: [actual time worked]
Goal: [original request summary]

Completed:
• [sub-task 1] — [brief result]
• [sub-task 2] — [brief result]

Not started / Deferred:
• [remaining items if any]

Key decisions made:
• [any architectural or design choices worth noting]

Next steps (if continuing later):
• [what to pick up next]
```

## Time Check Helper

Use this pattern throughout. Run it frequently — after every sub-task at minimum:

```bash
date '+%s'
```

Compare against your deadline timestamp in `deep_work.json`. This gives you exact seconds remaining — no guessing.

## Example Session Flow

User: "you have 2 hours to optimize the trading analysis code and add any features that would help"

```
[Check time: 2:00 AM]
[Deadline: 4:00 AM]
[Write deep_work.json with deadline_unix, goal, empty plan]
[Store in memory: "Deep work session active until 4:00 AM EST. Goal: optimize trading analysis"]
[Send: "Starting deep work. Deadline: 4:00 AM EST. Reading codebase now..."]
[Read code, analyze, plan]
[Update deep_work.json with plan]
[Send: "Plan: 1) Optimize slow portfolio calc, 2) Add caching layer, 3) Improve error handling, 4) Stretch: add parallel processing"]

[Work on task 1...]
[Check time: 2:35 AM — 85 min remaining]
[Update deep_work.json: completed=["task 1"], current="task 2"]
[Send: "✓ Portfolio calc 3x faster. Moving to caching. ~85 min left"]

--- context compaction happens here ---
[System auto-continues with: "Continue deep work - read deep_work.json"]
[Read deep_work.json → deadline 4:00 AM, completed task 1, current task 2]
[Check time: 2:36 AM — still 84 min left, continue]

[Work on task 2...]
[Check time: 3:10 AM — 50 min remaining]
[Update deep_work.json]
[Send: "✓ Caching layer added. Moving to error handling. ~50 min left"]

[Work on task 3...]
[Check time: 3:52 AM — 8 min remaining]
[Go to wrap-up]
[Run tests, commit, delete deep_work.json, forget deadline memory, send final report]
```

## Edge Cases

- **User says "take as long as you need"**: Default to 2 hours, mention that you'll check in at the 2-hour mark.
- **User gives a very short window (<15 min)**: Focus on a single highest-impact change. Skip planning phase. Still write `deep_work.json`.
- **User gives a very long window (>4 hours)**: Work in 2-hour sprints with summary reports between sprints. Re-evaluate priorities at each sprint boundary.
- **Something is badly broken**: Send an update immediately. Don't burn time on something blocked. Move to the next task and flag it for the user.
- **Tests are failing before you start**: Fix existing failures first, then proceed with the goal. Time spent stabilizing counts.
- **User sends a new message during deep work**: Read it, adjust plan if needed, update `deep_work.json`, continue working. Don't stop unless they say to.
