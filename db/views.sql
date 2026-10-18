DROP VIEW IF EXISTS v_tally;
DROP VIEW IF EXISTS v_coffee_order_line;

-- "Aaron: large oat flat white + extra shot"
CREATE VIEW v_coffee_order_line AS
SELECT
    coffee_order.day,
    coffee_order.id,
    coffee_order.person_id,
    person.name AS person,
    CASE coffee_order.size WHEN 'regular' THEN '' ELSE coffee_order.size || ' ' END
        || COALESCE(coffee_order.milk || ' ', '')
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