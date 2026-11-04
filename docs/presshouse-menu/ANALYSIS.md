# Presshouse menu → Coffee-run expansion

Branch: `feature/presshouse-menu-expansion` (local only; not pushed).

Sections are in. `menu_item.section` and `sort_order` sync to the phone, and My Order groups drinks under those headings. Migration `0003_menu_sections.sql` files the Presshouse drinks into Coffee, Tea, Iced coffee, Frappes, Smoothies, Milkshakes, Iced tea, and Fizzy. Flavours are separate drinks for now (no variant column yet). Hot-board tea flavours were not legible, so tea is a single drink. Size sets are still global: every drink offers small, regular, and large.

Source: `menu.json` transcribed from `source-photo.jpg`.

## What Coffee-run has today

| Layer | Shape |
| --- | --- |
| `menu_item` | `{ id, name }` only — 9 flat rows in `db/migrations/0002_menu.sql` |
| Order | `menu_item_id` + `size` + `milk` + `extras[]` + `note` |
| Sizes | Hard CHECK / UI list: `small`, `regular`, `large` for every drink |
| Milk / extras | Hardcoded in `web/src/screens/MyOrder.tsx`, not synced from the server |
| Sync | Menu is name-only (`SyncMenuItem`); options never leave the phone |
| Docket / Who | Labels built from drink + size + milk + extras (`db/views.sql`) |

Current seed drinks: flat white, long black, latte, cappuccino, mocha, matcha latte, chai latte, hot chocolate, americano.

Coffee-run is an office runner app, not a till — **prices are optional**. Ordering correctness (drink + size + milk + flavour on the docket) matters more than NZD.

## Gap map (photo → model)

### 1. Volume of items

Presshouse has ~15 hot lines and ~7 cold groups, many with flavours. A naive “one `menu_item` per flavour” explosion yields **40+ chips** on My Order. The current chip grid does not scale.

**Change:** either explode and add search/sections, or keep base products + a required **variant** field (see below).

### 2. Category-specific size sets

| Board | Sizes |
| --- | --- |
| Hot coffee (most) | Small / Regular / Large |
| Cold drinks | Regular / Large only |
| Espresso, macchiato, piccolo, affogato (and maybe hot choc) | Fixed / no size columns |

Today every order must pick one of three sizes; iced drinks would wrongly offer Small, and espresso would wrongly offer Large.

**Changes needed:**

- Per-item (or per-category) **allowed sizes**, synced with the menu.
- Relax or replace `coffee_order.size CHECK (size IN (...))` — e.g. allow `''` / `'fixed'` / item-driven validation in Go instead of a global CHECK.
- My Order: only show sizes valid for the selected drink; default to the café’s “regular” when present.
- Docket: map café names carefully (today `regular` → “Medium” in `Docket.tsx`; Presshouse says Regular).

### 3. Flavour / style variants (biggest structural gap)

Many board rows are **one price, many flavours**:

- Specialty Latte → Hazelnut, Salted Caramel, Matcha, Vanilla, White Chocolate  
- Flavoured Iced Latte → same syrup set  
- Frappe → 9 flavours  
- Milkshake, Smoothie, Iced Tea, Fizzy  
- Chai / Iced Chai → Sweet / Spicy  
- Macchiato → Short / Long  
- Combined names → Long Black vs Americano, Iced Coffee vs Iced Latte  

Today flavours are jammed into free-form `extras[]` (and the UI only offers vanilla/caramel/hazelnut). That:

- does not require a flavour when the board expects one  
- cannot express “chai spicy” vs “chai sweet” cleanly  
- mixes syrup add-ons with base identity on the docket  

**Recommended model change (minimal but real):**

```text
coffee_order.variant  TEXT NULL   -- e.g. "salted-caramel", "spicy"
menu_item metadata     → which variants are allowed / required
```

Or keep a single string in `extras` but treat **required single-choice option groups** as first-class in validation and UI (radio chips), separate from multi-select extras (extra shot, decaf).

**Docket / views:** include variant in `v_docket` / `v_coffee_order_line` so the runner says “large oat salted caramel specialty latte”, not “large oat specialty latte + salted caramel” unless that matches how the till reads it.

### 4. Combined / aliased drinks

Presshouse prints **Long Black (2 shots) / Americano (1 shot)** as one priced line. Coffee-run currently has them as **two** menu rows (good for the runner: different cups). Same for iced coffee/latte and iced americano/long black.

**Prefer:** keep separate `menu_item`s that share a price band / section in UI, rather than one item with a variant — shot count is identity, not a syrup.

### 5. Milk modifiers

