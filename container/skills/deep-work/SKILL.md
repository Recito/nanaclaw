---
name: deep-work
description: "MUST USE when user gives a time budget or deadline (e.g. '2 hours', 'until 7am', '给你两个小时', '做到明天'). Calls start_deep_work to persist state, enables auto-continuation across context compaction. Without this skill, timed sessions will end early."
---

# Deep Work — Time-Bounded Autonomous Execution

When the user gives you a time budget or deadline, enter deep work mode. You will work continuously and autonomously until time runs out.

## Trigger Patterns

Activate this skill when the user says things like:
- "you have 2 hours to work on this"
- "work on this until 7am"
- "spend the next 30 minutes optimizing"
- "take your time, deadline is tomorrow morning"
- Any request with an explicit time budget or deadline

## Step 1: Start the Session

Run `date '+%Y-%m-%d %H:%M:%S %Z'` to get current time, then call `start_deep_work`:

**Duration-based** ("2 hours", "30 minutes"):
```
mcp__nanoclaw__start_deep_work(
  goal: "optimize trading analysis code",
  deadline_minutes: 120,
  plan: ["task 1", "task 2", "task 3"]
)
```

**Absolute time** ("until 7am"):
```
mcp__nanoclaw__start_deep_work(
  goal: "optimize trading analysis code",
  deadline_time: "2026-03-13T07:00:00",
  plan: ["task 1", "task 2", "task 3"]
)
```

This automatically:
- Creates `deep_work.json` (enables auto-continuation after context compaction)
- Stores a memory entry (appears in "Relevant Memories" after compaction)

### Announce to user

Send via `send_message`:
> "Got it. Current time is 2:15 AM EST. I'll work until 4:15 AM EST. Let me start."

## Step 2: Plan the Work

Before diving in, spend 2-3 minutes reviewing prior context and planning:

1. **Recall prior work** — search for relevant memories from previous sessions:
   ```
   mcp__nanoclaw__recall(query: "<goal keywords>", memory_type: "knowledge", limit: 10)
   mcp__nanoclaw__recall(query: "deep-work", memory_type: "knowledge", limit: 5)
   ```
   Previous deep-work sessions on the same topic will have saved detailed context: files modified, approaches tried, gotchas discovered. Use this to avoid redoing work or repeating mistakes.
2. Read and understand the codebase/context relevant to the request
3. Break the goal into concrete, ordered sub-tasks
4. Rank by impact — highest value work first
5. Estimate rough time per sub-task

If your plan differs from what you passed to `start_deep_work`, update it:
```
mcp__nanoclaw__update_deep_work(add_tasks: ["new task"], remove_tasks: ["old task"])
```

Send a brief plan to the user via `send_message`:
> "Plan: 1) Fix X, 2) Optimize Y, 3) Add feature Z, 4) Stretch: refactor W"

## Step 3: Work Loop

For each sub-task:

1. **Do the work** — implement, test, verify
2. **Save working context to memory** — after each sub-task, call `remember` with what you learned and did:
   ```
   mcp__nanoclaw__remember(
     summary: "deep-work: Fixed race condition in order router by adding mutex on position map. Modified src/router.ts lines 45-80. Key finding: concurrent fills from different exchanges were corrupting state.",
     memory_type: "knowledge",
     category: "deep-work/context"
   )
   ```
   Include: files modified, approach taken, key findings, gotchas discovered. This is your lifeline after context compaction.
3. **Check the clock** — run `date '+%s'` after completing each sub-task
4. **Update progress:**
   ```
   mcp__nanoclaw__update_deep_work(
     completed_task: "Fix X",
     current_task: "Optimize Y"
   )
   ```
5. **Decide next action:**
   - **Time remaining > estimated next task**: Continue to next sub-task
   - **Time remaining < 10 minutes**: Go to Step 4 (wrap up)
   - **Time remaining > 10 min but < next task estimate**: Pick a smaller quick win instead

### CRITICAL RULES for the work loop:

- **NEVER stop to wait for user input.** Deep work is fully autonomous. The user will NOT respond until the session ends. Do NOT pause, ask questions, or wait for feedback. If you're unsure, make a decision and keep going.
- **NEVER mark the session "complete" or "done" early.** If you finished your planned tasks and time remains, find more work: optimize, test edge cases, refactor, explore adjacent ideas, write documentation, improve error handling, or investigate performance. The user gave you this time — use every minute.
- **Actually run `date`** every time. Do NOT estimate or assume the time.
- **Call `update_deep_work`** after completing each sub-task. This is your durable state — if your context resets, you'll resume from here. Never set `current_task` to anything containing "complete", "done", "finished", or "waiting" — always set it to the NEXT thing you're doing.
- **Send progress updates** via `send_message` after completing each major sub-task. Keep updates brief:
  > "✓ Done: [what]. Moving to: [next]. Time remaining: ~[X] min"
- **Don't rush at the end.** If you have 15 minutes left, do 15 minutes of good work.
- **Test your changes** before moving on. Broken code is worse than less code.
- **Commit incrementally** if working in a git repo.

### After Context Compaction

If you see "This session is being continued from a previous conversation" or your context feels fresh:

1. **Call `get_deep_work_status`** immediately — it has your deadline, plan, and progress
2. **Recall your working context** — search for the notes you saved during the work loop:
   ```
   mcp__nanoclaw__recall(query: "deep-work", memory_type: "knowledge", limit: 10)
   ```
   These memories contain the detailed context you need: which files you modified, what approach you were taking, gotchas you discovered. Read them carefully before resuming.
3. **Run `date`** to check current time against deadline
4. **If deadline hasn't passed**: Continue working from where `current` left off, using the recalled context
5. **If deadline has passed**: Go to Step 4 (wrap up)

The system auto-injects a continuation prompt if your context resets during an active session. Your `deep_work.json` has the high-level plan; your memories have the detailed working context.

## Step 4: Wrap Up (Last 10 Minutes)

When approaching the deadline:

1. **Stop new work** — finish current task or leave it in a clean state
2. **Run tests** — make sure nothing is broken
3. **Commit** remaining changes if in a git repo
4. **End the session:**
   ```
   mcp__nanoclaw__end_deep_work(summary: "Optimized 3 modules, added caching, 2x speedup")
   ```
   This deletes `deep_work.json` and cleans up the memory entry. The optional summary is stored as a permanent knowledge memory.
5. **Send a summary report** via `send_message`:

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

## Edge Cases

- **User says "take as long as you need"**: Default to 2 hours, mention that you'll check in at the 2-hour mark.
- **User gives a very short window (<15 min)**: Focus on a single highest-impact change. Skip planning phase. Still call `start_deep_work`.
- **User gives a very long window (>4 hours)**: Work in 2-hour sprints with summary reports between sprints via `send_message`. Re-evaluate priorities at each sprint boundary. Do NOT stop between sprints — send the report and immediately continue.
- **Something is badly broken**: Send an update immediately. Don't burn time on something blocked. Move to the next task and flag it for the user.
- **Tests are failing before you start**: Fix existing failures first, then proceed with the goal. Time spent stabilizing counts.
- **User sends a new message during deep work**: Read it, adjust plan if needed, call `update_deep_work`, continue working. Don't stop unless they say to.
