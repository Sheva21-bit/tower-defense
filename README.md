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

## Main menu
`menu.js` / `menu.css` (Brian, see `MENU.md`) show a title menu on load: Play (pick a side, Auto), How to Play, Settings.
`?play=1` (or `?nomenu=1`) skips it; `?side=deva` and `?auto=1` still work as deep links (an unknown `?side`, e.g. `constructor` / `__proto__`, falls back to the default Valkyries vs Deva; ids are checked with `Object.hasOwn(CONFIG.FACTIONS, id)`). The **☰ Menu** button (also on the
victory/defeat screen) pauses the match and opens the menu (Resume / New battle; Esc resumes). Without `menu.js` the game
starts right away as before. `game.js` exposes `Game.start({ side, enemy, auto, stage })`, `Game.pause()`,
`Game.resume()`, `Game.started` (true once a match has begun), `Game.running`, `Game.paused`.

## Controls
`1`–`9` spawn units, grouped by rarity: **Common 1–3, SR 4–6, SSR 7–9** (each Striker, Defender, Ranger) · `0` **Margentelle**
(Unaffiliated SSR Bomber, her own row under SSR; `Shift`+`0` casts Infectious Love) · `R` restart ·
`G` debug view (grid, each unit's position and range in grids, defender zones, ability cooldowns) · `N` damage numbers on/off

**Action points (AP)** (`CONFIG.AP`, same for you and the enemy AI): start with **3 AP**, gain **+1 AP/s**, max **10**. Units cost
**Common 2 · SR 3 · SSR 5 AP**. The top-left HUD shows `AP / 10` with Mia's crystal and a 10-pip gauge (the next pip fills as it charges);
buttons you can't afford grey out.
**Max 3 Commons alive per side** (`RARITIES.common.maxAlive`): blocked spawns cost nothing; the enemy AI obeys it too.
**Unit info:** right-click (or press and hold) a spawn portrait or any unit on the field; tapping a unit whose ability isn't
ready, or an enemy, also opens it. **Damage numbers** float over units when hits land (white = hit, red = Life Steal tick,
green = heal); toggle with `N` / the **123** button (saved in localStorage `td.showDamageNumbers`, shared with the menu).

Abilities are **manual by default**: click a unit showing the cyan spark (or `Shift`+`1`–`9` = frontmost ready unit of
that slot). `A` / the **AUTO** button toggles auto-casting for your units (the enemy AI always auto-casts).
`F` / the **⇄ Play as …** button swaps sides (also `?side=deva` in the URL). Details in `UNITS.md`.

## Phones / tablets
The page is mobile-ready (it still has to be **served over http(s)**: see hosting).
- **Landscape** is best. The battlefield scales to the screen (internal 1000x400, pixel-crisp) with a
  one-row strip of 9 portrait buttons (AP cost + ability cooldown bar) under it, and nothing scrolls. In
  **portrait** a polite "rotate your phone" hint shows, and it's still playable (the strip scrolls sideways).
- **Tap** a button = spawn. **Tap and hold** = unit info. The **cyan spark** on a button (or tapping its cooldown bar) = use the
  ability of the frontmost ready unit of that slot. **Tap a sparkling unit** on the battlefield = use its ability; tap any other
  unit (or hold any unit) = its live info panel.
- The strip is ordered Common | SR | SSR with thin dividers. Each portrait: stars top-left, class badge bottom-right, AP cost
  bottom-left, spark (ability ready) or `n/3` Commons counter top-right.
- On-screen buttons replace the keyboard: **☰ menu**, **AUTO**, **⇄ swap sides**, **↻ restart**, **# debug grid**, **123 damage numbers**, **⛶ fullscreen**
  (Android/desktop; iPhone Safari has no page fullscreen, so use Add to Home Screen instead).
- **Add to Home Screen** launches fullscreen (web app manifest `manifest.webmanifest`, icons in `icons/`,
  Apple `apple-mobile-web-app-*` tags). The manifest is only linked when served over http(s).

## Rendering resolution and attack impact
The game thinks in a fixed **1000x400** logical canvas. The backing store is that size times an integer RES (1 or 2),
picked from `devicePixelRatio` and the CSS size, capped at 2 (`?res=1|2|3` forces it). Every draw starts with
`setTransform(RES, …)` and `imageSmoothingEnabled = false`, so 1x art stays crisp and 2x art shows its extra pixels.
Spritesheets are resolution-independent: a 128 px character strip or a 2x FX sheet is drawn at the same on-screen size
as the 1x one (see `ASSETS.md` "HD / 2x delivery").

Attack impacts are visual only (no change to damage timing or Brian's sim): ~60 ms local hit-stop on the hit frame
(attacker + target freeze in place), 1–2 px shake and a short white flash on the struck unit, and a rate-limited
~2 px screen shake on big moments (Grey's bash impact, Brawn's slam, Nimble Shot, tower hits). Tunable in
`ANIM.impact` in `assets.js`. Settings → **Screen shake** (or key `td.screenShake` = `'1'`/`'0'`) turns the camera
shake on or off mid-match; it defaults to on, or off when the OS prefers reduced motion.

## Stat standard (boss)
All HP, damage and AP cost come from **`CONFIG.STAT_STANDARD`** in `config.js` (the unit builder reads it; there are no
rarity multipliers and no per-unit HP/damage/cost overrides):
- **HP** (same at every rarity): Striker **100**, Defender **150**, Ranger **75**, Support **100**, Bomber **75**.
- **Support / Bomber damage per hit:** **10** (Bomber = Margentelle's base; faction bombers may differ later).
- **Damage per hit:** all Rangers **10**; Common Striker **5**, SR / SSR Strikers **10**; Common Defender **15**, SR / SSR
  Defenders **20** (boss update: Rangers were 15, Defenders +10).
- **AP cost** (`apCostByRarity`): Common **2**, SR **3**, SSR **5**; an optional `apCost` on a unit or slot is the hook for
  future "this unit costs more" exceptions. AP rules: `CONFIG.AP = { start: 3, perSec: 1, max: 10 }`.
- **Attack interval** (class, `CONFIG.CLASSES`): Striker **1.0 s**, Ranger / Support **1.4 s**, Defender **1.6 s**, Bomber **2.4 s**. Boss rule:
  defenders always attack least often (their interval must stay above the striker's and ranger's; `config.js` warns at load).
- Ability damage scales from damage per hit. Life Steal (1 HP/s per stack for 5 s) is the only flat damage number.
- Combat ticks are two-phase (move, then act, with damage applied at the end of the tick), so spawn order doesn't decide
  even fights. Details in `UNITS.md`.

## Flying units (Bombers) and who can hit them
- **Bombers fly** (`CLASSES.bomber.flying`). Only **anti-air** classes can target or hit a flyer: **Ranger, Support, Bomber**
  (`antiAir: true`). **Strikers and Defenders never target bombers**, with normal attacks or abilities (Cleave, Grey's charge,
  Raven's cloud, ...). Boss rule: grounded units that aren't ranged ignore bombers.
- **Air and ground don't block each other**: a flyer is never held by a Defender's zone of control and isn't stopped by the
  no-pass rule against ground units; melee units walk straight under it. Rangers / Supports stop and shoot flyers in range,
  like any target. A bomber stops only to attack (its 8.5-grid range), like other ranged units.
- **Bomber splash:** a bomb hits its target for full damage and every other enemy within 1 grid of the impact for 5 less
  (10 / 5 / 5).
- All of this is ONE helper in `game.js`, `canTarget(attacker, target)` (+ `blocksMove`, and flyers skip `zocHolder`), exposed
  as `TD.rules` so Brian's sim can mirror it.

## Units
Factions (Valkyries = player, Deva = enemy by default; High Elves / Dark Elves also defined) x three classes (Striker, Defender, Ranger) x three
rarities (Common, SR, SSR). See `UNITS.md` for the full table, and `config.js` (`FACTIONS`,
`CLASSES`, `RARITIES`, `ROSTER_SLOTS`, `FACTION_UNITS`, `ABILITIES`) to edit.
Ability logic lives in `abilities.js`. Named characters with their own art and kits: Dia, Grey (Shield Bash charge +
knockback), Hera (Valkyries); Raven, Brawn (Endure), Pela (Deva); **Margentelle** (Unaffiliated SSR Bomber, either side,
the enemy AI may buy her too). Reserved slots (config only, art pending, not fieldable yet): Tideglass (Wynn, Puck), Cinder
Choir (Bram, Sable), Moonshard (Neris, Orin), Briarwake (Fern, Bramble).

## Files
| File | What |
|---|---|
| `config.js` | All gameplay numbers (grid, towers, AP economy, `STAT_STANDARD`, unit stats) |
| `abilities.js` | Ability logic (one handler per ability id) |
| `UNITS.md` | Unit stats/abilities table |
| `assets.js` | Art manifest (every file from `ASSETS.md`, frame sizes, frame counts, fps) + async loader |
| `game.js` | Game logic and drawing (+ `Game` API for the menu, `TD` test hooks) |
| `menu.js`, `menu.css`, `menu-preview.html`, `MENU.md` | Main menu (Brian) |
| `ASSETS.md` | Asset spec for the artist |
| `assets/` | Drop art here. Empty = placeholder shapes. |

## Art pipeline
- Drop PNGs named as in `ASSETS.md` into `assets/` and reload. Any missing file falls back to
  the placeholder drawing for just that element, so art can arrive piece by piece.
- Characters: `<unitId>_walk.png`, `<unitId>_attack.png`, `<unitId>_death.png` (+ optional `<unitId>_ability.png`) horizontal strips,
  facing right, feet at bottom-centre. Enemy side is mirrored automatically.
  - Frame counts come from the sheets (width / frame width) for every animation, so new strips need no code change.
  - Animation is elapsed-time based (visual only, never read by the sim; tuning in `ASSET_MANIFEST.ANIM`):
    walk ~110 ms/frame at 2.5 grids/s for a 64 px sprite, scaled to each unit's ACTUAL speed (rally buff, blocked
    queues, ZoC holds and knockbacks don't foot-slide), clamped 0.6x-1.6x; each unit starts at its own phase; a unit
    that stops finishes its stride to frame 0 instead of freezing. Attack plays once per attack over the attack
    interval with `hitFrame` (config; a number, or a map like `{4:2, 8:4}` keyed by the strip's frame count) on the hit. Death plays once, holds, then fades.
  - Units render at one integer x per frame (sprite, bars, icons, FX together) with 1 px hysteresis, so nothing shimmers.
  - Facing (`faceOf` in `game.js`): a unit faces its live target, else the enemy tower (player side right, enemy side
    left; a side swap only swaps factions, so the same rule holds). It keeps that facing while walking, attacking,
    holding in ZoC, idling, stunned/trapped, charging, enduring, dying (the corpse keeps it), and while being knocked
    back or hopping back (Raven's Dark Cloud): those slide backwards facing the enemy and show the idle pose, because the
    stride only plays when the unit moves forward. Arrows spawn on the side of the target and fly toward it, so a
    ranger whose target is behind it turns round and shoots backwards (`pickTarget` uses absolute distance, so a foe that
    gets past can be picked; in normal play this never happened in 3x40 s test battles).
  - Drawn direction per sheet: `ASSET_MANIFEST.FACES` (default `'right'`), flipped at draw time by `flipX(sheet, face)`.
    At load every strip's frame 0 is also compared with the unit's attack frame 0, both as drawn and mirrored
    (silhouette IoU, margin 0.12). A strip that is clearly mirrored relative to the attack is flipped and logged as a
    loud `FACING:` warning, so a strip delivered facing the wrong way still renders correctly. The check reads the
    current pixels on every load and caches nothing.
  - Team colour: per-team files `<unitId>_<anim>_blue.png` / `_red.png` win if present;
    otherwise the base file's pure magenta pixels
    are recoloured to blue (#3d7bd9) / red (#d9443d).
  - Frame count is read from the strip width, so extra frames just work. Art delivered at 2x
    is scaled down to the spec size.
- Towers: 96x192, base on the ground line, centred on the tower's 6-grid (60 px) footprint.
  `*_damaged.png` shows below 50% HP, `tower_destroyed.png` at 0 HP.
- Background: `bg_stage1.png` fills the canvas; optional `bg_stage1_far.png` is drawn behind it.
- UI: portraits, rarity frames, class icons, spawn-button frame (`ui_spawn_frame.png`: 9-slice border on desktop
  buttons, 8 px slice at 1x; phones keep the plain border), AP icon (`ui_ap_icon.png`) and AP pips (`ui_ap_pip.png`), HP bar frames, victory/defeat banners and the
  restart button replace the built-in UI when present.
- Tune sizes / frame counts / fps in `assets.js` (`ASSET_MANIFEST`).
