DROP VIEW IF EXISTS v_docket;
DROP VIEW IF EXISTS v_tally;
DROP VIEW IF EXISTS v_coffee_order_line;
DROP VIEW IF EXISTS v_past_drinks;

-- One row per cup, for the docket the runner reads out at the counter. The
-- parts stay separate so the screen can lay them out like the café's till:
-- "Flat White Medium", then "-> Oat" lines.
CREATE VIEW v_docket AS
SELECT
    coffee_order.day,
    coffee_order.id,
    menu_item.name AS drink,
    coffee_order.size,
    menu_item.sizes,
    coffee_order.milk,
    coffee_order.flavour,
    coffee_order.extras,
    coffee_order.note
FROM coffee_order AS coffee_order
JOIN menu_item AS menu_item ON menu_item.id = coffee_order.menu_item_id
WHERE coffee_order.deleted_at IS NULL
  AND coffee_order.status = 'placed';

-- "Aaron: large oat flat white + extra shot"
CREATE VIEW v_coffee_order_line AS
SELECT
    coffee_order.day,
    coffee_order.id,
    coffee_order.person_id,
    person.name AS person,
    CASE coffee_order.size WHEN 'regular' THEN '' ELSE coffee_order.size || ' ' END
        || COALESCE(coffee_order.milk || ' ', '')
        || COALESCE(coffee_order.flavour || ' ', '')
        || lower(menu_item.name)
        || COALESCE((SELECT ' + ' || group_concat(e.value, ' + ')
                     FROM json_each(coffee_order.extras) AS e), '') AS label,
    coffee_order.note
FROM coffee_order AS coffee_order
JOIN person    AS person ON person.id = coffee_order.person_id
JOIN menu_item AS menu_item ON menu_item.id = coffee_order.menu_item_id
WHERE coffee_order.deleted_at IS NULL
  AND coffee_order.status = 'placed';

-- "large oat flat white + extra shot × 2" for the clerk
CREATE VIEW v_tally AS
SELECT day, label, count(*) AS qty
FROM v_coffee_order_line
GROUP BY day, label;

-- One row per different drink each person has ordered: how often, and when
-- last. "Different" means the whole order (drink, size, milk, flavour,
-- extras); the note doesn't count. Drinks taken off the menu drop out, so
-- nobody is offered something they can't order. My order picks the usual
-- and the recent list from this.
CREATE VIEW v_past_drinks AS
SELECT
    l.person_id,
    l.label,
    o.menu_item_id,
    o.size,
    o.milk,
    o.flavour,
    o.extras,
    count(*)   AS times,
    max(o.day) AS last_day
FROM coffee_order AS o
JOIN v_coffee_order_line AS l ON l.id = o.id
JOIN menu_item AS m ON m.id = o.menu_item_id AND m.deleted_at IS NULL
GROUP BY l.person_id, o.menu_item_id, o.size, o.milk, o.flavour, o.extras;
