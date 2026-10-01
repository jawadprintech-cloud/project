# Dieline template reference

A box style is one JSON document. It describes the flat net as a **tree of panels**: one root
rectangle per piece, and every other panel attached to an edge of its parent. The same tree drives
the 2D dieline (cut/fold lines, bleed, safe area), the 3D folding and the artwork mapping.

Add a template either:
- **at runtime** — Admin → Dieline templates → *Duplicate* an existing style → edit → *Save*
  (stored in `DATA_DIR/templates`, no rebuild), or
- **bundled** — add a file in `shared/templates/` and list it in `shared/templates/index.ts`.

Templates are validated at the default size and every standard size before they can be saved.

## Top level

```jsonc
{
  "schema": 1,
  "id": "gable-box",                 // lowercase, digits, dashes
  "name": "Gable Box",
  "description": "Shown on the style card.",
  "dimensions": [                    // what the customer enters (always mm)
    { "key": "L", "label": "Length", "min": 50, "max": 400, "default": 120, "help": "Front width" }
  ],
  "constraints": [                   // optional extra rules (formula must be true)
    { "expr": "H <= W * 2", "message": "Height can be at most twice the width." }
  ],
  "vars": { "glue": "clamp(W * 0.3, 12, 20)" },   // helpers, evaluated in order
  "pieces": [ { "id": "main", "label": "Carton", "root": "front" } ],
  "panels": [ /* see below */ ],
  "standardSizes": [ { "id": "s", "label": "Small – 80 × 80 × 120 mm", "dims": { "L": 80, "W": 80, "H": 120 } } ],
  "deform": { "type": "pillow", "length": "L", "width": "W", "thickness": "H" }  // optional (pillow shapes)
}
```

## Formulas

Any size can be a number or a formula string using the dimension keys, `vars`, `bleed`, `safe`
and — inside `shape` — `len` (length along the hinge) and `depth`.
Operators `+ - * / % ^`, comparisons, `&& ||`, `a ? b : c`, and
`min max clamp abs sqrt round floor ceil sin cos tan atan2` (degrees).

## Panels

```jsonc
// Root panel (one per piece): a plain rectangle
{ "id": "front", "label": "Front", "face": "front", "w": "L", "h": "H" }

// Child panel: attached to an edge of its parent
{
  "id": "top", "label": "Top", "face": "top",
  "parent": "back", "edge": "top",   // top | right | bottom | left of the parent's frame
  "depth": "W",                      // distance from the hinge to the far edge
  "length": "W - 4",                 // along the hinge (default: whole parent edge)
  "align": "center", "offset": 0,    // start | center | end, plus offset
  "fold": 90,                        // degrees when closed (+ = folds toward the inside)
  "openFold": -15,                   // optional angle for the "Open" view (lids)
  "layer": 1,                        // mm pushed inside, to stack flaps that overlap in 3D
  "kind": "tuck",                    // panel | flap | tuck | dust | glue | inner
  "printable": true,                 // glue areas default to false (kept ink-free)
  "shape": { "inset": [2, "depth * 0.3"], "radius": 4 }
}
```

- `face` names the side of the finished box (front/back/left/right/top/bottom) — used for labels
  and to choose where new artwork goes by default.
- Folding happens toward the unprinted side. `180` lays a panel flat against the inside
  (roll-over walls, pillow backs). Negative angles fold outward.
- Panel labels and new artwork are automatically rotated so they read upright on the assembled box.

### Shapes (child panels)

| Property | Effect |
| --- | --- |
| `inset` | Pulls the far corners in along the hinge → tapered flaps. One value or `[start, end]`. |
| `radius` | Rounds the two far corners (tuck flaps). |
| `farSag` | Curves the far edge: positive bulges out, negative scoops in (fry box front). |
| `hingeSag` | Curved score bowing into the parent (pillow box ends). The parent must be a plain rectangle. |
| `points` | Custom polygon in local coordinates `[along hinge, away from hinge]`, e.g. `[[0,0],["len",0],["len","H"],[0,"hf"]]`. |

## Multiple pieces (rigid boxes, lids)

Each extra piece has its own root panel and a placement for the assembled 3D view, relative to the
first piece's root top-left corner (x right, y up, z toward the viewer):

```jsonc
{ "id": "lid", "label": "Lid", "root": "lid-front",
  "place":     { "position": ["-c", "c", "c"] },
  "openPlace": { "position": ["-c", "c + D + 40", "c"], "rotation": [-12, 0, 0] } }
```

Pieces are laid out side by side on the flat sheet automatically.

## Tips
- Start from the built-in style closest to what you need.
- Cut and fold lines are derived automatically: shared edges between a panel and its parent are folds, all other outline edges are cuts.
- Use `layer` when two flaps end up in the same plane (e.g. glue flap behind a side wall) to avoid flicker in 3D.
- After saving, enable/rename the style and edit its standard sizes under **Box styles & sizes**.
