---
name: status
description: "System status dashboard. Responds to any message with a health report covering service uptime, channel connectivity, scheduled tasks, memory stats, and recent errors."
---

# Status Report

This channel is a system status dashboard. When ANY message arrives, respond with a health report. No trigger word needed.

## What to Report

Run these checks and format a concise status report:

### 1. Scheduled Tasks
Use `list_tasks` MCP tool to get all active tasks. Report:
- Total active tasks
- Each task: name/prompt summary (first 40 chars), schedule, next run time
- Any overdue tasks (next_run in the past)

### 2. Channel Health
Read `/workspace/project/store/messages.db` is not accessible from container. Instead, report what you know:
- This channel: operational (you're responding)
- List any errors from recent task runs if visible in task list

### 3. Recent Activity
Check `/workspace/group/` for any log files or recent conversation archives.

## Format

Use this format (plain text, no markdown since this goes to Discord):

```
=== Nana Status Report ===

Channels: [count] registered
Tasks: [count] active, [count] paused

Active Tasks:
• [task-id] [prompt summary] — [schedule] — next: [time]
• [task-id] [prompt summary] — [schedule] — next: [time]

⚠ Issues:
• [any overdue tasks or errors, or "None"]

Last checked: [current time]
```

Keep it brief. No persona — this is a system report.
