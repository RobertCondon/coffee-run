-- Flavours are a choice on the drink, like milk: a JSON list, [] when the
-- drink has none. The chosen flavour is stored on the order.
ALTER TABLE menu_item ADD COLUMN flavours TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coffee_order ADD COLUMN flavour TEXT;

UPDATE sync_state SET version = version + 1;

-- The cold board prices "Iced Coffee / Latte" as one line.
UPDATE menu_item SET
    name = 'Iced coffee / latte',
    version = (SELECT version FROM sync_state)
WHERE id = 'iced-coffee';

UPDATE menu_item SET
    deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    version = (SELECT version FROM sync_state)
WHERE id = 'iced-latte';

-- Specialty latte and flavoured iced latte are one drink plus a flavour,
-- not a chip per flavour.
INSERT INTO menu_item (id, name, section, sort_order, sizes, allows_milk, flavours, version)
VALUES
    ('specialty-latte', 'Specialty latte', 'Coffee', 125,
     '["small","regular","large"]', 1,
     '["hazelnut","salted caramel","matcha green tea","vanilla","white chocolate"]',
     (SELECT version FROM sync_state)),
    ('flavoured-iced-latte', 'Flavoured iced latte', 'Iced coffee', 355,
     '["regular","large"]', 1,
     '["caramel","vanilla","hazelnut","salted caramel","white chocolate"]',
     (SELECT version FROM sync_state));

UPDATE menu_item SET
    deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
    version = (SELECT version FROM sync_state)
WHERE id IN (
    'hazelnut-latte', 'salted-caramel-latte', 'vanilla-latte', 'white-chocolate-latte',
    'caramel-iced-latte', 'vanilla-iced-latte', 'hazelnut-iced-latte',
    'salted-caramel-iced-latte', 'white-chocolate-iced-latte'
);
