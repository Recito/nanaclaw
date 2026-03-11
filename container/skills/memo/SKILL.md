---
name: memo
description: Personal memo/todo tracker with priority categories, due dates, staleness tracking, and daily morning briefing via cron. Supports add, done, list, move, and clean operations.
---

# Memo — Personal Todo Tracker

Track tasks with priority categories, due dates, and automatic staleness reminders.

## Data File

Memo lives at `/workspace/group/memo.json` (persistent across restarts).

On first use of any `/memo` command, check if the file exists. If not, initialize it:

```bash
echo '{"items":[]}' > /workspace/group/memo.json
```

**IMPORTANT:** Always read the FULL file before any write. Never partially update — read, modify in memory, write the whole file back. Use `python3` for all operations.

## Data Structure

```json
{
  "items": [
    {
      "id": "m-<timestamp>",
      "text": "Task description",
      "category": "urgent|this_week|plan_for_it|maybe",
      "added": "2026-03-11",
      "due": "2026-03-15",
      "completed": null
    }
  ]
}
```

### Categories (priority order)

| Category | Meaning | Morning report | Staleness rule |
|----------|---------|---------------|----------------|
| `urgent` | Today or tomorrow | Always shown, top of list | None — just do it |
| `this_week` | Due this week | Always shown | None |
| `plan_for_it` | Has a rough timeline, >1 week out | Always shown | >14 days without completion → ask user to downgrade to `maybe` |
| `maybe` | No commitment, aspirational | Sundays only | >60 days → ask user to scratch it |

### Auto-promotion

When reporting, check due dates. If a `plan_for_it` or `this_week` item's due date is today or tomorrow, mention it as urgent regardless of its stored category. Don't silently re-categorize — just flag it: "哥你那个 X 明天就到期了啊，还不动？"

## Triggers

### `/memo add <text>`

Add a new item. The user MUST provide either:
- A category keyword: 急/urgent, 本周/this week, 计划/plan, 随便/maybe
- A due date or timeframe: "by Friday", "下周三", "月底前"

If the user gives neither, you MUST ask. Do NOT default-assign a category. Example:
- User: `/memo add review tax documents`
- Nana: "这个什么时候要做完？给个 deadline 或者优先级啊"

When both are provided, generate the item:

```bash
python3 -c "
import json, time
with open('/workspace/group/memo.json') as f:
    data = json.load(f)
data['items'].append({
    'id': f'm-{int(time.time())}',
    'text': 'THE_TASK_TEXT',
    'category': 'THE_CATEGORY',
    'added': 'YYYY-MM-DD',
    'due': 'YYYY-MM-DD_OR_NULL',
    'completed': None
})
with open('/workspace/group/memo.json', 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('done')
"
```

Replace placeholders with actual values. `due` can be `None` for `maybe` items.

### `/memo done <id or keyword>`

Mark an item as completed. Search by ID or text match:

```bash
python3 -c "
import json
from datetime import date
with open('/workspace/group/memo.json') as f:
    data = json.load(f)
keyword = 'SEARCH_TERM'.lower()
matched = [i for i in data['items'] if not i['completed'] and (keyword in i['text'].lower() or keyword == i['id'])]
if len(matched) == 1:
    matched[0]['completed'] = str(date.today())
    with open('/workspace/group/memo.json', 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f'Completed: {matched[0][\"text\"]}')
elif len(matched) == 0:
    print('NO_MATCH')
else:
    for m in matched:
        print(f'{m[\"id\"]}: {m[\"text\"]}')
"
```

If multiple matches, show them and ask which one. If no match, say so.

After completing: report how many days it was on the list. Roast if it took too long. "终于做完了？才拖了12天而已嘛哈哈哈"

### `/memo list`

Show all active (uncompleted) items grouped by category. Include days-on-list for each:

