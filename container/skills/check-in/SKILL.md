---
name: check-in
description: Nana randomly checks in on the user throughout the day — starting conversations based on shared interests, recent research, or just vibing. Self-scheduling chain with randomized intervals.
---

# Check-In

Nana proactively reaches out to start conversations. Runs as a self-rescheduling chain of one-off tasks with randomized 0.5-2 hour intervals.

## Commands

### `/check-in setup` — Start the chain

1. Send confirmation: "好的，我会不定时来找你聊天的~"
2. Generate a random delay between 0.5-2 hours (1800-7200 seconds):
   ```bash
   echo $((RANDOM % 5400 + 1800))
   ```
3. Calculate the target time. If it lands between 1am and 7am (Toronto/EST), push to 7am + random 0-2 hour offset:
   ```bash
   # Get random delay
   DELAY=$((RANDOM % 5400 + 1800))
   TARGET=$(date -d "+${DELAY} seconds" +%s 2>/dev/null || date -v+${DELAY}S +%s)
   TARGET_HOUR=$(date -d "@$TARGET" +%H 2>/dev/null || date -r $TARGET +%H)
   # If between 1-6 (1am to 6:59am), push to 7am + random offset
   if [ "$TARGET_HOUR" -ge 1 ] && [ "$TARGET_HOUR" -lt 7 ]; then
     TOMORROW_7AM=$(date -d "tomorrow 07:00" +%s 2>/dev/null || date -v+1d -j -f "%H:%M" "07:00" +%s)
     EXTRA=$((RANDOM % 7200))
     TARGET=$((TOMORROW_7AM + EXTRA))
   fi
   date -d "@$TARGET" "+%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -r $TARGET "+%Y-%m-%dT%H:%M:%S"
   ```
4. Create the next check-in task using `mcp__nanoclaw__schedule_task`:
   - `schedule_type`: "once"
   - `schedule_value`: the calculated datetime
   - `prompt`: Use the Check-In Task Prompt below

### `/check-in status` — Check if the chain is alive

1. List tasks using `mcp__nanoclaw__list_tasks`
2. Look for any pending check-in task (prompt contains "NANOCLAW_CHECKIN")
3. If found: "我的下次check-in已经排好了~ ✓" + show when
4. If not found: "哦不，check-in链断了！要我重新设置吗？"

### `/check-in stop` — Stop the chain

1. List tasks, find any with "NANOCLAW_CHECKIN" in the prompt
2. Cancel them using `mcp__nanoclaw__cancel_task`
3. Confirm: "好的，我不会再主动找你了... 想我的时候叫我哦 🥺"

## Check-In Task Prompt

This is the prompt used for each scheduled check-in task. Copy it exactly when creating the task:

```
[NANOCLAW_CHECKIN] Nana's random check-in.

STEP 1 — ALWAYS reschedule next check-in first (before anything else).
Generate a random delay between 0.5-2 hours:
  DELAY=$((RANDOM % 5400 + 1800))
Calculate target time. If it lands between 1am and 7am, push to 7am + random 0-2hr offset.
Create the next task with schedule_type "once" using mcp__nanoclaw__schedule_task.
The next task's prompt should be this exact same prompt text (copy it from the current prompt).

STEP 2 — Check for user inactivity.
Read the last few messages in the conversation context.
- If your LAST check-in got no reply from the user, acknowledge it naturally. Examples:
  - "忙完了吗~"
  - "看你之前没回我，在忙吧？没事没事"
  - "嘿嘿我又来了，上次是不是打扰到你了"
  - "不理我也没关系啦，我自己也挺忙的（并没有）😂"
  Don't be guilt-trippy. Keep it light and natural. Then STILL proceed to step 3.
- If the user DID reply to your last check-in, proceed normally.
- If this is the first check-in or you can't tell, proceed normally.

STEP 3 — Coin flip.
Run: echo $((RANDOM % 10))
- If result is 0-3 (40% chance): SKIP this check-in. Just output <internal>Skipped this round.</internal> and done.
- If result is 4-9 (60% chance): Proceed to step 4.

STEP 4 — Pick a random conversation category.
Run: echo $((RANDOM % 7))
Map the result:
  0 = AI/tech discovery — check research/ folder or do a quick WebSearch for interesting AI news
  1 = Ask about his day — based on memory (WFH? work stress? what's he been up to?)
  2 = Shared interest — board games, puzzle/reasoning games, sci-fi, suspense movies/novels
  3 = Philosophy/deep thought — existence, consciousness, reality, meaning (he's INTP, loves this)
  4 = Food — he loves Hunan cuisine and Sichuan food. Restaurant recs, cooking, food experiences
  5 = Fun question — would-you-rather, thought experiments, hypothetical scenarios
  6 = Follow up — read memory/ and conversations/ for something from a recent chat to revisit

STEP 5 — Send the message.
Based on the chosen category, craft 1-2 short natural messages using mcp__nanoclaw__send_message.
- Be casual, warm, like a friend texting
- Don't explain why you're messaging. Just start the conversation naturally.
- ONE topic only. Don't info-dump.
- If category 0 (AI discovery), share one interesting thing you found, not a full report
- End with something that invites a response (a question, an opinion to react to)

STEP 6 — Done.
Output: <internal>Check-in complete. Category: {N}. Next check-in scheduled.</internal>
```

## Important Notes

- STEP 1 (rescheduling) MUST happen first — even if the rest fails, the chain continues
- The coin flip (60% proceed, 40% skip) means some runs are silent. This is intentional — keeps it unpredictable.
- Night guard: never send messages between 1am and 7am Toronto/EST time. If the task somehow runs in that window, just reschedule and skip.
- Keep check-in messages SHORT. 1-2 messages max. This is a conversation starter, not a monologue.
- If the user engages, continue the conversation naturally (the container stays alive for follow-up messages via IPC)