Photo: Almond / Coconut / Oat / Soy (+ ~$1).

App today: full cream, trim, oat, soy, almond — **missing coconut**, and milk list is client-only.

**Changes:**

- Add `coconut` (and decide whether “regular/full cream” stays as empty milk = default).
- Optionally sync milk options from the server so phones stay aligned.
- Hide milk chips for non-milk drinks (americano, tea, smoothie, fizzy) — today milk is always shown.
- Surcharge can stay out of scope unless you start showing prices.

### 6. Extras vs board flavours

Current extras: `extra shot`, `decaf`, `vanilla`, `caramel`, `hazelnut`.

After variants exist, syrup names should mostly leave `extras` and become **variant** (or a dedicated flavour group). Keep extras for true add-ons: extra shot, decaf, sugar notes (or use `note`).

Server already caps extras at 5 and sorts/dedupes — keep that for add-ons only.

### 7. Hot vs cold / sections

No category on `menu_item`. Presshouse is two boards with many sections. With 30+ drinks, alphabetical chips are painful.

**Changes:**

- Add `category` / `section` / `sort_order` (and maybe `board`: hot|cold) to `menu_item` (or a JSON `meta` column synced to phones).
- My Order UI: section headings or Hot / Cold tabs; search if the list stays flat.
- Sync payload grows: today only `id, name, version, deleted_at`.

### 8. Prices (optional)

Not stored anywhere. Fine for Coffee-run’s job. If you ever show them:

- `menu_item_price(menu_item_id, size, amount)` or prices JSON on the item  
- still need size schemes from §2  

Skip unless product asks for it.

### 9. Seed / migration strategy

`0002_menu.sql` inserts nine rows. Expanding means a **new migration** that:

- inserts new items (frappes, iced lines, etc.)
- optionally renames `mocha` → `mochaccino` (or add alias and soft-delete old id — careful: existing `coffee_order.menu_item_id` FKs)
- bumps `sync_state.version` so phones pull the new menu

Do **not** rewrite history of `0002` on a live DB; add `0003_presshouse_menu.sql`.

### 10. Validation & sync surface area

| File | Touch if expanding properly |
| --- | --- |
| `db/migrations/0001_init.sql` / new migration | size CHECK, new columns |
| `db/client.sql` | phone mirror schema |
| `db/views.sql` | labels include variant / hide irrelevant size |
| `internal/server/validate.go` | size ∈ item.sizes; variant required when needed |
| `internal/server/sync.go` + `web/src/types.ts` | richer `SyncMenuItem` |
| `web/src/db/sync.ts` | INSERT new columns |
| `web/src/screens/MyOrder.tsx` | sections, conditional sizes/milk, variant chips |
| `web/src/screens/Docket.tsx` | size display names; variant line |

## Suggested rollout (pragmatic)

**Phase A — content only (fits today’s schema)**  
Add every Presshouse drink people actually order as separate `menu_item`s; put Sweet/Spicy and syrups in `extras` or `note`. Accept crowded chips and wrong size options. Fast, fragile.

**Phase B — menu metadata (recommended next)**  
Sync `section`, `allowed_sizes`, `requires_milk`, `variants[]` with each item. UI becomes data-driven. Add `coffee_order.variant`. No prices yet.

**Phase C — polish**  
Hot/Cold tabs, search, coconut milk, hide irrelevant controls, docket wording matched to Presshouse till, optional prices.

## Mapping existing seeds → Presshouse

| Current id | Presshouse | Action |
| --- | --- | --- |
| `flat-white` | Flat White | keep |
| `cappuccino` | Cappuccino | keep |
| `latte` | Latte | keep |
| `mocha` | Mochaccino | rename display name; keep id or migrate |
| `long-black` / `americano` | same priced line, different shots | keep both |
| `matcha` | Specialty / iced matcha | split hot specialty flavour vs iced item |
| `chai` | Chai Latte (Sweet/Spicy) | keep + require variant |
| `hot-choc` | Hot Chocolate | keep; confirm sizes |
| — | cold board, frappes, smoothies, shakes, iced tea, fizzy | **new items** |
| — | espresso, macchiato, piccolo, affogato, caramel macchiato, … | **new items** |

## Open confirmations (photo limits)

1. Exact prices for single-price hot items (espresso, macchiato, piccolo, affogato, hot chocolate).  
2. Whether hot chocolate / specialty rows use all three sizes.  
3. Full tea list and tea prices.  
4. White Mochaccino / London Fog — present but low confidence.  
5. Alternative milk surcharge ($1?) and whether coconut is the only milk missing from the app.

A sharper photo of the hot board (or a till export) would lock Phase B seed data.
