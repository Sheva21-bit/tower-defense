# Tower Defense — Prototype

Two towers, one lane, units walk across an invisible grid (see `config.js`).

## Run it

**Quick:** open `index.html` in a browser. Works offline, nothing to install.

**Full art support (recommended once art arrives):**

```sh
./serve.sh          # or: python3 -m http.server 8000
```

Then open <http://localhost:8000>. (On Windows without `sh`: run `python -m http.server 8000` in this folder.)

Why: when the page is opened straight from disk (`file://`), browsers like Chrome block
reading pixels back from images ("tainted canvas"). The game needs that to recolour the
magenta `#FF00FF` team-colour areas on character sprites. From `file://` it still runs and
still shows the art, but magenta sprites get a light team-colour tint and a 1px team-colour
outline instead of a true recolour. Per-team files (`*_blue.png` / `*_red.png`) look right either way.
Serving over http also lets the game read the `assets/` folder listing, so it only requests
files that exist (no "file not found" messages in the browser console).

## Controls
`1`–`9` spawn units (Strikers 1–3, Defenders 4–6, Rangers 7–9; Common / SR / SSR) · `R` restart ·
`G` debug view (grid, each unit's position and range in grids, defender zones, ability cooldowns)

Abilities are **manual by default**: click a unit with a glowing star (or `Shift`+`1`–`9` = frontmost ready unit of
that slot). `A` / the **AUTO** button toggles auto-casting for your units (the enemy AI always auto-casts).
`F` / the **⇄ Play as …** button swaps sides (also `?side=deva` in the URL). Details in `UNITS.md`.

## Phones / tablets
The page is mobile-ready (it still has to be **served over http(s)**: see hosting).
- **Landscape** is best. The battlefield scales to the screen (internal 1000x400, pixel-crisp) with a
  one-row strip of 9 portrait buttons (cost + ability cooldown bar) under it, and nothing scrolls. In
  **portrait** a polite "rotate your phone" hint shows, and it's still playable (the strip scrolls sideways).
- **Tap** a button = spawn. **Tap and hold** = unit info. **★** on a button (or tapping its cooldown bar) = use the
  ability of the frontmost ready unit of that slot. **Tap a glowing unit** on the battlefield = use its ability.
- On-screen buttons replace the keyboard: **AUTO**, **⇄ swap sides**, **↻ restart**, **# debug grid**, **⛶ fullscreen**
  (Android/desktop; iPhone Safari has no page fullscreen, so use Add to Home Screen instead).
- **Add to Home Screen** launches fullscreen (web app manifest `manifest.webmanifest`, icons in `icons/`,
  Apple `apple-mobile-web-app-*` tags). The manifest is only linked when served over http(s).

## Units
Factions (Valkyries = player, Deva = enemy by default; High Elves / Dark Elves also defined) x three classes (Striker, Defender, Ranger) x three
rarities (Common, SR, SSR). See `UNITS.md` for the full table, and `config.js` (`FACTIONS`,
`CLASSES`, `RARITIES`, `ROSTER_SLOTS`, `FACTION_UNITS`, `ABILITIES`) to edit.
Ability logic lives in `abilities.js`.

## Files
| File | What |
|---|---|
| `config.js` | All gameplay numbers (grid, towers, economy, unit stats) |
| `abilities.js` | Ability logic (one handler per ability id) |
| `UNITS.md` | Unit stats/abilities table |
| `assets.js` | Art manifest (every file from `ASSETS.md`, frame sizes, frame counts, fps) + async loader |
| `game.js` | Game logic and drawing |
| `ASSETS.md` | Asset spec for the artist |
| `assets/` | Drop art here. Empty = placeholder shapes. |

## Art pipeline
- Drop PNGs named as in `ASSETS.md` into `assets/` and reload. Any missing file falls back to
  the placeholder drawing for just that element, so art can arrive piece by piece.
- Characters: `<unitId>_walk.png`, `<unitId>_attack.png`, `<unitId>_death.png` (+ optional `<unitId>_ability.png`) horizontal strips,
  facing right, feet at bottom-centre. Enemy side is mirrored automatically.
  - Walk loops at 10 fps. Attack plays once per attack, stretched over the unit's cooldown.
    Death plays at 8 fps, then the body is removed (death is visual only).
  - Team colour: per-team files `<unitId>_<anim>_blue.png` / `_red.png` win if present;
    otherwise the base file's pure magenta pixels
    are recoloured to blue (#3d7bd9) / red (#d9443d).
  - Frame count is read from the strip width, so extra frames just work. Art delivered at 2x
    is scaled down to the spec size.
- Towers: 96x192, base on the ground line, centred on the tower's 6-grid (60 px) footprint.
  `*_damaged.png` shows below 50% HP, `tower_destroyed.png` at 0 HP.
- Background: `bg_stage1.png` fills the canvas; optional `bg_stage1_far.png` is drawn behind it.
- UI: portraits, rarity frames, class icons, button frame, resource icon, HP bar frames, victory/defeat banners and the
  restart button replace the built-in UI when present.
- Tune sizes / frame counts / fps in `assets.js` (`ASSET_MANIFEST`).
