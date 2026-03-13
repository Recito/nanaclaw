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

Before diving in, spend 2-3 minutes creating a prioritized task list:

1. Read and understand the codebase/context relevant to the request
2. Break the goal into concrete, ordered sub-tasks
3. Rank by impact — highest value work first
4. Estimate rough time per sub-task

If your plan differs from what you passed to `start_deep_work`, update it:
```
mcp__nanoclaw__update_deep_work(add_tasks: ["new task"], remove_tasks: ["old task"])
```

Send a brief plan to the user via `send_message`:
> "Plan: 1) Fix X, 2) Optimize Y, 3) Add feature Z, 4) Stretch: refactor W"

## Step 3: Work Loop

For each sub-task:

1. **Do the work** — implement, test, verify
2. **Check the clock** — run `date '+%s'` after completing each sub-task
3. **Update progress:**
   ```
   mcp__nanoclaw__update_deep_work(
     completed_task: "Fix X",
     current_task: "Optimize Y"
   )
   ```
4. **Decide next action:**
   - **Time remaining > estimated next task**: Continue to next sub-task
   - **Time remaining < 10 minutes**: Go to Step 4 (wrap up)
   - **Time remaining > 10 min but < next task estimate**: Pick a smaller quick win instead

### CRITICAL RULES for the work loop:

- **Actually run `date`** every time. Do NOT estimate or assume the time.
- **Call `update_deep_work`** after completing each sub-task. This is your durable state — if your context resets, you'll resume from here.
- **Send progress updates** via `send_message` after completing each major sub-task. Keep updates brief:
  > "✓ Done: [what]. Moving to: [next]. Time remaining: ~[X] min"
- **Don't rush at the end.** If you have 15 minutes left, do 15 minutes of good work.
- **Test your changes** before moving on. Broken code is worse than less code.
- **Commit incrementally** if working in a git repo.

### After Context Compaction

If you see "This session is being continued from a previous conversation" or your context feels fresh:

1. **Call `get_deep_work_status`** immediately — it has your deadline, plan, and progress
2. **Run `date`** to check current time against deadline
3. **If deadline hasn't passed**: Continue working from where `current` left off
4. **If deadline has passed**: Go to Step 4 (wrap up)

The system auto-injects a continuation prompt if your context resets during an active session. Just call `get_deep_work_status` and pick up where you left off.

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
- **User gives a very long window (>4 hours)**: Work in 2-hour sprints with summary reports between sprints. Re-evaluate priorities at each sprint boundary.
- **Something is badly broken**: Send an update immediately. Don't burn time on something blocked. Move to the next task and flag it for the user.
- **Tests are failing before you start**: Fix existing failures first, then proceed with the goal. Time spent stabilizing counts.
- **User sends a new message during deep work**: Read it, adjust plan if needed, call `update_deep_work`, continue working. Don't stop unless they say to.
