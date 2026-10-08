/*
 * assets.js — art asset manifest + loader.
 *
 * Every file from ASSETS.md is listed here with its use. Images load asynchronously.
 * ANY image that is missing / fails to load is simply left null, and game.js falls back
 * to the original placeholder drawing for that element. With an empty assets/ folder the
 * game runs exactly like the prototype.
 *
 * Sizes below are the DRAW sizes on the 1000x400 canvas. If an artist delivers at 2x,
 * the loader detects it from the image height and scales down (source frame width is
 * derived from image height), so frame counts are also derived from the strip width.
 */
const ASSET_MANIFEST = {
  basePath: 'assets/',

  // ---- Characters ----------------------------------------------------------------
  // One entry per unit in CONFIG.UNITS (filled in below), file prefix = unit id.
  // Files: <unitId>_<anim>.png, one horizontal strip per animation, frames face RIGHT,
  // feet at bottom-centre of each frame. Enemy side is mirrored in code.
  // Team colour: either per-team files (<unitId>_<anim>_blue.png / _red.png) or a base file
  // with pure magenta #FF00FF areas that get recoloured to the team colour at load time.
  // FRAME COUNTS COME FROM THE SHEET: frames = image width / frame width (frame width = the
  // unit's frame size x the sheet's scale, i.e. image height / frameH), counted at load time
  // for every animation, so a new strip with more or fewer frames needs no code change.
  // `frames` below is only the spec: a different count is logged as a note (ART.store.notes),
  // and it's used as a fallback only if the width isn't a multiple of the frame width.
  //   frameMs: number -> ms per frame (walk: at ANIM.walk.refSpeedGrids, scaled to actual speed)
  //   fps: 'cooldown' -> the whole strip plays once per attack, over the unit's cooldownSec
  // Frame size by class (square); SSR units are SSR_SIZE_BONUS px larger.
  SPRITE_SIZE_BY_CLASS: { ranger: 40, striker: 48, defender: 56 },
  SSR_SIZE_BONUS: 8,
  CHARACTERS: {},   // filled from CONFIG.UNIT_TYPES below: { prefix, frameW, frameH, recolor }
  CHARACTER_ANIMS: {
    walk:    { frames: 8, frameMs: 110,     loop: true  },  // idle = walk frame 0 (Mia: 8 frames at ~110 ms; 6-frame strips still work)
    attack:  { frames: 4, fps: 'cooldown', loop: true  },  // spread over the attack interval; hit on hitFrame (config)
    death:   { frames: 4, frameMs: 125,     loop: false },  // plays once, holds the last frame, fades (ANIM.death)
    ability: { frames: 6, frameMs: 83,      loop: false },  // optional (SR/SSR): plays once on ability use
    endure:  { frames: 4, frameMs: 125,     loop: false, onlyAbility: 'endure' },  // Brawn's Endure: 0 lift, 1 slam, 2-3 braced loop
  },
  // Code-side animation tuning (same for every unit; the only per-unit art value is hitFrame in config.js).
  ANIM: {
    walk: {
      refSpeedGrids: 2.5,   // walk plays at frameMs per frame when moving this fast (grids/s) ...
      refFrameW: 64,        // ... at this frame size (stride scales with sprite size: 48 px steps faster, 80 px slower)
      minRate: 0.6,         // playback-rate clamp (x frameMs) while moving
      maxRate: 1.6,
      chargeMaxRate: 2.5,   // charges (Grey's Shield Bash) may stride faster
      stopSpeed: 0.15,      // below this actual speed (grids/s) the unit counts as stopped (blocked / held)
      speedSmoothSec: 0.05, // smoothing of the measured speed (frame-rate independent)
      settleSec: 0.25,      // stopping: finish the stride forward to frame 0 within ~this long (no freeze mid-stride)
    },
    death: { holdSec: 0.35, fadeSec: 0.45 },   // after the last death frame: hold, then fade out
    pos: {
      hysteresisPx: 1.0,    // integer-pixel snap: reversing direction needs a full px of drift (sub-pixel wobble never flickers)
      jumpGridsPerSec: 40,  // a position change faster than this is a jump: smoothed instead of popping
      jumpSmoothSec: 0.08,  // time constant for smoothing such jumps (frame-rate independent)
    },
  },
  // Which way each sheet is drawn ('right' | 'left'; anything not listed = 'right'). Audited 2026-10-08 by
  // looking at every frame: all current character strips and directional FX face RIGHT. A sheet drawn
  // facing left just gets 'left' here; game.js flips it at draw time so every unit faces its attack
  // direction (player units toward the enemy tower, enemy units toward the player tower).
  FACES: {
    // characters (weapon / face / attack lunge all point right; checked per frame, death recoil frames too)
    'darkelf_common_defender_attack.png': 'right', 'darkelf_common_defender_death.png': 'right', 'darkelf_common_defender_walk.png': 'right',
    'darkelf_common_ranger_attack.png': 'right', 'darkelf_common_ranger_death.png': 'right', 'darkelf_common_ranger_walk.png': 'right',
    'darkelf_common_striker_attack.png': 'right', 'darkelf_common_striker_death.png': 'right', 'darkelf_common_striker_walk.png': 'right',
    'darkelf_defender_attack.png': 'right', 'darkelf_defender_death.png': 'right', 'darkelf_defender_walk.png': 'right',
    'darkelf_ranger_attack.png': 'right', 'darkelf_ranger_death.png': 'right', 'darkelf_ranger_walk.png': 'right',
    'darkelf_ssr_defender_attack.png': 'right', 'darkelf_ssr_defender_death.png': 'right', 'darkelf_ssr_defender_walk.png': 'right',
    'darkelf_ssr_ranger_attack.png': 'right', 'darkelf_ssr_ranger_death.png': 'right', 'darkelf_ssr_ranger_walk.png': 'right',
    'darkelf_ssr_striker_attack.png': 'right', 'darkelf_ssr_striker_death.png': 'right', 'darkelf_ssr_striker_walk.png': 'right',
    'darkelf_striker_attack.png': 'right', 'darkelf_striker_death.png': 'right', 'darkelf_striker_walk.png': 'right',
    'deva_defender_attack.png': 'right', 'deva_defender_death.png': 'right', 'deva_defender_endure.png': 'right',
    'deva_defender_walk.png': 'right', 'deva_ranger_attack.png': 'right', 'deva_ranger_death.png': 'right',
    'deva_ranger_walk.png': 'right', 'deva_raven_attack.png': 'right', 'deva_raven_death.png': 'right',
    'deva_raven_walk.png': 'right', 'elf_common_defender_attack.png': 'right', 'elf_common_defender_death.png': 'right',
    'elf_common_defender_walk.png': 'right', 'elf_common_ranger_attack.png': 'right', 'elf_common_ranger_death.png': 'right',
    'elf_common_ranger_walk.png': 'right', 'elf_common_striker_attack.png': 'right', 'elf_common_striker_death.png': 'right',
    'elf_common_striker_walk.png': 'right', 'elf_defender_attack.png': 'right', 'elf_defender_death.png': 'right',
    'elf_defender_walk.png': 'right', 'elf_ranger_attack.png': 'right', 'elf_ranger_death.png': 'right',
    'elf_ranger_walk.png': 'right', 'elf_ssr_defender_attack.png': 'right', 'elf_ssr_defender_death.png': 'right',
    'elf_ssr_defender_walk.png': 'right', 'elf_ssr_ranger_attack.png': 'right', 'elf_ssr_ranger_death.png': 'right',
    'elf_ssr_ranger_walk.png': 'right', 'elf_ssr_striker_attack.png': 'right', 'elf_ssr_striker_death.png': 'right',
    'elf_ssr_striker_walk.png': 'right', 'elf_striker_attack.png': 'right', 'elf_striker_death.png': 'right',
    'elf_striker_walk.png': 'right', 'valkyrie_defender_attack.png': 'right', 'valkyrie_defender_death.png': 'right',
    'valkyrie_defender_walk.png': 'right', 'valkyrie_dia_attack.png': 'right', 'valkyrie_dia_death.png': 'right',
    'valkyrie_dia_walk.png': 'right', 'valkyrie_ranger_attack.png': 'right', 'valkyrie_ranger_death.png': 'right',
    'valkyrie_ranger_walk.png': 'right',
    // FX: directional ones are drawn for a right-facing / right-moving user (arrow tip right, trail fades left,
    // dash lines behind a right-mover, impact / knock rings push right); the rest are symmetric
    'fx_arrow.png': 'right', 'fx_arrow_trail.png': 'right', 'fx_bubble.png': 'right',
    'fx_bubble_pop.png': 'right', 'fx_bubble_trap.png': 'right', 'fx_dark_cloud.png': 'right',
    'fx_endure_guard.png': 'right', 'fx_endure_knock.png': 'right', 'fx_endure_slam.png': 'right',
    'fx_lifesteal_mark.png': 'right', 'fx_lifesteal_wisp.png': 'right', 'fx_nimble_shot.png': 'right',
    'fx_rally.png': 'right', 'fx_rally_buff.png': 'right', 'fx_shield_bash_dash.png': 'right',
    'fx_shield_bash_impact.png': 'right',
  },
  TEAM_SUFFIX: { player: 'blue', enemy: 'red' },
  RECOLOR_KEY: [255, 0, 255],   // pure magenta
  RECOLOR_TOLERANCE: 8,         // per-channel tolerance for the magenta match

  // ---- Towers (96x192, base on the ground line, centred on the 6-grid footprint) --
  TOWER_SIZE: { w: 96, h: 192 },
  TOWER_DAMAGED_BELOW: 0.5,     // show *_damaged below this HP fraction
  TOWERS: {
    player: {
      normal: ['tower_player.png'],
      damaged: ['tower_player_damaged.png'],
      destroyed: ['tower_player_destroyed.png', 'tower_destroyed.png'], // first found wins
    },
    enemy: {
      normal: ['tower_enemy.png'],
      damaged: ['tower_enemy_damaged.png'],
      destroyed: ['tower_enemy_destroyed.png', 'tower_destroyed.png'],
    },
  },

  // ---- Stage ----
  STAGE: {
    bg:  { file: 'bg_stage1.png',     w: 1000, h: 400 },  // full canvas
    far: { file: 'bg_stage1_far.png', w: 1000, h: 300 },  // optional, drawn behind bg
  },

  // ---- Effects (optional; drawn shapes are used when missing) ----
  // Frames in a horizontal strip (a single frame is fine), each w x h (aspect ratio is used
  // to count frames, so e.g. a 384x48 strip of 96x48 frames = 4 frames). w/h = draw size.
  FX: {
    fx_bubble:      { file: 'fx_bubble.png',      w: 16, h: 16, fps: 8  },  // Pela's normal attack
    fx_bubble_pop:  { file: 'fx_bubble_pop.png',  w: 24, h: 24, fps: 12 },  // pop on hit (4 frames suggested)
    fx_bubble_trap: { file: 'fx_bubble_trap.png', w: 48, h: 48, fps: 6  },  // big trap bubble around a unit / in flight
    fx_dark_cloud:      { file: 'fx_dark_cloud.png',      w: 64, h: 32, fps: 6  },  // Raven's Dark Cloud: ground cloud, 4-frame loop
    fx_lifesteal_wisp:  { file: 'fx_lifesteal_wisp.png',  w: 12, h: 12, fps: 12 },  // homing wisp, drained unit -> Raven (4 frames)
    fx_lifesteal_mark:  { file: 'fx_lifesteal_mark.png',  w: 9,  h: 11, fps: 1  },  // blood drop above units with Life Steal stacks
    fx_rally:           { file: 'fx_rally.png',           w: 64, h: 64, fps: 10 },  // Dia's Rallying Charge: 0-2 gather, 3-5 ring burst
    fx_rally_buff:      { file: 'fx_rally_buff.png',      w: 9,  h: 9,  fps: 1  },  // gold double chevron on speed-buffed units
    fx_nimble_shot:     { file: 'fx_nimble_shot.png',     w: 40, h: 16, fps: 12 },  // Hera's Nimble Shot: 2 arrows leaving the bow (4 frames, 1x)
    fx_endure_slam:     { file: 'fx_endure_slam.png',     w: 48, h: 24, fps: 12 },  // Brawn's Endure: dust at the shield base, once on the slam (4 frames)
    fx_endure_guard:    { file: 'fx_endure_guard.png',    w: 32, h: 64, fps: 8 },   // Brawn's Endure: gold glint up the shield face, loops while active (4 frames)
    fx_endure_knock:    { file: 'fx_endure_knock.png',    w: 32, h: 32, fps: 12 },  // Brawn's Endure: push ring on each attacker knocked back (4 frames, pushes right)
    fx_arrow:           { file: 'fx_arrow.png',           w: 16, h: 5 },   // arrow projectile, points right, tip at the right edge (1 frame)
    fx_arrow_trail:     { file: 'fx_arrow_trail.png',     w: 24, h: 5 },   // white streak fading to the left; tinted per team at runtime
    fx_shield_bash_dash:   { file: 'fx_shield_bash_dash.png',   w: 48, h: 32, fps: 12 },  // Grey's Shield Bash: speed lines + dust behind him while charging (3-frame loop, 1x)
    fx_shield_bash_impact: { file: 'fx_shield_bash_impact.png', w: 48, h: 48, fps: 12 },  // Grey's Shield Bash: gold burst + shockwave on each shoved enemy (4 frames, 1x)
  },

  // ---- UI ----
  // Portraits (ui_portrait_<unitId>.png, 64x64) are added per unit below.
  UI: {
    class_striker:    { file: 'ui_class_striker.png',    w: 24,  h: 24 },  // class icons
    class_defender:   { file: 'ui_class_defender.png',   w: 24,  h: 24 },
    class_ranger:     { file: 'ui_class_ranger.png',     w: 24,  h: 24 },
    badge_striker:    { file: 'ui_badge_striker.png',    w: 20,  h: 20 },  // class badge, bottom-right corner of
    badge_defender:   { file: 'ui_badge_defender.png',   w: 20,  h: 20 },  // every portrait button (1x, overhangs
    badge_ranger:     { file: 'ui_badge_ranger.png',     w: 20,  h: 20 },  // the portrait edge by 4px)
    stars_common:     { file: 'ui_stars_common.png',     w: 11,  h: 11 },  // rarity stars: top-left of portrait
    stars_sr:         { file: 'ui_stars_sr.png',         w: 21,  h: 11 },  // buttons (1x) + rarity row headers (2x)
    stars_ssr:        { file: 'ui_stars_ssr.png',        w: 31,  h: 11 },
    ability_ready:    { file: 'ui_ability_ready.png',    w: 14,  h: 14 },  // ability-ready spark: button corner + over castable units
    // Unit info panel stat icons (12x12, drawn at 2x)
    stat_hp:          { file: 'ui_stat_hp.png',          w: 12,  h: 12 },  // heart
    stat_damage:      { file: 'ui_stat_damage.png',      w: 12,  h: 12 },  // sword
    stat_atkspeed:    { file: 'ui_stat_atkspeed.png',    w: 12,  h: 12 },  // bolt
    stat_movespeed:   { file: 'ui_stat_movespeed.png',   w: 12,  h: 12 },  // boot
    stat_range:       { file: 'ui_stat_range.png',       w: 12,  h: 12 },  // target
    stat_cooldown:    { file: 'ui_stat_cooldown.png',    w: 12,  h: 12 },  // hourglass
    // Damage-number digit sheets: 12 glyphs (0-9, +, -) in 6x9 cells, drawn 5 px apart (1 px overlap).
    digits_white:     { file: 'ui_digits_white.png',     w: 72,  h: 9, cellW: 6, advance: 5 },  // direct hits (2x)
    digits_red:       { file: 'ui_digits_red.png',       w: 72,  h: 9, cellW: 6, advance: 5 },  // life steal ticks (1x)
    digits_green:     { file: 'ui_digits_green.png',     w: 72,  h: 9, cellW: 6, advance: 5 },  // heals, '+' prefix (1x)
    frame_common:     { file: 'ui_frame_common.png',     w: 72,  h: 72 },  // rarity portrait frames,
    frame_sr:         { file: 'ui_frame_sr.png',         w: 72,  h: 72 },  // drawn at portrait (x-4, y-4)
    frame_ssr:        { file: 'ui_frame_ssr.png',        w: 72,  h: 72 },
    button:           { file: 'ui_spawn_frame.png',      w: 256, h: 64 },  // desktop spawn-button 9-slice frame (slice 8 @1x).
                                                                           // NOT ui_button.png: that name is Mia's 48x48 9-slice for the menu
    resourceIcon:     { file: 'ui_resource_icon.png',    w: 24,  h: 24 },  // old gold economy: unused since AP
    apIcon:           { file: 'ui_ap_icon.png',          w: 16,  h: 16 },  // AP crystal: HUD counter, cost labels, info panel
    apPip:            { file: 'ui_ap_pip.png',           w: 20,  h: 14, cellW: 10 },  // strip: filled x0-9, empty x10-19
    hpbarFrame:       { file: 'ui_hpbar_frame.png',      w: 64,  h: 8 },   // fill drawn in code
    towerHpbarFrame:  { file: 'ui_tower_hpbar_frame.png', w: 200, h: 16 },
    victory:          { file: 'ui_victory.png',          w: 480, h: 120 },
    defeat:           { file: 'ui_defeat.png',           w: 480, h: 120 },
    restart:          { file: 'ui_restart.png',          w: 160, h: 48 },
  },
};

