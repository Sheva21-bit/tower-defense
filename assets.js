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
  //   fps: number  -> fixed frame rate
  //   fps: 'cooldown' -> the whole strip plays once per attack, over the unit's cooldownSec
  // Frame size by class (square); SSR units are SSR_SIZE_BONUS px larger.
  SPRITE_SIZE_BY_CLASS: { ranger: 40, striker: 48, defender: 56 },
  SSR_SIZE_BONUS: 8,
  CHARACTERS: {},   // filled from CONFIG.UNIT_TYPES below: { prefix, frameW, frameH, recolor }
  CHARACTER_ANIMS: {
    walk:    { frames: 6, fps: 10,         loop: true  },  // idle = walk frame 0
    attack:  { frames: 4, fps: 'cooldown', loop: true  },
    death:   { frames: 4, fps: 8,          loop: false },  // plays once, then the body is removed
    ability: { frames: 6, fps: 12,         loop: false },  // optional (SR/SSR): plays once on ability use
    endure:  { frames: 4, fps: 8,          loop: false, onlyAbility: 'endure' },  // Brawn's Endure: 0 lift, 1 slam, 2-3 braced loop
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

  // ---------- sprite construction ----------
  /**
   * Build a sprite descriptor from a loaded strip.
   * mode: 'team'    -> per-team file, drawn as is
   *       'recolor' -> magenta replaced with team colour
   *       'outline' -> could not recolour: tinted sprite + team-colour outline
   */
  function buildSprite(img, src, def, animDef, mode, teamColor) {
    const scale = img.height / def.frameH;           // 1 normally, 2 if delivered at 2x
    const srcW = def.frameW * scale;
    const frames = Math.max(1, Math.round(img.width / srcW));
    if (Math.abs(frames * srcW - img.width) > 0.5) {
      store.warnings.push(`${src}: width ${img.width} is not a multiple of frame width ${srcW}`);
    }
    if (frames !== animDef.frames) {
      store.warnings.push(`${src}: ${frames} frames (spec says ${animDef.frames}) — using ${frames}`);
    }
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
      srcW, srcH: img.height,
      frameW: def.frameW, frameH: def.frameH,   // draw size
      frames,
      fps: animDef.fps,
      loop: animDef.loop,
    };
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
        store.fx[key] = img ? {
          img, srcW: img.height * def.w / def.h,
          frames: Math.max(1, Math.round(img.width / (img.height * def.w / def.h))),
          w: def.w, h: def.h, fps: def.fps,
        } : null;
      }));
    }
    await Promise.all(jobs);
    store.ready = true;

    const loaded = Object.entries(store.images).filter(([, v]) => v).map(([k]) => k);
    if (loaded.length) console.info(`[art] loaded ${loaded.length} image(s): ${loaded.join(', ')}`);
    for (const w of store.warnings) console.warn('[art] ' + w);
    return store;
  }

  return {
    manifest: M,
    store,
    loadAll,
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
