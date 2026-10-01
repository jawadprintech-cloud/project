# Custom Box Builder

An online packaging designer: **Choose box style → size → design on the dieline → preview in 3D → save → submit for quote.**
No pricing is calculated — quote requests go to your team with print-ready files.

## Features

| Requirement | Where |
| --- | --- |
| 7 box styles (Mailer, Magnetic Closure, Reverse Tuck End, Two-Piece, Burger, French Fry, Pillow) | `shared/templates/*.json` |
| New styles without redevelopment | JSON templates — bundled or added at runtime in **Admin → Dieline templates** (validated + live preview) |
| Standard sizes & validated custom dimensions (mm / cm / in) | Size tab; limits per style, template constraints, max sheet size |
| Dieline editor with labelled panels, cut / fold / bleed / safe guides (never printed) | `src/editor/DielineEditor.tsx` |
| Artwork upload (JPEG, PNG, TIFF, WebP) — move, resize, rotate, delete, per-panel | Upload tab + inspector; originals kept untouched for print, optimised previews for editing |
| Colours — swatches, picker, HEX, RGB, CMYK and Pantone references; whole box or per panel | Colours tab |
| Text — font, size, colour, bold, italic, alignment, rotation, position, letter spacing, line height | Text tab |
| QR codes — URL, text, vCard contact, email, phone; scannability checks | QR tab (rendered as vector modules at any resolution) |
| Finishes — matte / gloss / soft-touch lamination, spot UV, gold / silver / rose foil, emboss, deboss | Finishes tab; shown in 3D via roughness / metalness / bump maps |
| Real-time 3D mockup — 360° rotate, zoom, views, open / closed / flat fold animation | `src/preview/BoxPreview.tsx` (three.js) |
| Save & continue | Private project link (`?project=…`) + automatic local draft |
| Submit for quote | Customer info, quantity (+ extra quantities), material, printing, notes, preflight checks |
| Team review | **/admin** — quote list, status, internal notes, all files |
| Admin-managed catalog | styles, standard sizes, dimension limits, materials, finishes, colours, fonts, printing options, settings |
| Responsive | desktop, laptop, tablet (drawer / stacked layouts) and phone (one view at a time) |

### What the team receives with each quote
- Print artwork PNG at up to 300 DPI, rendered from the **original** uploads, with bleed
- Vector dieline SVG (in mm) with Cut, Crease, Bleed, Safe Area and label layers + artwork reference
- A black-on-white mask per special finish (spot UV, foil, emboss…)
- Proof image with guides, 4 × 3D mockup renders, full design JSON
- All original artwork files

## Opening in Visual Studio Code

1. Install [Node.js](https://nodejs.org) 20.11 or newer (the current LTS is fine).
2. Unzip, then in VS Code choose **File → Open Folder…** and pick the `custom-box-builder` folder.
3. Open a terminal (**Terminal → New Terminal**) and run `npm install`, then `npm run dev`.
4. Open http://localhost:5173 for the builder and http://localhost:5173/admin.html for the admin (password `admin` in development).

Works the same on Windows, macOS and Linux.

## Running it

Requires Node.js 20.11+.

```sh
cd box-builder
npm install
npm run dev          # API on :8787 + Vite on http://localhost:5173 (admin password "admin")
```

Production:

```sh
npm run build
ADMIN_PASSWORD='choose-a-strong-one' PORT=8080 npm start   # Windows PowerShell: $env:ADMIN_PASSWORD='…'; npm start    # serves the app, /admin and /api
```

### Deploying a preview to Vercel

Import the repository in Vercel and deploy with the default project settings. `vercel.json` builds the static browser demo: designs and uploads stay in the visitor's browser, and quote submission is simulated. This preview does not run the Node API or provide the production admin panel. For production use, deploy the API with persistent storage and point the frontend at it.

| Env var | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Required in production to enable `/admin` |
| `DATA_DIR` | Where projects, quotes, uploads and admin settings are stored (default `./data`) |
| `PORT`, `HOST` | Listen address (default `0.0.0.0:8080` in production) |
| `QUOTE_WEBHOOK_URL` | Optional: POSTed JSON on every new quote (e.g. Slack/Zapier/CRM) |
| `PUBLIC_URL` | Optional: used to build admin links in webhook payloads |

Put the app behind HTTPS (any reverse proxy). Back up `DATA_DIR`.

## Checks

```sh
npm run typecheck
npm test            # geometry engine (every style & standard size) + API integration
npm run build
```

## Architecture

```
shared/        Used by browser, server and tests
  expr.ts        Safe formula evaluator for templates (no eval)
  dieline.ts     Template + dimensions → panels, cut/fold lines, bleed & safe outlines
  fold.ts        Hinge-tree folding → 3D transforms (closed / open / flat)
  templates/     Built-in box styles (JSON)
  catalog.ts     Admin-managed options + defaults
  design.ts      The saved design document
  validate.ts    Dimension + template validation
src/           React app
  render/        One canvas renderer for editor, 3D textures and print files (so they always match)
  editor/        2D dieline editor (canvas + SVG guides/handles)
  preview/       three.js viewer
  panels/        Tool panels & inspector
  quote/         Quote flow
  admin/         Admin panel
server/        Node HTTP API (no framework), file-based storage in DATA_DIR
```

Artwork is stored per panel (position relative to the panel), so it stays on the right face when
dimensions change and maps exactly onto the same face of the 3D model — the 3D texture is the same
flat render that becomes the print file.

## Adding a box style

See [docs/TEMPLATES.md](docs/TEMPLATES.md). In short: duplicate an existing template in
**Admin → Dieline templates**, edit the JSON (live preview + validation at every standard size),
save — it appears in the builder immediately.

## Notes & limits
- Screen colours are RGB; CMYK/Pantone values are passed to the print team as references.
- The dieline geometry is parametric and suitable for quoting/proofing; production dies should be
  confirmed by prepress for board caliper, glue allowances and tolerances.
- Save links are private capability URLs (anyone with the link can edit that design); there are no customer accounts.
- Storage is file-based for simple hosting; `server/storage.ts` is the single place to swap in a database/object store.