ASSET_MANIFEST.SPRITE_SIZE_BY_RARITY = { common: 48, sr: 64, ssr: 80 };
// Large portraits for the unit info panel header (512x512). Loaded lazily by the panel only
// (never preloaded: they're big). Missing -> falls back to ui_portrait_<art>.png.
ASSET_MANIFEST.LARGE_PORTRAIT = (art) => `${ASSET_MANIFEST.basePath}portraits/${art}.png`;

// Fill per-unit entries from the roster in config.js (so new units get art hooks automatically).
for (const t of CONFIG.UNIT_TYPES) {
  // Sprite frame size scales with rarity (artist spec): Common 48, SR 64, SSR 80.
  const size = t.spriteSize || ASSET_MANIFEST.SPRITE_SIZE_BY_RARITY[t.rarityId] ||
    (ASSET_MANIFEST.SPRITE_SIZE_BY_CLASS[t.classId] + (t.rarityId === 'ssr' ? ASSET_MANIFEST.SSR_SIZE_BONUS : 0));
  // Faction-coloured art is used as-is: no magenta recolour, no _blue/_red variants.
  ASSET_MANIFEST.CHARACTERS[t.id] = { prefix: t.art || t.id, frameW: size, frameH: size, recolor: !t.factionColoredArt };
  ASSET_MANIFEST.UI['portrait_' + t.id] = { file: `ui_portrait_${t.art || t.id}.png`, w: 64, h: 64 };
}

