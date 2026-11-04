-- Sections so the phone can group a long menu. sort_order is the board order;
-- phones list a section's drinks together when they ORDER BY sort_order.
ALTER TABLE menu_item ADD COLUMN section TEXT NOT NULL DEFAULT '';
ALTER TABLE menu_item ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

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
    version = (SELECT version FROM sync_state);

WITH drinks (id, name, section, sort_order) AS (VALUES
    ('espresso',          'Espresso',                     'Coffee',       70),
    ('short-macchiato',   'Short macchiato',              'Coffee',       80),
    ('long-macchiato',    'Long macchiato',               'Coffee',       90),
    ('piccolo',           'Piccolo',                      'Coffee',      100),
    ('affogato',          'Affogato',                     'Coffee',      110),
    ('caramel-macchiato', 'Caramel macchiato',            'Coffee',      150),
    ('hazelnut-latte',    'Hazelnut latte',               'Coffee',      160),
    ('salted-caramel-latte', 'Salted caramel latte',      'Coffee',      170),
    ('vanilla-latte',     'Vanilla latte',                'Coffee',      180),
    ('white-chocolate-latte', 'White chocolate latte',    'Coffee',      190),

    ('tea',               'Tea',                          'Tea',         210),

    ('iced-coffee',       'Iced coffee',                  'Iced coffee', 310),
    ('iced-latte',        'Iced latte',                   'Iced coffee', 320),
    ('iced-mocha',        'Iced mocha',                   'Iced coffee', 330),
    ('iced-americano',    'Iced americano',               'Iced coffee', 340),
    ('iced-long-black',   'Iced long black',              'Iced coffee', 350),
    ('caramel-iced-latte','Caramel iced latte',           'Iced coffee', 360),
    ('vanilla-iced-latte','Vanilla iced latte',           'Iced coffee', 370),
    ('hazelnut-iced-latte','Hazelnut iced latte',         'Iced coffee', 380),
    ('salted-caramel-iced-latte', 'Salted caramel iced latte', 'Iced coffee', 390),
    ('white-chocolate-iced-latte', 'White chocolate iced latte', 'Iced coffee', 400),
    ('iced-matcha',       'Iced matcha latte',            'Iced coffee', 410),
    ('iced-chai',         'Iced chai latte',              'Iced coffee', 420),
    ('iced-chocolate',    'Iced chocolate',               'Iced coffee', 430),

    ('frappe-coffee',     'Coffee frappe',                'Frappes',     510),
    ('frappe-matcha',     'Matcha frappe',                'Frappes',     520),
    ('frappe-chai-sweet', 'Sweet chai frappe',            'Frappes',     530),
    ('frappe-chai-spicy', 'Spicy chai frappe',            'Frappes',     540),
    ('frappe-mocha',      'Mocha frappe',                 'Frappes',     550),
    ('frappe-caramel',    'Caramel frappe',               'Frappes',     560),
    ('frappe-salted-caramel', 'Salted caramel frappe',    'Frappes',     570),
    ('frappe-vanilla',    'Vanilla frappe',               'Frappes',     580),
    ('frappe-white-chocolate', 'White chocolate frappe',  'Frappes',     590),
    ('frappe-chocolate',  'Chocolate frappe',             'Frappes',     600),

    ('smoothie-berry',    'Berry smoothie',               'Smoothies',   710),
    ('smoothie-mango',    'Mango smoothie',               'Smoothies',   720),

    ('shake-chocolate',   'Chocolate milkshake',          'Milkshakes',  810),
    ('shake-caramel',     'Caramel milkshake',            'Milkshakes',  820),
    ('shake-vanilla',     'Vanilla milkshake',            'Milkshakes',  830),
    ('shake-banana',      'Banana milkshake',             'Milkshakes',  840),
    ('shake-strawberry',  'Strawberry milkshake',         'Milkshakes',  850),

    ('iced-tea-peach',    'Peach iced tea',               'Iced tea',    910),
    ('iced-tea-feijoa',   'Feijoa & lime iced tea',       'Iced tea',    920),
    ('iced-tea-chai',     'Chai iced tea',                'Iced tea',    930),

    ('fizzy-passion-fruit','Passion fruit fizzy',         'Fizzy',      1010),
    ('fizzy-strawberry',  'Strawberry fizzy',             'Fizzy',      1020)
)
INSERT INTO menu_item (id, name, section, sort_order, version)
SELECT id, name, section, sort_order, (SELECT version FROM sync_state) FROM drinks;
