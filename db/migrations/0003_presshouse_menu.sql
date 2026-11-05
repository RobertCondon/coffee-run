-- Presshouse board: sections, per-drink sizes/milk/flavours, and the expanded list.
ALTER TABLE menu_item ADD COLUMN section TEXT NOT NULL DEFAULT '';
ALTER TABLE menu_item ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_item ADD COLUMN sizes TEXT NOT NULL DEFAULT '["small","regular","large"]';
ALTER TABLE menu_item ADD COLUMN allows_milk INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menu_item ADD COLUMN flavours TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coffee_order ADD COLUMN flavour TEXT;

UPDATE sync_state SET version = version + 1;

-- Keep the original ids: existing orders point at them. Mocha is the café's
-- mochaccino. Tea flavours on the hot board were not legible, so tea is one
-- drink until those names are confirmed.
UPDATE menu_item SET
    name = CASE id WHEN 'mocha' THEN 'Mochaccino' ELSE name END,
    section = 'Coffee',
    sort_order = CASE id
        WHEN 'flat-white' THEN 10
        WHEN 'cappuccino' THEN 20
        WHEN 'mocha'      THEN 30
        WHEN 'latte'      THEN 40
        WHEN 'long-black' THEN 50
        WHEN 'americano'  THEN 60
        WHEN 'hot-choc'   THEN 120
        WHEN 'matcha'     THEN 130
        WHEN 'chai'       THEN 140
    END,
    sizes = CASE id
        WHEN 'hot-choc' THEN '[]'
        ELSE '["small","regular","large"]'
    END,
    allows_milk = CASE id
        WHEN 'long-black' THEN 0
        WHEN 'americano'  THEN 0
        ELSE 1
    END,
    version = (SELECT version FROM sync_state);

WITH drinks (id, name, section, sort_order, sizes, allows_milk, flavours) AS (VALUES
    ('espresso',          'Espresso',                     'Coffee',       70, '[]', 0, '[]'),
    ('short-macchiato',   'Short macchiato',              'Coffee',       80, '[]', 1, '[]'),
    ('long-macchiato',    'Long macchiato',               'Coffee',       90, '[]', 1, '[]'),
    ('piccolo',           'Piccolo',                      'Coffee',      100, '[]', 1, '[]'),
    ('affogato',          'Affogato',                     'Coffee',      110, '[]', 0, '[]'),
    ('specialty-latte',   'Specialty latte',              'Coffee',      125,
        '["small","regular","large"]', 1,
        '["hazelnut","salted caramel","matcha green tea","vanilla","white chocolate"]'),
    ('caramel-macchiato', 'Caramel macchiato',            'Coffee',      150,
        '["small","regular","large"]', 1, '[]'),
    ('white-mocha',       'White mocha',                  'Coffee',      160,
        '["small","regular","large"]', 1, '[]'),
    ('london-fog',        'London fog latte',             'Coffee',      170,
        '["small","regular","large"]', 1, '[]'),

    ('tea',               'Tea',                          'Tea',         210, '[]', 1,
        '["breakfast","earl grey","forest berry","camomile","peppermint","green tea","lemon tea"]'),

    -- Cold board prices iced coffee and iced latte as one line.
    ('iced-coffee',       'Iced coffee / latte',          'Iced coffee', 310,
        '["regular","large"]', 1, '[]'),
    ('iced-mocha',        'Iced mocha',                   'Iced coffee', 330,
        '["regular","large"]', 1, '[]'),
    ('iced-americano',    'Iced americano',               'Iced coffee', 340,
        '["regular","large"]', 0, '[]'),
    ('iced-long-black',   'Iced long black',              'Iced coffee', 350,
        '["regular","large"]', 0, '[]'),
    ('flavoured-iced-latte', 'Flavoured iced latte',      'Iced coffee', 355,
        '["regular","large"]', 1,
        '["caramel","vanilla","hazelnut","salted caramel","white chocolate"]'),
    ('iced-matcha',       'Iced matcha latte',            'Iced coffee', 410,
        '["regular","large"]', 1, '[]'),
    ('iced-chai',         'Iced chai latte',              'Iced coffee', 420,
        '["regular","large"]', 1, '[]'),
    ('iced-chocolate',    'Iced chocolate',               'Iced coffee', 430,
        '["regular","large"]', 1, '[]'),

    ('frappe-coffee',     'Coffee frappe',                'Frappes',     510,
        '["regular","large"]', 1, '[]'),
    ('frappe-matcha',     'Matcha frappe',                'Frappes',     520,
        '["regular","large"]', 1, '[]'),
    ('frappe-chai-sweet', 'Sweet chai frappe',            'Frappes',     530,
        '["regular","large"]', 1, '[]'),
    ('frappe-chai-spicy', 'Spicy chai frappe',            'Frappes',     540,
        '["regular","large"]', 1, '[]'),
    ('frappe-mocha',      'Mocha frappe',                 'Frappes',     550,
        '["regular","large"]', 1, '[]'),
    ('frappe-caramel',    'Caramel frappe',               'Frappes',     560,
        '["regular","large"]', 1, '[]'),
    ('frappe-salted-caramel', 'Salted caramel frappe',    'Frappes',     570,
        '["regular","large"]', 1, '[]'),
    ('frappe-vanilla',    'Vanilla frappe',               'Frappes',     580,
        '["regular","large"]', 1, '[]'),
    ('frappe-white-chocolate', 'White chocolate frappe',  'Frappes',     590,
        '["regular","large"]', 1, '[]'),
    ('frappe-chocolate',  'Chocolate frappe',             'Frappes',     600,
        '["regular","large"]', 1, '[]'),

    ('smoothie-berry',    'Berry smoothie',               'Smoothies',   710,
        '["regular","large"]', 0, '[]'),
    ('smoothie-mango',    'Mango smoothie',               'Smoothies',   720,
        '["regular","large"]', 0, '[]'),

    ('shake-chocolate',   'Chocolate milkshake',          'Milkshakes',  810,
        '["regular","large"]', 1, '[]'),
    ('shake-caramel',     'Caramel milkshake',            'Milkshakes',  820,
        '["regular","large"]', 1, '[]'),
    ('shake-vanilla',     'Vanilla milkshake',            'Milkshakes',  830,
        '["regular","large"]', 1, '[]'),
    ('shake-banana',      'Banana milkshake',             'Milkshakes',  840,
        '["regular","large"]', 1, '[]'),
    ('shake-strawberry',  'Strawberry milkshake',         'Milkshakes',  850,
        '["regular","large"]', 1, '[]'),

    ('iced-tea-peach',    'Peach iced tea',               'Iced tea',    910,
        '["regular","large"]', 0, '[]'),
    ('iced-tea-feijoa',   'Feijoa & lime iced tea',       'Iced tea',    920,
        '["regular","large"]', 0, '[]'),
    ('iced-tea-chai',     'Chai iced tea',                'Iced tea',    930,
        '["regular","large"]', 0, '[]'),

    ('fizzy-passion-fruit','Passion fruit fizzy',         'Fizzy',      1010,
        '["regular","large"]', 0, '[]'),
    ('fizzy-strawberry',  'Strawberry fizzy',             'Fizzy',      1020,
        '["regular","large"]', 0, '[]')
)
INSERT INTO menu_item (id, name, section, sort_order, sizes, allows_milk, flavours, version)
SELECT id, name, section, sort_order, sizes, allows_milk, flavours,
       (SELECT version FROM sync_state)
FROM drinks;