/*
 * ART — runtime asset store. game.js reads from here; every getter returns null when
 * the asset isn't available so callers can fall back to placeholder drawing.
 */
const ART = (function () {
  'use strict';
  const M = ASSET_MANIFEST;

  const store = {
    ready: false,
    canRecolor: null,        // null = untested, true/false after first recolor attempt
    listing: null,           // Set of filenames if the server exposes a directory listing
    images: {},              // filename -> HTMLImageElement (loaded) | null (missing)
    chars: {},               // charId -> team -> anim -> sprite | null
    towers: { player: {}, enemy: {} },
    stage: {},
    ui: {},
    fx: {},
    warnings: [],
    notes: [],               // info: sheet frame count differs from the spec (the sheet is used)
    frameCounts: {},         // file -> { frames, srcW, width, height, how: 'sheet' | 'fallback' }
    facing: {},              // file -> { faces: 'right' | 'left', how: 'pixels' | 'manifest', same, mirrored, declared }
  };

  // ---------- low-level loading ----------
  function loadImage(file) {
    if (file in store.images) return Promise.resolve(store.images[file]);
    // Known-missing (server listing available and file not in it): skip the request.
    if (store.listing && !store.listing.has(file)) {
      store.images[file] = null;
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth > 0) { store.images[file] = img; resolve(img); }
        else { store.images[file] = null; resolve(null); }
      };
      img.onerror = () => { store.images[file] = null; resolve(null); };
      img.src = M.basePath + file;
    });
  }

  /** Load the first file in `files` that exists (sequential so we stop at the first hit). */
  async function loadFirst(files) {
    for (const f of files) {
      const img = await loadImage(f);
      if (img) return { img, file: f };
    }
    return null;
  }

  /**
   * When served over http (e.g. serve.sh / python http.server) we can read the assets/
   * directory listing and only request files that exist -> no 404 noise in the console.
   * Under file:// this isn't possible, so we just try each file (missing files are fine).
   */
  async function tryReadListing() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
    try {
      const res = await fetch(M.basePath, { cache: 'no-store' });
      if (!res.ok) return null;
      const html = await res.text();
      const names = new Set();
      const re = /href="([^"?#]+)"/gi;
      let m;
      while ((m = re.exec(html))) {
        const name = decodeURIComponent(m[1]).split('/').pop();
        if (name) names.add(name);
      }
      // Only trust a real directory listing (python http.server: "Directory listing for",
      // Apache/nginx: "Index of"). Anything else -> probe every file instead.
      return /Directory listing for|<title>Index of/i.test(html) ? names : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- canvas helpers (no pixel reads -> always safe, even when tainted) ----------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Solid-colour silhouette of an image (same alpha). Used for outline + hit flash. */
  function silhouette(img, color) {
    const c = makeCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /** Light team-colour tint over the sprite (fallback when magenta recolour is impossible). */
  function tinted(img, color, alpha) {
    const c = makeCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /**
   * Replace pure magenta pixels with the team colour. Needs getImageData, which throws a
   * SecurityError when the page is opened from file:// in Chrome (canvas is "tainted").
   * Returns a canvas on success, or null if pixel access is blocked.
   */
  function recolorMagenta(img, teamColor) {
    if (store.canRecolor === false) return null;
    try {
      const c = makeCanvas(img.width, img.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height);
      const d = data.data;
      const [kr, kg, kb] = M.RECOLOR_KEY;
      const [tr, tg, tb] = hexToRgb(teamColor);
      const tol = M.RECOLOR_TOLERANCE;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        if (Math.abs(d[i] - kr) <= tol && Math.abs(d[i + 1] - kg) <= tol && Math.abs(d[i + 2] - kb) <= tol) {
          d[i] = tr; d[i + 1] = tg; d[i + 2] = tb;
        }
      }
      g.putImageData(data, 0, 0);
      store.canRecolor = true;
      return c;
    } catch (e) {
      // Tainted canvas (file://). Remember it so we don't retry for every sprite.
      if (store.canRecolor !== false) {
        store.canRecolor = false;
        console.info('[art] Magenta team-colour recolouring is unavailable (page opened from file://). ' +
          'Using tint + team outline instead. Run ./serve.sh for full art support.');
      }
      return null;
    }
  }

  // ---------- frame counting ----------
  /**
   * Frame count of a horizontal strip, from the sheet itself: floor(naturalWidth / frame width), min 1,
   * where frame width = frameW x the sheet's scale (naturalHeight / frameH; 2 for a 2x delivery).
   * Until the image has loaded (naturalWidth 0) the spec count is the fallback (never 0 / NaN).
   * Returns { frames, srcW, how: 'sheet' | 'fallback', exact, natW, natH }.
   */
  function countFrames(img, frameW, frameH, specFrames) {
    const loaded = !!(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && frameW > 0 && frameH > 0);
    if (!loaded) {
      return { frames: Math.max(1, specFrames | 0), srcW: frameW > 0 ? frameW : 1, how: 'fallback', exact: false, natW: 0, natH: 0 };
    }
    const srcW = frameW * (img.naturalHeight / frameH);
    const frames = Math.max(1, Math.floor(img.naturalWidth / srcW + 1e-9));
    const exact = Math.abs(img.naturalWidth / srcW - Math.round(img.naturalWidth / srcW)) < 1e-9 && Math.round(img.naturalWidth / srcW) >= 1;
    return { frames, srcW, how: 'sheet', exact, natW: img.naturalWidth, natH: img.naturalHeight };
  }

  // ---------- sprite construction ----------
  /**
   * Build a sprite descriptor from a loaded strip.
   * mode: 'team'    -> per-team file, drawn as is
   *       'recolor' -> magenta replaced with team colour
   *       'outline' -> could not recolour: tinted sprite + team-colour outline
   */
  function buildSprite(img, src, def, animDef, mode, teamColor) {
    const fc = countFrames(img, def.frameW, def.frameH, animDef.frames);
    const { frames, srcW, how, natW, natH } = fc;
    if (how === 'fallback') store.warnings.push(`${src}: not loaded yet (naturalWidth 0); using the spec's ${frames} frames`);
    else if (!fc.exact) store.warnings.push(`${src}: width ${natW} is not an exact multiple of frame width ${srcW}; using ${frames} frames`);
    else if (animDef.frames && frames !== animDef.frames) store.notes.push(`${src}: ${frames} frames from the sheet (spec ${animDef.frames})`);   // info only: the sheet wins
    store.frameCounts[src] = { frames, srcW, width: natW, height: natH, how };
    let canvasOrImg = img;
    let outline = null;
    if (mode === 'recolor') {
      const rc = recolorMagenta(img, teamColor);
      if (rc) canvasOrImg = rc;
      else {
        mode = 'outline';
        canvasOrImg = tinted(img, teamColor, 0.25);
        outline = silhouette(img, teamColor);
      }
    }
    return {
      src, mode,
      image: canvasOrImg,
      outline,                                  // team-colour silhouette (outline mode only)
      flash: silhouette(img, '#ffffff'),        // white silhouette for hit flash
      faces: (M.FACES[src] === 'left' ? 'left' : 'right'),   // how the sheet is drawn (default right)
      srcW, srcH: natH || def.frameH,
      frameW: def.frameW, frameH: def.frameH,   // draw size
      frames,
      frameMs: animDef.frameMs || null,
      fps: animDef.frameMs ? 1000 / animDef.frameMs : animDef.fps,   // legacy alias
      loop: animDef.loop,
    };
  }

  // ---------- facing from the pixels (load time, never cached across loads) ----------
  const FACE_MARGIN = 0.12;   // silhouette IoU margin needed to call a strip mirrored / not mirrored
  /** Alpha mask of frame 0 of a strip, shifted so its horizontal centre of mass is mid-frame. null if unreadable. */
  function frame0Mask(img, fw, fh) {
    try {
      const W = Math.round(fw), H = Math.round(fh);
      const c = makeCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(W * H); let sx = 0, n = 0;
      for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 0) { m[i] = 1; sx += i % W; n++; }
      if (!n) return null;
      const shift = Math.round(W / 2 - sx / n), out = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) if (m[i]) { const x = (i % W) + shift; if (x >= 0 && x < W) out[i - (i % W) + x] = 1; }
      return { m: out, W, H };
    } catch (e) { return null; }   // tainted canvas (file://): fall back to the manifest
  }
  function maskIoU(a, b, mirror) {
    let inter = 0, uni = 0;
    for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) {
      const va = a.m[y * a.W + x], vb = b.m[y * b.W + (mirror ? b.W - 1 - x : x)];
      if (va && vb) inter++; if (va || vb) uni++;
    }
    return uni ? inter / uni : 0;
  }
  /**
   * Decide which way each strip of a character is drawn, from the CURRENT pixels: the attack strip
   * (manifest value, default right; its lunge confirms it) is the anchor, and every other strip's
   * frame 0 is compared with attack frame 0 as drawn and mirrored. A clear mirror match means the
   * strip faces the other way: it's flipped at draw time and a loud warning is logged. Ambiguous ->
   * the manifest value. Results: store.facing[file] = { faces, how, same, mirrored, declared }.
   */
  function detectFacing(def, out) {
    const declared = (f) => (M.FACES[f] === 'left' ? 'left' : 'right');
    const atkFile = `${def.prefix}_attack.png`, atkImg = store.images[atkFile];
    const setFaces = (anim, faces) => { for (const t of ['player', 'enemy']) if (out[t][anim]) out[t][anim].faces = faces; };
    const ref = atkImg ? frame0Mask(atkImg, def.frameW * atkImg.naturalHeight / def.frameH, atkImg.naturalHeight) : null;
    const atkFaces = declared(atkFile);
    if (atkImg) store.facing[atkFile] = { faces: atkFaces, how: 'manifest (anchor)', declared: atkFaces };
    for (const anim of Object.keys(M.CHARACTER_ANIMS)) {
      if (anim === 'attack') continue;
      const file = `${def.prefix}_${anim}.png`, img = store.images[file];
      if (!img || !(out.player[anim] || out.enemy[anim])) continue;
      const decl = declared(file);
      let faces = decl, how = 'manifest', same = null, mirrored = null;
      const m = ref && frame0Mask(img, def.frameW * img.naturalHeight / def.frameH, img.naturalHeight);
      if (m && m.W === ref.W && m.H === ref.H) {
        same = +maskIoU(m, ref, false).toFixed(3); mirrored = +maskIoU(m, ref, true).toFixed(3);
        if (mirrored - same >= FACE_MARGIN) { faces = atkFaces === 'right' ? 'left' : 'right'; how = 'pixels'; }
        else if (same - mirrored >= FACE_MARGIN) { faces = atkFaces; how = 'pixels'; }
      }
      if (faces !== decl) {
        store.warnings.push(`FACING: ${file} is drawn facing ${faces.toUpperCase()} but ${atkFile} faces ${atkFaces.toUpperCase()} ` +
          `(frame 0 silhouette matches the attack ${mirrored} mirrored vs ${same} as drawn); flipping it at draw time. ` +
          `Ask the artist to mirror it, or record it in ASSET_MANIFEST.FACES.`);
      }
      store.facing[file] = { faces, how, same, mirrored, declared: decl };
      setFaces(anim, faces);
    }
    setFaces('attack', atkFaces);
  }

  async function loadCharacter(charId, def, teamColors) {
    const out = { player: {}, enemy: {} };
    // walk first: without a walk strip the unit uses the placeholder, so attack/death
    // would never be shown -> don't request them (fewer missing-file requests).
    const anims = Object.keys(M.CHARACTER_ANIMS).sort((a, b) => (b === 'walk') - (a === 'walk'));
    const unitType = (typeof CONFIG !== 'undefined' && CONFIG.UNIT_TYPES || []).find((t) => t.id === charId);
    for (const anim of anims) {
      if (anim !== 'walk' && !out.player.walk && !out.enemy.walk) { out.player[anim] = out.enemy[anim] = null; continue; }
      if (anim === 'ability' && !(unitType && unitType.ability)) { out.player[anim] = out.enemy[anim] = null; continue; }
      const only = M.CHARACTER_ANIMS[anim].onlyAbility;   // ability-specific strip: only requested for units with that ability
      if (only && !(unitType && unitType.ability === only)) { out.player[anim] = out.enemy[anim] = null; continue; }
      const animDef = M.CHARACTER_ANIMS[anim];
      const base = await loadImage(`${def.prefix}_${anim}.png`);
      for (const team of ['player', 'enemy']) {
        if (def.recolor === false) {   // faction-coloured art: base file as-is for either side
          out[team][anim] = base ? buildSprite(base, `${def.prefix}_${anim}.png`, def, animDef, 'team', teamColors[team]) : null;
          continue;
        }
        const sfx = M.TEAM_SUFFIX[team];
        const teamHit = await loadFirst([`${def.prefix}_${anim}_${sfx}.png`]);
        if (teamHit) out[team][anim] = buildSprite(teamHit.img, teamHit.file, def, animDef, 'team', teamColors[team]);
        else if (base) out[team][anim] = buildSprite(base, `${def.prefix}_${anim}.png`, def, animDef, 'recolor', teamColors[team]);
        else out[team][anim] = null;
      }
    }
    detectFacing(def, out);
    return out;
  }

  /**
   * Load everything. Resolves when all requests settle; never rejects.
   * teamColors: { player: '#...', enemy: '#...' }
   */
  async function loadAll(teamColors) {
    store.listing = await tryReadListing();

    const jobs = [];
    for (const [charId, def] of Object.entries(M.CHARACTERS)) {
      jobs.push(loadCharacter(charId, def, teamColors).then((r) => { store.chars[charId] = r; }));
    }
    for (const team of ['player', 'enemy']) {
      for (const variant of ['normal', 'damaged', 'destroyed']) {
        jobs.push(loadFirst(M.TOWERS[team][variant]).then((r) => { store.towers[team][variant] = r ? r.img : null; }));
      }
    }
    for (const [key, def] of Object.entries(M.STAGE)) {
      jobs.push(loadImage(def.file).then((img) => { store.stage[key] = img; }));
    }
    for (const [key, def] of Object.entries(M.UI)) {
      jobs.push(loadImage(def.file).then((img) => { store.ui[key] = img; }));
    }
    for (const [key, def] of Object.entries(M.FX)) {
      jobs.push(loadImage(def.file).then((img) => {
        const ok = !!(img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0);
        const fsrcW = ok ? img.naturalHeight * def.w / def.h : 0;
        store.fx[key] = ok ? {
          img, faces: (M.FACES[def.file] === 'left' ? 'left' : 'right'), srcW: fsrcW,
          frames: Math.max(1, Math.floor(img.naturalWidth / fsrcW + 1e-6)),   // from the sheet, min 1
          w: def.w, h: def.h, fps: def.fps,
        } : null;
        if (ok && Math.abs(img.naturalWidth / fsrcW - Math.round(img.naturalWidth / fsrcW)) > 1e-6) store.warnings.push(`${def.file}: width ${img.naturalWidth} is not an exact multiple of frame width ${fsrcW}`);
        if (ok) store.frameCounts[def.file] = { frames: store.fx[key].frames, srcW: fsrcW, width: img.naturalWidth, height: img.naturalHeight, how: 'sheet' };
      }));
    }
    await Promise.all(jobs);
    store.ready = true;

    const loaded = Object.entries(store.images).filter(([, v]) => v).map(([k]) => k);
    if (loaded.length) console.info(`[art] loaded ${loaded.length} image(s): ${loaded.join(', ')}`);
    for (const w of store.warnings) console.warn('[art] ' + w);
    if (store.notes.length) console.info('[art] frame counts from the sheets: ' + store.notes.join('; '));
    return store;
  }

  return {
    manifest: M,
    store,
    loadAll,
    countFrames,   // exposed for tests: countFrames(img, frameW, frameH, specFrames)
    /** Sprite for a character animation, or null. */
    sprite(charId, team, anim) {
      const c = store.chars[charId];
      return (c && c[team] && c[team][anim]) || null;
    },
    tower(team, variant) { return store.towers[team][variant] || null; },
    stage(key) { return store.stage[key] || null; },
    ui(key) { return store.ui[key] || null; },
    /** Effect strip { img, srcW, frames, w, h, fps } or null. */
    fx(key) { return store.fx[key] || null; },
  };
})();
