UPDATE sync_state SET version = version + 1;

WITH drinks (id, name) AS (VALUES
                               ('flat-white', 'Flat white'),
                               ('long-black', 'Long black'),
                               ('latte',      'Latte'),
                               ('cappuccino', 'Cappuccino'),
                               ('mocha',      'Mocha'),
                               ('matcha',     'Matcha latte'),
                               ('chai',       'Chai latte'),
                               ('hot-choc',   'Hot chocolate'),
                               ('americano',   'Americano')
)
INSERT INTO menu_item (id, name, version)
SELECT id, name, (SELECT version FROM sync_state) FROM drinks;