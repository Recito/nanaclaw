---
name: cooking-planning
description: Search 322 Chinese recipes from HowToCook, track fridge inventory, and plan meals based on what's available. Supports recipe search, random picks, category browsing, and fridge-aware meal planning.
---

# Cooking & Meal Planning

Search Chinese recipes, track fridge inventory, and plan meals. Recipe database from the HowToCook project (322 recipes, programmer-style with exact measurements).

## Data Files

All files are in this skill directory (`/home/node/.claude/skills/cooking-planning/`):

- `all_recipes.json` — 322 recipes with structured fields (read-only, query with python3)
- `fridge.md` — template for fridge inventory (copy to workspace on first use)

## Fridge File Location

The fridge inventory lives at `/workspace/group/fridge.md` (persistent across restarts).

On first `/cook fridge` or `/cook plan`, check if `/workspace/group/fridge.md` exists. If not, copy the template:
```bash
cp /home/node/.claude/skills/cooking-planning/fridge.md /workspace/group/fridge.md
```

All reads and writes to fridge go to `/workspace/group/fridge.md`, NOT the skill directory copy.

**IMPORTANT:** `all_recipes.json` is 1.5 MB. NEVER read it directly or dump it into context. Always query with python3.

## Recipe Data Structure

Each recipe in `all_recipes.json` has:
- `name` — dish name (e.g. "辣椒炒肉的做法")
- `category` — one of: 荤菜(97), 素菜(54), 主食(47), 水产(24), 早餐(22), 饮品(21), 汤(21), 甜品(17), 半成品加工(10), 调料(9)
- `difficulty` — 1-5 stars
- `ingredients[]` — each has `name`, `quantity`, `unit`, `text_quantity`
- `steps[]` — each has `order`, `content`
- `description` — full markdown recipe text
- `tags[]` — searchable tags
- `servings`, `prep_time`, `cook_time`

## Querying Recipes

### Search by name or keyword
```bash
python3 -c "
import json
with open('/home/node/.claude/skills/cooking-planning/all_recipes.json') as f:
    recipes = json.load(f)
for r in recipes:
    if 'KEYWORD' in r['name'] or any('KEYWORD' in i['name'] for i in r.get('ingredients', [])):
        print(f\"{r['name']} | {r['category']} | 难度:{r['difficulty']} | 食材: {', '.join(i['name'] for i in r.get('ingredients', [])[:5])}\")"
```

### Browse by category
```bash
python3 -c "
import json
with open('/home/node/.claude/skills/cooking-planning/all_recipes.json') as f:
    recipes = json.load(f)
for r in recipes:
    if r['category'] == 'CATEGORY':
        print(f\"{r['name']} | 难度:{r['difficulty']}\")"
```

### Get full recipe by name
```bash
python3 -c "
import json
with open('/home/node/.claude/skills/cooking-planning/all_recipes.json') as f:
    recipes = json.load(f)
for r in recipes:
    if 'DISH_NAME' in r['name']:
        print(r['description'])
        break"
```

### Random pick
```bash
python3 -c "
import json, random
with open('/home/node/.claude/skills/cooking-planning/all_recipes.json') as f:
    recipes = json.load(f)
r = random.choice(recipes)
print(f\"{r['name']} | {r['category']} | 难度:{r['difficulty']}\"
      f\"\n食材: {', '.join(i['name'] for i in r.get('ingredients', [])[:8])}\")"
```

### Find recipes matching fridge ingredients
```bash
python3 -c "
import json
with open('/home/node/.claude/skills/cooking-planning/all_recipes.json') as f:
    recipes = json.load(f)

# Replace this list with actual fridge contents
fridge = ['鸡蛋', '青椒', '西红柿', '五花肉', '豆腐']

results = []
for r in recipes:
    ing_names = [i['name'] for i in r.get('ingredients', [])]
    matches = sum(1 for f_item in fridge if any(f_item in ing for ing in ing_names))
    if matches >= 2:
        results.append((matches, r['name'], r['category'], r['difficulty'], ing_names[:6]))

results.sort(reverse=True)
for matches, name, cat, diff, ings in results[:10]:
    print(f\"[{matches}个匹配] {name} | {cat} | 难度:{diff} | 食材: {', '.join(ings)}\")"
```

## Usage Modes

### `/cook <keyword>` — Search for a recipe

1. Search by keyword in recipe name and ingredients
2. Show top matches with category, difficulty, key ingredients
3. If user picks one, show the full recipe (from `description` field)
4. Format nicely — ingredients list, then numbered steps

### `/cook category <name>` — Browse a category

Valid categories: 荤菜, 素菜, 主食, 水产, 早餐, 饮品, 汤, 甜品, 半成品加工, 调料

1. List all recipes in the category with difficulty ratings
2. Let user pick one for details

### `/cook what` — Random recipe suggestion

1. Pick a random recipe
2. Present it with a fun intro: "今天试试这个？"
3. Show name, difficulty, and key ingredients
4. If user says yes, show full recipe

### `/cook plan` — Meal plan based on fridge

1. Read `/workspace/group/fridge.md` for current inventory
2. Match fridge contents against recipe ingredients
3. Suggest 3-5 recipes that can be made with what's available
4. Rank by number of matching ingredients (more matches = more practical)
5. Flag any missing key ingredients: "你有青椒和五花肉，做辣椒炒肉只差蒜和生抽"
6. If fridge is empty/outdated, ask user to update it first

### `/cook fridge` — Update fridge inventory

1. Read current `fridge.md` and show summary to user
2. Ask what changed: "买了什么新的？用掉了什么？"
3. Update `/workspace/group/fridge.md` with changes
4. Update the "Last updated" date
5. After updating, optionally suggest: "要不要我看看能做什么？"

### `/cook fridge <items>` — Quick add to fridge

1. Parse the items from the message (e.g. "鸡蛋 x10, 青椒 x4, 五花肉 300g")
2. Add to the appropriate section in `/workspace/group/fridge.md`
3. Update the "Last updated" date
4. Confirm what was added

## Response Style

- Keep recipe presentations clean — ingredients first, then steps
- Use the exact measurements from the recipe (this is the whole point of HowToCook)
- For meal planning, be practical: suggest what's easiest with what's available
- When something is missing a few ingredients, mention what to buy
- Difficulty context: 1★ = beginner, 2★ = easy, 3★ = intermediate, 4★ = advanced, 5★ = expert

## Fridge Inventory Guidelines

When updating `/workspace/group/fridge.md`:
- Keep entries concise: `item quantity (optional expiry)`
- Group items into the right section (Proteins, Vegetables, etc.)
- Remove items when user says they've been used up
- Note expiry dates when mentioned
- Pantry staples (soy sauce, oil, etc.) don't need quantities — just presence

## Integration with Other Skills

- **check-in**: Category 4 (Food) can reference recent fridge contents or suggest trying a new recipe
- The check-in skill can mention: "你冰箱里的XX快过期了，要不要今天做个YY？"