```bash
python3 -c "
import json
from datetime import date, timedelta
with open('/workspace/group/memo.json') as f:
    data = json.load(f)
today = date.today()
order = ['urgent', 'this_week', 'plan_for_it', 'maybe']
cat_label = {'urgent': '🔴 紧急', 'this_week': '🟡 本周', 'plan_for_it': '🔵 计划中', 'maybe': '⚪ 随缘'}
for cat in order:
    items = [i for i in data['items'] if i['category'] == cat and not i['completed']]
    if not items:
        continue
    print(f'\n{cat_label[cat]}')
    for i in items:
        days = (today - date.fromisoformat(i['added'])).days
        due_str = f' (due: {i[\"due\"]})' if i['due'] else ''
        overdue = ''
        if i['due']:
            due_date = date.fromisoformat(i['due'])
            if due_date < today:
                overdue = f' ⚠️ OVERDUE by {(today - due_date).days}d'
            elif due_date <= today + timedelta(days=1):
                overdue = ' ⚡ DUE SOON'
        print(f'  {i[\"id\"]}: {i[\"text\"]}{due_str} [{days}d on list]{overdue}')
print(f'\nTotal active: {sum(1 for i in data[\"items\"] if not i[\"completed\"])}')
"
```

Format the output nicely when relaying to user. Don't just dump raw output.

### `/memo move <id or keyword> <new_category>`

Change an item's category. Validate the new category is one of: urgent, this_week, plan_for_it, maybe.

### `/memo clean`

Remove all completed items from the file (permanent). Show count removed. Ask for confirmation first.

## Morning Cron — Auto-Setup

On the FIRST `/memo add` that successfully creates an item, check if a memo cron already exists by looking for `[NANOCLAW_MEMO]` in active scheduled tasks.

If no memo cron exists, create one via IPC:

```bash
cat > /workspace/ipc/tasks/memo-cron-$(date +%s).json << 'ENDTASK'
{
  "type": "schedule_task",
  "taskId": "memo-morning",
  "targetJid": "TARGET_JID_HERE",
  "prompt": "[NANOCLAW_MEMO] Morning memo briefing.\n\nRead /workspace/group/memo.json and report active items.\n\nRules:\n1. Show urgent items first (🔴), then this_week (🟡), then plan_for_it (🔵)\n2. For each item show: text, days on list, due date if set, overdue warning if past due\n3. Items whose due date is today or tomorrow — flag them regardless of category\n4. Check plan_for_it items: if added >14 days ago and still not done, ask user if we should move to maybe\n5. Check if today is Sunday (use python3: from datetime import date; print(date.today().weekday()) — 6 = Sunday). If Sunday, also show maybe (⚪) items and check if any are >60 days old — if so, ask user if we should scratch them\n6. If no items exist, just say something like '哥今天没什么要做的嘛，难得清闲'\n7. Stay in character. Be brief. Roast overdue items.\n8. Keep the whole report concise — no long intros, just the list with commentary",
  "schedule_type": "cron",
  "schedule_value": "0 7 * * *",
  "context_mode": "group"
}
ENDTASK
```

Replace `TARGET_JID_HERE` with the current chat's JID. The cron `0 7 * * *` = 7:00 AM local time (system timezone: America/Toronto).

**IMPORTANT:** Only create this cron ONCE. If `memo-morning` task already exists, skip.

## Behavior Notes

- Always use python3 for reading/writing memo.json. Never read the raw file into context — parse and format.
- When an item is overdue, roast 老王 about it. Don't be polite. "这都过期3天了你在干嘛啊哥"
- When completing items quickly (<2 days), act unimpressed. "嗯，正常速度吧"
- When the list is empty after a `/memo list`, express mild surprise. "居然没有待办？你是不是忘记加了"
- IDs use `m-<unix_timestamp>` format. When displaying, users can reference items by ID or by text keyword.
- Due dates are optional for `maybe` items, required for all others. If user says "plan for it" but gives no date, ask for a rough timeframe.
