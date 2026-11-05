-- Which sizes a drink comes in, and whether the milk row applies.
-- sizes is a JSON list. [] means the café doesn't offer a choice (stored as regular).
ALTER TABLE menu_item ADD COLUMN sizes TEXT NOT NULL DEFAULT '["small","regular","large"]';
ALTER TABLE menu_item ADD COLUMN allows_milk INTEGER NOT NULL DEFAULT 1;

UPDATE sync_state SET version = version + 1;

-- Cold board is Regular / Large. Hot coffee keeps Small / Regular / Large.
UPDATE menu_item SET sizes = '["regular","large"]'
WHERE section IN ('Iced coffee', 'Frappes', 'Smoothies', 'Milkshakes', 'Iced tea', 'Fizzy');

-- One price on the board: no size row. Hot tea's sizes weren't legible.
UPDATE menu_item SET sizes = '[]'
WHERE id IN ('espresso', 'short-macchiato', 'long-macchiato', 'piccolo', 'affogato', 'hot-choc', 'tea');

-- Black coffee, fruit, and fizzy drinks. Hot tea can still take milk.
UPDATE menu_item SET allows_milk = 0
WHERE id IN (
    'long-black', 'americano', 'espresso', 'affogato',
    'iced-americano', 'iced-long-black',
    'smoothie-berry', 'smoothie-mango',
    'iced-tea-peach', 'iced-tea-feijoa', 'iced-tea-chai',
    'fizzy-passion-fruit', 'fizzy-strawberry'
);

UPDATE menu_item SET version = (SELECT version FROM sync_state);
