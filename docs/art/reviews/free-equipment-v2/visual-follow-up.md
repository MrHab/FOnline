# Remaining visual fitting follow-up

Update, 2026-09-09: the source/runtime lower-leg repair is now verified in
[layered-suits-v2](../layered-suits-v2/README.md), including body-axis fitting,
separate ankle shoes, preserved shin inserts and 60 suit/boot/body combinations.
The current browser build/verification is tracked there. The observations below
describe the earlier defective revision, not the current verified Unity poses.

The runtime checks prove bone ownership, sampled rigid-part motion and base-foot
coverage. They do **not** prove that every armor trouser surface clears every
boot variant.

The rear capture `gear-female_medium-11-back.png` (energy suit + assault boots)
shows the suit's lower legs extending into the tall boot area, with a jagged
transition near the heel/sole. Inspect this combination from the sides and in
walk/death poses, then correct the relevant generated clothing/boot fit if the
surfaces intersect. Do not mark all armor/boot combinations visually approved
solely because the current base-foot ray test is green.

Source inspection narrows the cause: `build_free_armor_replacements.py`
explicitly selects `spacesuit_feet` / `scifi_feet` for the energy suit (and
`spacesuit_feet` for hazmat). These built-in shoes are joined into the armor
shell, while the independent boot slot also renders footwear. Split built-in
footwear into an identifiable generated layer, and suppress that layer only
when the separate boot slot has loaded. Preserve it when no boots are equipped;
do not remove the player's base feet to hide the overlap. Regeneration must
also update affected utility fitting-reference hashes and cache revisions.

Selected backpack rear views with metal, heavy and energy armor were inspected:
the downloaded sack remains attached in these captures. This is a sampled
visual check, not an exhaustive animated cloth/armor intersection test.
