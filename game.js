/*
 * game.js — game logic + rendering for the lane tower-defense prototype.
 *
 * Coordinate model:
 *   - Every unit's horizontal position (unit.x) is stored in GRID units (float).
 *     0 = far-left edge of the stage, CONFIG.GRID_COUNT = far-right edge.
 *   - Only when drawing do we convert to pixels: px = x * CONFIG.GRID_SIZE_PX.
 *   - Movement per frame = speedGrids * dt (dt = seconds since last frame),
 *     so speed is identical at 30, 60 or 144 FPS.
 *   - Ranges, ability areas, dash distances, auras: all in grids.
 *
 * Teams: 'player' = left tower, walks right (+1).  'enemy' = right tower, walks left (-1).
 *
 * Units: CONFIG.UNIT_TYPES (class x rarity, see config.js). Abilities: abilities.js.
 *
 * Combat rules (per unit, per tick):
 *   1. Stunned or bubble-trapped units do nothing (no move, attack or ability). While a
 *      Defender is stunned/trapped its zone of control is suspended (it still physically blocks).
 *   2. Target priority: (a) the unit that TAUNTED it, if in range; (b) DEFENDER ZONE OF
 *      CONTROL: the nearest living enemy defender whose blockGrids reach this unit (the unit
 *      is held and must fight it); (c) the nearest enemy unit in range; (d) the enemy tower
 *      if its front edge is in range.
 *   3. If its ability is ready and its condition holds, it uses the ability as its attack.
 *      Enemy AI units always do this automatically. PLAYER units only do it automatically
 *      when Auto is on (button / key A); otherwise the player triggers it (click the glowing
 *      unit, or Shift+1..9 = frontmost ready unit of that roster slot).
 *   4. Otherwise it attacks its target when its cooldown is ready (rangers fire projectiles).
 *   5. With no target it walks forward, but can NEVER walk past (or into) a living enemy:
 *      it stops NO_PASS_GAP_GRIDS short of it. Living defenders therefore always block.
 *
 * Statuses (CONFIG.STATUSES): 'lifesteal' stacks drain HP every tick (true damage) and heal
 * the unit that applied them. Ticks keep running while stunned/trapped. Towers are immune.
 *
 * Art: assets.js (ART) loads optional images from assets/. Every draw function checks for
 * its art first and falls back to placeholder shapes. Art is purely visual.
 */
(function () {
  'use strict';

  const C = CONFIG;
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  canvas.width = C.STAGE_WIDTH_PX;
  canvas.height = C.STAGE_HEIGHT_PX;
  ctx.imageSmoothingEnabled = false; // keep pixel art crisp (re-applied every frame too)

  const AM = ASSET_MANIFEST;

  const TEAM = {
    player: { dir: +1, color: C.COLORS.player, name: 'Player' },
    enemy:  { dir: -1, color: C.COLORS.enemy,  name: 'Enemy'  },
  };

  // Front edge (in grids) of each tower — where units spawn and what attackers must reach.
  const TOWER_FRONT = {
    player: C.TOWER_WIDTH_GRIDS,
    enemy: C.GRID_COUNT - C.TOWER_WIDTH_GRIDS,
  };

  const gridToPx = (g) => g * C.GRID_SIZE_PX;
  // Phones/tablets: the canvas keeps its 1000x400 internal resolution and is only scaled by CSS
  // (pixelated), so devicePixelRatio never multiplies the drawing cost. Glow blurs are the most
  // expensive canvas op on mobile GPUs, so they're halved on touch devices.
  const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const BLUR = TOUCH ? 0.5 : 1;
  const UNIT_TYPES = C.UNIT_TYPES;                       // every faction's units
  let PLAYER_ROSTER, ENEMY_ROSTER;                       // spawn bar + keys 1-9 / enemy AI picks
  function refreshRosters() {
    PLAYER_ROSTER = C.rosterOf(C.PLAYER_FACTION);
    ENEMY_ROSTER = C.rosterOf(C.ENEMY_FACTION);
  }
  // Faction ids from the URL, the menu or Game.start() are validated as OWN keys of CONFIG.FACTIONS
  // (a plain C.FACTIONS[id] lookup lets 'constructor' / '__proto__' / 'toString' through via the prototype).
  const hasOwn = Object.hasOwn || ((o, k) => Object.prototype.hasOwnProperty.call(o, k));   // old iOS Safari
  const isFaction = (id) => typeof id === 'string' && hasOwn(C.FACTIONS, id);
  const DEFAULT_PLAYER_FACTION = isFaction(C.PLAYER_FACTION) ? C.PLAYER_FACTION : Object.keys(C.FACTIONS)[0];
  const DEFAULT_ENEMY_FACTION = isFaction(C.ENEMY_FACTION) && C.ENEMY_FACTION !== DEFAULT_PLAYER_FACTION
    ? C.ENEMY_FACTION : Object.keys(C.FACTIONS).find((id) => id !== DEFAULT_PLAYER_FACTION);
  C.PLAYER_FACTION = DEFAULT_PLAYER_FACTION;
  C.ENEMY_FACTION = DEFAULT_ENEMY_FACTION;
  // ?side=<faction> picks the player's faction (e.g. ?side=deva plays Deva vs Valkyries); anything else = defaults.
  (function applySideParam() {
    let side = null;
    try { side = new URLSearchParams(location.search).get('side'); } catch (e) { /* ignore */ }
    if (side != null && !isFaction(side)) console.info(`[td] ignoring unknown ?side=${side}; using ${DEFAULT_PLAYER_FACTION}`);
    if (isFaction(side) && side !== C.PLAYER_FACTION) {
      if (side === C.ENEMY_FACTION) C.ENEMY_FACTION = C.PLAYER_FACTION;
      C.PLAYER_FACTION = side;
    }
  })();
  refreshRosters();
  // Player ability casting: false = manual (click / Shift+1..9). Kept across restarts.
  // Default: ?auto=1/0 if given, else the menu's saved preference (localStorage td.autoCast).
  let autoCast = false;
  try {
    const qp = new URLSearchParams(location.search);
    autoCast = qp.has('auto') ? qp.get('auto') === '1' : localStorage.getItem('td.autoCast') === '1';
  } catch (e) { /* ignore */ }
  // Floating damage numbers on/off (key N / "123" button). Saved in localStorage.
  const NUMS_KEY = 'td.showDamageNumbers';
  let showNums = C.SHOW_DAMAGE_NUMBERS !== false;
  try { const v = localStorage.getItem(NUMS_KEY); if (v === '0' || v === '1') showNums = v === '1'; } catch (e) { /* storage blocked: use default */ }
  const typeById = (id) => UNIT_TYPES.find((c) => c.id === id);
  const CAST_ANIM_SEC = 0.5;   // visual: how long the "ability" pose/animation shows

  // ------------------------------------------------------------------
  // Game state
  // ------------------------------------------------------------------
  let state;
  let nextUnitId = 1;

  function newStats() { return { spawned: {}, abilityUses: {}, damageBy: {}, kills: {}, projectiles: 0 }; }

  function newGame(opts) {
    opts = opts || {};
    state = {
      time: 0,
      units: [],
      projectiles: [],           // ranger shots in flight (gameplay: damage applies on arrival)
      timers: [],                // delayed ability actions (game time), e.g. Bubble Trap pop
      zones: [],                 // persistent ground areas, e.g. Raven's Dark Cloud
      effects: [],               // visual only: rings, beams, floating text...
      corpses: [],               // visual only: dying units playing their death animation
      nums: [],                  // visual only: floating damage / heal numbers
      towers: {
        player: { hp: C.TOWER_HP, maxHp: C.TOWER_HP },
        enemy:  { hp: C.TOWER_HP, maxHp: C.TOWER_HP },
      },
      resource: C.AP.start,        // player AP (fractional pool; whole AP = apWhole(resource))
      enemyResource: C.AP.start,   // enemy AP: same rules (CONFIG.AP)
      enemyNext: null,
      sandbox: !!opts.sandbox,   // testing: no economy, no enemy AI
      forceAuto: !!opts.forceAuto, // sims: player units auto-cast regardless of the Auto toggle
      over: false,
      winner: null,
      stats: newStats(),
      debug: state ? state.debug : false, // keep debug toggle across restarts
    };
    document.getElementById('overlay').classList.add('hidden');
    if (info && info.unit) closeInfo();   // live unit belongs to the old match
  }

  // ------------------------------------------------------------------
  // Spawning
  // ------------------------------------------------------------------
  function spawnUnit(team, typeId, atX) {
    const t = typeById(typeId);
    if (!t) return null;
    const A = t.ability ? C.ABILITIES[t.ability] : null;
    const unit = {
      id: nextUnitId++,
      team,
      type: t,
      x: atX != null ? atX : TOWER_FRONT[team],   // position in GRIDS
      hp: t.hp,
      cooldown: 0,               // seconds until next attack allowed
      abilityCd: A ? (A.firstCooldownSec != null ? A.firstCooldownSec : A.cooldownSec) : 0,
      stun: 0,                   // seconds of stun left
      trapT: 0,                  // seconds of bubble trap left (floats, can't act)
      ls: [],                    // Life Steal stacks, each with its own timer: [{ src, next, until }]
      speedBuffT: 0, speedBuffMult: 1, // movement-speed buff (Rallying Charge); doesn't stack
      hop: null,                 // short scripted move { from, to, t, dur } (e.g. Dark Cloud hop back)
      charge: null,              // shield charge in progress { left, speed, hit:Set, ... } (Grey's Shield Bash)
      knock: null,               // being knocked back { from, to, t, dur } (smooth push, can't act meanwhile)
      endureT: 0, endureFrom: 0,   // Endure (Brawn): seconds left; active from the tick after the cast
      castQueued: false,         // manual cast requested; fires when the attack is ready
      tauntBy: null, tauntT: 0,  // taunted: must attack tauntBy while in range
      dmgTakenMult: 1,           // recomputed every tick (auras)
      state: 'walk',             // 'walk' | 'fight' | 'stunned'
      target: null,
      depth: (nextUnitId % 4) * 6, // small vertical offset so stacked units stay visible (visual)
      flash: 0,                  // hit flash timer (visual)
      castT: 0,                  // visual: ability pose timer
      bornAt: state.time,        // visual: walk-cycle phase
    };
    state.units.push(unit);
    state.stats.spawned[t.id] = (state.stats.spawned[t.id] || 0) + 1;
    return unit;
  }

  // ---- Rarity caps (RARITIES.<id>.maxAlive): max living units of a rarity per side ----
  /** Living (hp > 0) units of `rarityId` on `team`. Dying / dead units don't count. */
  function aliveOfRarity(team, rarityId) {
    let n = 0;
    for (const u of state.units) if (u.team === team && u.hp > 0 && u.type.rarityId === rarityId) n++;
    return n;
  }
  /** Cap for a unit type's rarity, or null if uncapped. */
  const rarityCap = (t) => (t.rarity && t.rarity.maxAlive > 0 ? t.rarity.maxAlive : null);
  /** True if `team` already has the max number of living units of t's rarity. */
  function isCapped(team, t) {
    const cap = rarityCap(t);
    return cap != null && aliveOfRarity(team, t.rarityId) >= cap;
  }
  const capMsg = (t) => `Max ${rarityCap(t)} ${t.rarity.name.toLowerCase()}s`;

  // ---------------- Action points (AP): same rules for both sides (CONFIG.AP) ----------------
  /** Whole AP in a fractional pool (epsilon: 60 ticks of 1/60 s must make exactly +1). */
  const apWhole = (v) => Math.floor(v + 1e-6);
  const apRegen = (v, dt) => Math.min(C.AP.max, v + C.AP.perSec * dt);
  const canAfford = (pool, cost) => apWhole(pool) >= cost;
  const apSpend = (pool, cost) => Math.max(0, pool - cost);

  /** Player spawn: checks the rarity cap and AP, then spends. Returns true on success. */
  function playerSpawn(typeId) {
    if (state.over) return false;
    const t = typeById(typeId);
    if (!t || t.factionId !== C.PLAYER_FACTION) return false;
    if (isCapped('player', t)) {         // blocked: costs nothing, brief feedback
      if (state.capMsgAt == null || state.time - state.capMsgAt > 0.35) {
        state.capMsgAt = state.time;
        fx({ kind: 'text', x: TOWER_FRONT.player + 3, text: capMsg(t), color: '#ffcc80', depth: 0, dur: 1.1 });
      }
      flashCapped(t);
      return false;
    }
    if (!canAfford(state.resource, t.cost)) return false;
    state.resource = apSpend(state.resource, t.cost);
    spawnUnit('player', typeId);
    return true;
  }

  /**
   * Enemy AI: weighted random pick from its faction's roster (weights favour Commons).
   * Types whose rarity cap is full are skipped. preferAffordable: pick among what it can buy
   * right now when possible (used when its saved-for pick became capped, so it doesn't stall).
   */
  function enemyPickType(preferAffordable) {
    let pool = ENEMY_ROSTER.filter((c) => !isCapped('enemy', c));
    if (!pool.length) pool = ENEMY_ROSTER;   // can't happen with a common-only cap; safe fallback
    if (preferAffordable) {
      const now = pool.filter((c) => canAfford(state.enemyResource, c.cost));
      if (now.length) pool = now;
    }
    const total = pool.reduce((s, c) => s + c.enemyWeight, 0);
    let r = Math.random() * total;
    for (const c of pool) {
      r -= c.enemyWeight;
      if (r <= 0) return c.id;
    }
    return pool[0].id;
  }

  /** Enemy economy: earns AP like the player, saves for its next pick, buys it when affordable. */
  function enemyThink(dt) {
    state.enemyResource = apRegen(state.enemyResource, dt);
    if (!state.enemyNext) state.enemyNext = enemyPickType();
    // Saved-for pick hit its rarity cap meanwhile -> pick something else (affordable if possible).
    if (isCapped('enemy', typeById(state.enemyNext))) state.enemyNext = enemyPickType(true);
    const t = typeById(state.enemyNext);
    if (state.time >= C.ENEMY_FIRST_SPAWN_SEC && canAfford(state.enemyResource, t.cost) && !isCapped('enemy', t)) {
      state.enemyResource = apSpend(state.enemyResource, t.cost);
      spawnUnit('enemy', t.id);
      state.enemyNext = enemyPickType();
    }
  }

  function enemyNextSpawnEta() {
    if (!state.enemyNext) return Math.max(0, C.ENEMY_FIRST_SPAWN_SEC - state.time);
    const t = typeById(state.enemyNext);
    const need = Math.max(0, t.cost - state.enemyResource) / C.AP.perSec;
    return Math.max(need, C.ENEMY_FIRST_SPAWN_SEC - state.time, 0);
  }

  // ------------------------------------------------------------------
  // Combat helpers (also the API handed to abilities.js)
  // ------------------------------------------------------------------
  const dirOf = (u) => TEAM[u.team].dir;
  const foeTeamOf = (u) => (u.team === 'player' ? 'enemy' : 'player');
  const dist = (a, b) => Math.abs(a.x - b.x);
  const ahead = (u, o) => (o.x - u.x) * dirOf(u);
  const foes = (u) => state.units.filter((o) => o.team !== u.team && o.hp > 0);
  const allies = (u) => state.units.filter((o) => o.team === u.team && o.hp > 0);

  /**
   * Apply damage to a unit: armor (class) and damage-taken multipliers (auras).
   * Inside a simulation tick (state.hitBuffer set, see update()) the hit is BUFFERED: the amount
   * dealt is computed now (so Life Steal heals etc. see the right number) but HP only drops when
   * the buffer is flushed at the end of the tick, so every unit acting on the same tick lands its
   * hits and deaths resolve together (no update-order advantage). Outside a tick it applies at once.
   */
  function damageUnit(target, amount, source, opts) {
    if (!target || target.hp <= 0) return 0;
    const trueDmg = opts && opts.trueDamage;     // true damage ignores armor and auras
    const enduring = endureActive(target);
    const raw = amount * (trueDmg ? 1 : (1 - (target.type.armor || 0)) * target.dmgTakenMult * (enduring ? 1 - (target.endureDR || 0) : 1));
    // Endure: a DIRECT attack (melee hit / arrow) on him queues a knockback of the attacker (applied after the tick)
    if (enduring && opts && opts.direct && source && source.hp > 0 && source.team !== target.team && raw > 0) {
      (state.pendingKnocks || (state.pendingKnocks = [])).push({ by: target, who: source });
      if (!state.hitBuffer) applyPendingKnocks();
    }
    if (state.hitBuffer) {
      const dealt = Math.max(0, Math.min(target.hp - (target.pendingDmg || 0), raw));
      if (!(dealt > 0)) return 0;                  // already doomed this tick: overkill is dropped
      target.pendingDmg = (target.pendingDmg || 0) + dealt;
      state.hitBuffer.push({ target, dealt, source, opts });
      return dealt;
    }
    return applyHit(target, Math.min(target.hp, raw), source, opts);
  }

  /** Actually remove HP (+ flash, number, stats). */
  function applyHit(target, dealt, source, opts) {
    if (!(dealt > 0)) return 0;
    target.hp -= dealt;
    if (!(opts && opts.noFlash)) target.flash = 0.12;
    dmgNumber(target, dealt, opts && opts.dot ? 'red' : 'white');
    if (source) {
      const sid = source.type.id;
      state.stats.damageBy[sid] = (state.stats.damageBy[sid] || 0) + dealt;
      if (target.hp <= 0) state.stats.kills[sid] = (state.stats.kills[sid] || 0) + 1;
    }
    return dealt;
  }

  /** Endure counts from the tick after the cast (statuses applied during a tick act from the next one). */
  function endureActive(u) { return u.endureT > 0 && state.time > u.endureFrom + 1e-9; }
  /** Endure knockbacks queued during the tick: each attacker once per tick, away from the endurer. */
  function applyPendingKnocks() {
    const q = state.pendingKnocks || [];
    state.pendingKnocks = [];
    const done = new Set();
    for (const { by, who } of q) {
      if (done.has(who) || who.hp <= 0) continue;
      done.add(who);
      const A = C.ABILITIES[by.type.ability] || C.ABILITIES.endure;
      const dir = who.x >= by.x ? 1 : -1;   // away from him (toward the attacker's own tower)
      if (knockback(who, dir * A.knockbackGrids, A.knockbackSec, A.interruptsAttack !== false)) {
        fx({ kind: 'endureknock', unit: who, dir, depth: who.depth, dur: A.knockFxSec || 0.33 });
        state.stats.endureKnocks = (state.stats.endureKnocks || 0) + 1;
      }
    }
  }
  /** Endure (Brawn): plant the shield for sec seconds (no walking, keeps attacking, damage reduction). */
  function endure(u, A) {
    if (!u || u.hp <= 0) return;
    u.endureT = A.durationSec;
    u.endureDur = A.durationSec;
    u.endureDR = A.damageReduction || 0;
    u.endureFrom = state.time;
    fx({ kind: 'endureslam', unit: u, dir: dirOf(u), depth: u.depth, delay: 0.12, dur: (A.slamFxSec || 0.33) + 0.12 });
  }

  /** End of tick: apply every buffered hit in order (kill credit = the hit that crosses 0). */
  function flushHits() {
    const buf = state.hitBuffer || [];
    state.hitBuffer = null;
    for (const h of buf) h.target.pendingDmg = 0;
    for (const h of buf) {
      if (h.target.hp <= 0) continue;
      applyHit(h.target, Math.min(h.target.hp, h.dealt), h.source, h.opts);
    }
  }

  function damageTower(team, amount, source) {
    const before = state.towers[team].hp;
    state.towers[team].hp = Math.max(0, before - amount);
    dmgNumber({ tower: team }, before - state.towers[team].hp, 'white');
    if (source) {
      const sid = source.type.id;
      state.stats.damageBy[sid] = (state.stats.damageBy[sid] || 0) + amount;
    }
  }

  /** Heal a unit (capped at max HP); shows a green +N. Returns the amount healed. */
  function healUnit(u, amount) {
    if (!u || u.hp <= 0 || !(amount > 0)) return 0;
    const h = Math.min(amount, u.type.hp - u.hp);
    if (h <= 0) return 0;
    u.hp += h;
    dmgNumber(u, h, 'green');
    return h;
  }

  // ---------------- Floating damage numbers (visual only) ----------------
  const DN = C.DAMAGE_NUMBERS || {};
  /** Canvas y (px) just above a unit's head: sprite top, above the HP bar + rarity pips. */
  function unitHeadY(u) {
    const walk = ART.sprite(u.type.id, u.team, 'walk');
    const h = walk ? walk.frameH : u.type.sizePx;
    return C.GROUND_Y_PX - u.depth - h - 15;
  }
  const numText = (kind, value) => (kind === 'green' ? '+' : '') + Math.max(0, Math.round(value));
  /** Approx. on-canvas box of a number (px) at its current float height. */
  function numRect(n) {
    const def = AM.UI.digits_white || {};
    const adv = def.advance || 5, cw = def.cellW || 6;
    const text = n.text || numText(n.kind, n.value);
    const w = ((text.length - 1) * adv + cw) * n.scale, h = 9 * n.scale;
    const k = Math.min(1, n.t / (n.dur || 0.6));
    const rise = (DN.risePx != null ? DN.risePx : 12) * k;   // linear: same speed for all -> spacing holds
    const cx = gridToPx(n.x) + n.jitter, bottom = n.y - rise;
    return { l: cx - w / 2 - 1, r: cx + w / 2 + 1, t: bottom - h, b: bottom };
  }
  /**
   * Spawn a number where damage / healing was applied. anchor = unit or { tower: team }.
   * kind: 'white' (direct hit, 2x) | 'red' (life steal tick, 1x) | 'green' (heal, '+', 1x).
   * Red / green on the same unit within DN.mergeSec merge into one number.
   */
  function dmgNumber(anchor, value, kind) {
    if (!showNums || !state || !(value > 0)) return;
    const nums = state.nums;
    if (kind !== 'white') {
      for (let i = nums.length - 1; i >= 0; i--) {
        const n = nums[i];
        if (n.anchor === anchor && n.kind === kind && n.t < (DN.mergeSec || 0.25)) { n.value += value; return; }
      }
    } else if (Math.round(value) < 1) return;   // never show 0
    let x, y;
    if (anchor.tower) {
      const w = C.TOWER_WIDTH_GRIDS;
      x = anchor.tower === 'player' ? w / 2 : C.GRID_COUNT - w / 2;
      y = C.GROUND_Y_PX - (AM.TOWER_SIZE ? AM.TOWER_SIZE.h : 192) * 0.62;
    } else { x = anchor.x; y = unitHeadY(anchor); }
    const j = DN.jitterPx != null ? DN.jitterPx : 3;
    // Anti-clutter: keep at most maxPerTarget numbers over one unit (oldest dropped), and place
    // the new number in the first free slot (no overlap with other fresh numbers, on ANY unit:
    // AoE hits on a tight clump land at once). No free slot -> merge into this target's newest
    // number of the same colour instead of stacking an unreadable pile.
    const same = nums.filter((n) => n.anchor === anchor);
    const perMax = DN.maxPerTarget || 4;
    const scale = kind === 'white' ? (DN.hitScale || 2) : kind === 'red' ? (DN.dotScale || 1) : (DN.healScale || 1);
    const jit = Math.round((Math.random() * 2 - 1) * j);
    const cand = { x, scale, text: numText(kind, value), jitter: jit, y, t: 0 };
    let placed = false;
    const busy = nums.filter((n) => n.t < 0.45).map(numRect);
    search:
    for (let k = 0; k < 5; k++) {
      for (const dx of [0, -14, 14, -26, 26]) {
        cand.y = y - k * 10; cand.jitter = jit + dx;
        const r = numRect(cand);
        if (!busy.some((o) => r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t)) { placed = true; break search; }
      }
    }
    if (!placed) {
      const mate = same.filter((n) => n.kind === kind).pop();
      if (mate) { mate.value += value; return; }
      state.stats.dmgNumbersDropped = (state.stats.dmgNumbersDropped || 0) + 1;
      return;   // no room and nothing to merge into: skip (purely cosmetic; avoids a pile-up)
    }
    if (same.length >= perMax) nums.splice(nums.indexOf(same[0]), 1);
    nums.push({ anchor, kind, value, x, y: cand.y, jitter: cand.jitter, t: 0,
      dur: DN.durationSec || 0.6, scale });
    const max = DN.maxActive || 40;
    if (nums.length > max) nums.splice(0, nums.length - max);   // drop the oldest
    state.stats.dmgNumbers = (state.stats.dmgNumbers || 0) + 1;
  }
  function setShowNums(on) {
    showNums = !!on;
    try { localStorage.setItem(NUMS_KEY, showNums ? '1' : '0'); } catch (e) { /* ignore */ }
    if (!showNums && state) state.nums = [];
    refreshHudControls();
  }

  /**
   * Move u toward x, but NEVER through a living enemy (stops NO_PASS_GAP_GRIDS short of the
   * first enemy ahead) and never into the enemy tower. This is what makes defenders a wall.
   */
  function moveTo(u, x) { u.x = moveLimit(u, x); }
  /** Where u would end up moving toward x (moveTo's rules), without moving it. */
  function moveLimit(u, x) {
    const d = dirOf(u);
    let nx = x;
    const gap = C.NO_PASS_GAP_GRIDS;
    for (const o of state.units) {
      if (o.team === u.team || o.hp <= 0) continue;
      if (ahead(u, o) < -1e-6) continue;              // only enemies in front matter
      const lim = o.x - d * gap;
      if (d > 0) nx = Math.min(nx, Math.max(u.x, lim));
      else nx = Math.max(nx, Math.min(u.x, lim));
    }
    if (d > 0) nx = Math.min(nx, TOWER_FRONT.enemy);
    else nx = Math.max(nx, TOWER_FRONT.player);
    return nx;
  }

  /** Defender zone of control: nearest living enemy defender that holds u, or null. */
  function zocHolder(u) {
    let best = null, bd = Infinity;
    for (const o of state.units) {
      if (o.team === u.team || o.hp <= 0 || !(o.type.blockGrids > 0)) continue;
      if (o.stun > 0 || o.trapT > 0 || o.knock) continue;   // incapacitated / knocked-back defenders don't hold anyone
      const d = dist(u, o);
      if (d <= o.type.blockGrids && d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Target selection (see header comment for the priority order). */
  function pickTarget(u) {
    const range = u.type.rangeGrids;
    if (u.tauntT > 0 && u.tauntBy && u.tauntBy.hp > 0 && dist(u, u.tauntBy) <= range) return u.tauntBy;
    const holder = zocHolder(u);
    if (holder && dist(u, holder) <= range) return holder;
    let target = null, best = Infinity;
    for (const o of state.units) {
      if (o.team === u.team || o.hp <= 0) continue;
      const d = dist(u, o);
      if (d <= range && d < best) { best = d; target = o; }
    }
    return target;
  }

  function fx(e) { e.t = 0; state.effects.push(e); }

  // ---------------- Statuses ----------------
  /** Add `stacks` of a status to a unit (towers aren't units, so they're immune). */
  function addStatus(target, id, stacks, source) {
    if (!target || target.hp <= 0 || !(stacks > 0)) return 0;
    if (id !== 'lifesteal') { console.warn('[status] unknown status', id); return 0; }
    const S = C.STATUSES.lifesteal;
    let added = 0;
    for (let i = 0; i < stacks; i++) {
      if (S.maxStacks && target.ls.length >= S.maxStacks) break;
      // Own timer per stack: drains at +tickSec, +2*tickSec, ... up to (and including) +durationSec.
      target.ls.push({ src: source || null, next: state.time + S.tickSec,
        until: S.durationSec ? state.time + S.durationSec : Infinity });
      added++;
    }
    state.stats.lifestealStacks = (state.stats.lifestealStacks || 0) + added;
    return added;
  }

  /** Life Steal: every stack ticks on its own timer, draining hpPerStackPerSec * tickSec and
   *  healing its source; it expires after durationSec (no refresh by newer stacks). */
  function updateLifesteal(u) {
    const S = C.STATUSES.lifesteal;
    const per = S.hpPerStackPerSec * S.tickSec;
    const healed = new Map();
    for (const st of u.ls) {
      while (u.hp > 0 && st.next <= state.time + 1e-9 && st.next <= st.until + 1e-6) {
        st.next += S.tickSec;
        const dealt = damageUnit(u, per, st.src, { trueDamage: S.trueDamage, noFlash: true, dot: true });
        state.stats.lifestealDrain = (state.stats.lifestealDrain || 0) + dealt;
        const src = st.src;
        if (S.healSource && src && src.hp > 0 && dealt > 0) {
          const h = Math.min(dealt, src.type.hp - src.hp);
          if (h > 0) { healUnit(src, h); healed.set(src, (healed.get(src) || 0) + h); }
        }
      }
    }
    u.ls = u.ls.filter((st) => st.next <= st.until + 1e-6);   // expired once all its ticks are done
    for (const [src, h] of healed) {
      state.stats.lifestealHeal = (state.stats.lifestealHeal || 0) + h;
      fx({ kind: 'drain', x0: u.x, depth: u.depth, src, dur: 0.5 });   // homing wisp back to the healer
    }
  }

  /** Movement-speed buff (doesn't stack: the larger bonus wins, re-applying refreshes). */
  function buffSpeed(t, mult, sec) {
    if (!t || t.hp <= 0) return;
    t.speedBuffMult = t.speedBuffT > 0 ? Math.max(t.speedBuffMult, mult) : mult;
    t.speedBuffT = Math.max(t.speedBuffT, sec);
  }

  /** Quick scripted move by dx grids over `sec` (e.g. hop back). Never behind the own
   *  tower's front, never through a living enemy, never into the enemy tower. */
  function hop(u, dx, sec) {
    let to = u.x + dx;
    const gap = C.NO_PASS_GAP_GRIDS;
    for (const o of state.units) {
      if (o.team === u.team || o.hp <= 0) continue;
      if (dx < 0 && o.x < u.x) to = Math.max(to, o.x + gap);
      if (dx > 0 && o.x > u.x) to = Math.min(to, o.x - gap);
    }
    to = Math.min(Math.max(to, TOWER_FRONT.player), TOWER_FRONT.enemy);
    if ((to - u.x) * dx < 0) to = u.x;                       // never move the wrong way
    u.hop = { from: u.x, to, t: 0, dur: Math.max(0.01, sec || 0.2) };
  }

  /**
   * Shield charge (Grey's Shield Bash). u rushes forward up to opts.grids at opts.speed grids/s.
   * Every enemy he bumps into (contact distance in front) is hit ONCE per charge: optional damage,
   * then a smooth knockback of opts.knockGrids over opts.knockSec (ccImmune units: hit, not moved).
   * He keeps going and stops at the end of the distance, at the enemy tower, or when something
   * he can't move (ccImmune, a unit pinned at its own tower) blocks him. Resolved in resolveCharges().
   */
  function charge(u, opts) {
    if (!u || u.hp <= 0) return;
    u.hop = null;
    u.charge = Object.assign({ left: 2, speed: 10, knockGrids: 3, knockSec: 0.25, damage: 0,
      interrupt: true, hit: new Set(), t: 0 }, opts || {});
    u.charge.hit = new Set();
    u.charge.maxT = u.charge.left / Math.max(0.01, u.charge.speed) + 0.5;   // safety cap
    u.state = 'charge';
  }

  /** Smooth knockback of t by dx grids over sec. Clamped so it never goes past its OWN tower
   *  (nor the other tower). ccImmune units and towers are never moved. Interrupts t's charge /
   *  hop, and (interrupt=true) restarts its attack wind-up: attack timer back to full. */
  function knockback(t, dx, sec, interrupt) {
    if (!t || t.hp <= 0 || t.type.ccImmune) return false;
    let to = t.x + dx;
    to = Math.min(Math.max(to, TOWER_FRONT.player), TOWER_FRONT.enemy);   // own tower front is the wall
    t.charge = null;
    t.hop = null;
    t.knock = { from: t.x, to, t: 0, dur: Math.max(0.01, sec || 0.25) };
    if (interrupt) t.cooldown = Math.max(t.cooldown, t.type.cooldownSec);
    t.state = 'knocked';
    return true;
  }

  /** After phase 0: all chargers move, THEN all bumps are detected, THEN all knockbacks start,
   *  so the unit list order never matters (two Greys charging each other both get shoved). */
  function resolveCharges(dt) {
    const chargers = state.units.filter((u) => u.hp > 0 && u.charge);
    if (!chargers.length) return;
    const gap = C.NO_PASS_GAP_GRIDS;
    const moved = new Map();
    // every charger's step is decided from the SAME positions, then all move (never through enemies / into the tower)
    const dest = chargers.map((u) => moveLimit(u, u.x + dirOf(u) * Math.min(u.charge.left, u.charge.speed * dt)));
    chargers.forEach((u, i) => {
      const c = u.charge;
      c.t += dt;
      const m = Math.abs(dest[i] - u.x);
      u.x = dest[i];
      c.left = Math.max(0, c.left - m);
      moved.set(u, m);
    });
    const bumps = [];
    for (const u of chargers) {
      for (const o of state.units) {
        if (o.team === u.team || o.hp <= 0 || u.charge.hit.has(o)) continue;
        const a = ahead(u, o);
        if (a >= -0.5 && a <= gap + 0.05) bumps.push([u, o, u.charge]);   // charge captured: u may get shoved below
      }
    }
    const shoved = new Set();
    for (const [u, o, c] of bumps) {
      c.hit.add(o);
      if (c.damage > 0) damageUnit(o, c.damage, u);
      if (shoved.has(o)) continue;                       // two chargers, same victim, same tick: one shove
      shoved.add(o);
      const dir = dirOf(u);
      if (knockback(o, dir * c.knockGrids, c.knockSec, c.interrupt)) {
        fx({ kind: 'bashimpact', unit: o, dir, depth: o.depth, dur: 0.32 });
      }
      state.stats.knockbacks = (state.stats.knockbacks || 0) + 1;
    }
    for (const u of chargers) {
      const c = u.charge;
      if (!c) continue;                                  // knocked back by an enemy charger this tick
      const atTower = (TOWER_FRONT[foeTeamOf(u)] - u.x) * dirOf(u) <= 1e-6;
      const blocked = moved.get(u) < 1e-6 && !bumps.some((b) => b[0] === u);
      if (c.left <= 1e-6 || atTower || blocked || c.t >= c.maxT) u.charge = null;
    }
  }

  /** Persistent area: calls onEnter(unit) once per enemy unit that is inside it. */
  function addZone(z) {
    z.hit = new Set();
    z.born = state.time;
    state.zones.push(z);
    return z;
  }

  function updateZones() {
    for (const z of state.zones) {
      if (state.time >= z.until) continue;
      for (const o of state.units) {
        if (o.team === z.team || o.hp <= 0 || z.hit.has(o.id)) continue;
        if (Math.abs(o.x - z.x) <= z.rGrids) { z.hit.add(o.id); if (z.onEnter) z.onEnter(o); }
      }
    }
    state.zones = state.zones.filter((z) => state.time < z.until);
  }

  /** Normal-attack on-hit statuses (e.g. Raven: +1 Life Steal per hit). */
  function applyOnHit(onHit, target, source) {
    if (!onHit || !target || target.hp <= 0) return;
    for (const [id, n] of Object.entries(onHit)) addStatus(target, id, n, source);
  }

  const abilityApi = {
    C,
    get state() { return state; },
    dir: dirOf, foes, allies, ahead, dist,
    currentTarget: (u) => { const t = pickTarget(u); return t && t.hp > 0 ? t : null; },
    damage: damageUnit,
    heal: healUnit,
    stun: (t, sec) => {
      if (!t || t.hp <= 0 || t.type.ccImmune) return;
      t.stun = Math.max(t.stun, sec);
      if (t.trapT <= 0) t.state = 'stunned';
      fx({ kind: 'text', x: t.x, text: 'STUN', color: '#fff176', depth: t.depth, dur: 0.6 });
    },
    taunt: (t, by, sec) => { t.tauntBy = by; t.tauntT = Math.max(t.tauntT, sec); },
    /** Bubble trap: no move / attack / ability for `sec`. Doesn't stack: takes the longer. */
    trap: (t, sec) => {
      if (!t || t.hp <= 0 || t.type.ccImmune) return;
      t.trapT = Math.max(t.trapT, sec);
      t.state = 'trapped';
    },
    /** Fly a projectile to a grid position (no unit target), then call onArrive(). */
    launch: (o) => {
      state.projectiles.push({
        team: o.source ? o.source.team : 'player', x: o.fromX, toX: o.toX, depth: o.depth || 0,
        speed: o.speedGrids || 20, style: o.style || 'arrow', born: state.time,
        source: o.source || null, onArrive: o.onArrive, target: null, towerTeam: null,
      });
    },
    /** Run fn after `sec` seconds of game time (cleared on restart). */
    later: (sec, fn) => { state.timers.push({ at: state.time + sec, fn }); },
    shoot: (u, target, mult) => { if (target && target.hp > 0) fireProjectile(u, target, u.type.damage * (mult == null ? 1 : mult)); },
    /** True if projectiles already in flight at t will kill it (so a follow-up shot should retarget). */
    doomed: (t) => {
      if (!t || t.hp <= 0) return true;
      const mult = (1 - (t.type.armor || 0)) * (t.dmgTakenMult || 1);
      let inc = 0;
      for (const p of state.projectiles) if (!p.done && p.target === t && !p.onArrive) inc += p.damage * mult;
      return inc >= t.hp - 1e-6;
    },
    canAct: (u) => !!u && u.hp > 0 && !(u.stun > 0) && !(u.trapT > 0) && !u.hop && !u.knock && !u.charge,
    burst: (u, sec) => { u.burstT = Math.max(u.burstT || 0, sec); },
    addStatus,
    buffSpeed,
    hop,
    charge,
    knockback,
    endure,
    addZone,
    moveTo,
    fx,
  };

  /** A ranger's normal shot (standard projectile + onHit) at a unit, or at the enemy tower (target null). */
  function fireProjectile(u, target, damage) {
    const style = u.type.projectile || 'arrow';
    const ps = (C.PROJECTILES && C.PROJECTILES[style]) || {};
    state.projectiles.push({
      team: u.team, x: u.x + dirOf(u) * 0.5, depth: u.depth,
      target: target || null, towerTeam: target ? null : foeTeamOf(u),
      damage, speed: ps.speedGrids || u.type.projectileSpeedGrids || 40, source: u,
      style, born: state.time, onHit: u.type.onHit,
      hitY: target ? target.type.sizePx / 2 : 60,
    });
    state.stats.projectiles++;
  }

  /** Normal attack. Rangers fire a projectile; everyone else hits instantly. */
  function basicAttack(u, target) {
    const foeTeam = foeTeamOf(u);
    if (u.type.ranged) {
      fireProjectile(u, target, u.type.damage);
    } else if (target) {
      damageUnit(target, u.type.damage, u, { direct: true });
      applyOnHit(u.type.onHit, target, u);
    } else {
      damageTower(foeTeam, u.type.damage, u);
    }
  }

  // ---------------- Ability casting (auto / manual) ----------------
  const autoFor = (u) => u.team !== 'player' || autoCast || state.forceAuto;

  function doCast(u) {
    const abId = u.type.ability;
    const A = C.ABILITIES[abId];
    ABILITY_IMPL[abId].use(u, A, abilityApi);
    u.abilityCd = A.cooldownSec;
    // Normally the ability IS this cycle's attack (attack timer restarts). offCycle abilities (Nimble Shot)
    // are an extra burst: the attack timer keeps running (a burst lock stops attacks mid-burst instead).
    if (!A.offCycle) u.cooldown = u.type.cooldownSec;
    u.castT = CAST_ANIM_SEC;
    u.castQueued = false;
    state.stats.abilityUses[abId] = (state.stats.abilityUses[abId] || 0) + 1;
  }

  function noTarget(u) {
    fx({ kind: 'text', x: u.x, text: 'No target', color: '#cfd8dc', depth: u.depth, dur: 0.7 });
  }

  /**
   * Manual cast (player). Returns 'cast' | 'queued' | 'no-target' | 'cooldown' | 'none'.
   * The condition is checked now: no target -> brief 'No target', cooldown NOT consumed.
   * If the unit is mid-attack / stunned / trapped / hopping, the cast is queued and fires as
   * soon as it can act (re-checking the condition then).
   */
  function tryCast(u) {
    if (!u || u.hp <= 0 || state.over || !u.type.ability) return 'none';
    const abId = u.type.ability;
    const A = C.ABILITIES[abId];
    const impl = ABILITY_IMPL[abId];
    if (!impl) return 'none';
    if (u.abilityCd > 0) {
      fx({ kind: 'text', x: u.x, text: `${u.abilityCd.toFixed(1)}s`, color: '#b0bec5', depth: u.depth, dur: 0.6 });
      return 'cooldown';
    }
    if (u.castQueued) return 'queued';
    const busy = u.stun > 0 || u.trapT > 0 || u.hop || u.knock || u.charge;
    if (!busy && !impl.canUse(u, A, abilityApi)) { noTarget(u); return 'no-target'; }
    if (!busy && (u.cooldown <= 0 || A.offCycle) && !(u.burstT > 0)) { doCast(u); return 'cast'; }
    u.castQueued = true;
    return 'queued';
  }

  /** Shift+1..9: frontmost ready unit of that roster slot. */
  function castBySlot(key) {
    const c = PLAYER_ROSTER.find((ch) => ch.key === key);
    if (!c || !c.ability) return 'none';
    const mine = state.units.filter((u) => u.team === 'player' && u.hp > 0 && u.type.id === c.id)
      .sort((a, b) => b.x - a.x);                         // frontmost first (player walks right)
    if (!mine.length) return 'none';
    const ready = mine.find((u) => u.abilityCd <= 0 && !u.castQueued);
    return tryCast(ready || mine[0]);
  }

  function updateProjectiles(dt) {
    for (const p of state.projectiles) {
      if (p.done) continue;
      if (p.target && p.target.hp <= 0) {                               // target died: fizzle
        p.done = true;
        if (p.style === 'bubble') fx({ kind: 'pop', x: p.x, rGrids: 0.6, color: '#b3e5fc', depth: p.depth, dur: 0.3 });
        continue;
      }
      const tx = p.toX != null ? p.toX : p.target ? p.target.x : TOWER_FRONT[p.towerTeam];
      const step = p.speed * dt;
      if (Math.abs(tx - p.x) <= step) {
        p.x = tx;
        p.done = true;
        if (p.onArrive) p.onArrive();
        else if (p.target) { damageUnit(p.target, p.damage, p.source, { direct: true }); applyOnHit(p.onHit, p.target, p.source); }
        else damageTower(p.towerTeam, p.damage, p.source);
        const ps = C.PROJECTILES && C.PROJECTILES[p.style];
        if (ps && ps.popFx) fx({ kind: 'pop', x: tx, rGrids: 0.6, color: '#b3e5fc', depth: p.target ? p.target.depth : p.depth, dur: 0.3 });
      } else {
        p.x += Math.sign(tx - p.x) * step;
      }
    }
    state.projectiles = state.projectiles.filter((p) => !p.done);
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------
  function update(dt) {
    if (state.over) return;
    state.time += dt;

    if (!state.sandbox) {
      // Player AP regen (CONFIG.AP)
      state.resource = apRegen(state.resource, dt);
      enemyThink(dt);
    }

    // Passives (auras) are recomputed from scratch each tick.
    for (const u of state.units) u.dmgTakenMult = 1;
    for (const u of state.units) {
      if (u.hp <= 0 || !u.type.ability) continue;
      const impl = ABILITY_IMPL[u.type.ability];
      if (impl && impl.passive) impl.passive(u, C.ABILITIES[u.type.ability], abilityApi);
    }

    // Units: TWO-PHASE tick, so update order (= spawn order) never decides an even fight.
    //   phase 0  timers, Life Steal ticks, hop / trap / stun run-down (decides who may act this tick)
    //   phase 1  MOVE: targeting + movement for every unit on both sides
    //   phase 2  ACT:  abilities, attacks and cooldowns for every unit, on the post-move positions
    // All unit damage dealt during the tick (attacks, abilities, projectiles, zones, timers, DoT) is
    // buffered and applied at the end (flushHits), so simultaneous attackers both land and deaths
    // resolve together. Statuses (stun, trap, Life Steal stacks) applied in phase 2 take effect from
    // the next tick for everyone, whatever their position in the unit list.
    state.hitBuffer = [];
    try {
      const actors = [];
      // ---- phase 0 ----
      for (const u of state.units) {
        u.act = false;
        if (u.hp <= 0) continue;
        // timers snap to 0 within 1e-9 so float drift never costs an extra tick (1.6 s = exactly 96 ticks at 60 fps)
        u.cooldown = u.cooldown - dt > 1e-9 ? u.cooldown - dt : 0;
        u.abilityCd = u.abilityCd - dt > 1e-9 ? u.abilityCd - dt : 0;
        if (u.endureT > 0 && state.time > u.endureFrom + 1e-9) u.endureT = u.endureT - dt > 1e-9 ? u.endureT - dt : 0;
        u.flash = Math.max(0, u.flash - dt);
        u.castT = Math.max(0, u.castT - dt);
        u.tauntT = Math.max(0, u.tauntT - dt);
        if (u.tauntT <= 0) u.tauntBy = null;
        if (u.burstT > 0) u.burstT = Math.max(0, u.burstT - dt);   // multi-shot burst lock (Nimble Shot)

        if (u.ls.length) updateLifesteal(u);   // DoT ticks even while stunned/trapped (buffered: a lethal tick still lets it act this tick)
        if (u.speedBuffT > 0) { u.speedBuffT = Math.max(0, u.speedBuffT - dt); if (u.speedBuffT <= 0) u.speedBuffMult = 1; }
        if (u.knock) {                 // being knocked back: smooth push (ease-out), no other action meanwhile
          u.knock.t += dt;
          const k = Math.min(1, u.knock.t / u.knock.dur);
          u.x = u.knock.from + (u.knock.to - u.knock.from) * (1 - (1 - k) * (1 - k));
          if (k >= 1) u.knock = null;
          if (u.trapT > 0) u.trapT = Math.max(0, u.trapT - dt);   // other statuses keep running down
          if (u.stun > 0) u.stun = Math.max(0, u.stun - dt);
          u.state = 'knocked';
          continue;
        }
        if (u.charge && (u.stun > 0 || u.trapT > 0)) u.charge = null;   // stunned / trapped mid-charge: stops
        if (u.charge) { u.state = 'charge'; continue; }   // charging: moved in resolveCharges (after this loop)
        if (u.hop) {                   // scripted hop (e.g. Dark Cloud): no other action meanwhile
          u.hop.t += dt;
          const k = Math.min(1, u.hop.t / u.hop.dur);
          u.x = u.hop.from + (u.hop.to - u.hop.from) * k;
          if (k >= 1) u.hop = null;
          continue;
        }
        if (u.trapT > 0) {             // bubble-trapped: floats, can't move, attack or use abilities
          u.trapT = Math.max(0, u.trapT - dt);
          if (u.stun > 0) u.stun = Math.max(0, u.stun - dt);   // both run down together
          u.state = 'trapped';
          continue;
        }
        if (u.stun > 0) { u.stun = Math.max(0, u.stun - dt); u.state = 'stunned'; continue; }
        u.act = true;
        actors.push(u);
      }
      resolveCharges(dt);              // shield charges + knockback starts (order-independent)

      // ---- phase 1: move ----
      // 1a: every unit decides walk / hold from the SAME start-of-tick positions (deciding and moving
      //     in one loop would let the first mover step into range and freeze the opponent a step back).
      for (const u of actors) {
        const target = pickTarget(u);
        const towerInRange = (TOWER_FRONT[foeTeamOf(u)] - u.x) * dirOf(u) <= u.type.rangeGrids;
        // zocHolder: held by a defender it can't reach yet -> it may not walk on
        u.state = target || towerInRange || zocHolder(u) ? 'fight' : u.endureT > 0 ? 'brace' : 'walk';   // Endure: planted
      }
      // 1b: then all walkers move (never through enemies: moveTo).
      for (const u of actors) {
        // Movement in grids: speedGrids (grids/sec) * dt (sec)
        if (u.state === 'walk') moveTo(u, u.x + dirOf(u) * u.type.speedGrids * u.speedBuffMult * dt);
      }

      // ---- phase 2: act ----
      for (const u of actors) {
        if (u.hp <= 0) continue;
        const dir = dirOf(u);
        const foeTeam = foeTeamOf(u);
        // Ability (counts as this cycle's attack). Auto for the AI (and the player when Auto
        // is on); otherwise only when the player queued a manual cast.
        const abId = u.type.ability;
        const offCycle = abId && C.ABILITIES[abId].offCycle;
        if (abId && u.abilityCd <= 0 && (u.cooldown <= 0 || offCycle) && !(u.burstT > 0) && (autoFor(u) || u.castQueued)) {
          const impl = ABILITY_IMPL[abId];
          if (impl && impl.canUse(u, C.ABILITIES[abId], abilityApi)) doCast(u);
          else if (u.castQueued) { u.castQueued = false; noTarget(u); }
          if (u.hop || u.charge) continue;
        }

        const target = pickTarget(u);
        u.target = target;
        const towerInRange = (TOWER_FRONT[foeTeam] - u.x) * dir <= u.type.rangeGrids;
        if (target || towerInRange) {
          u.state = 'fight';
          if (u.cooldown <= 0 && !(u.burstT > 0)) {     // no normal attack starts during a burst
            basicAttack(u, target);
            u.cooldown = u.type.cooldownSec;
          }
        }
      }

      updateProjectiles(dt);
      updateZones();

      // Delayed ability actions (game time)
      if (state.timers.length) {
        const due = state.timers.filter((t) => t.at <= state.time);
        state.timers = state.timers.filter((t) => t.at > state.time);
        for (const t of due) t.fn();
      }
    } finally {
      flushHits();                     // deaths resolve here, after everyone has acted
      if (state.pendingKnocks && state.pendingKnocks.length) applyPendingKnocks();   // Endure knockbacks (after the hits)
    }

    // Visual only: dead units with a death animation leave a corpse that plays it out.
    for (const u of state.units) {
      if (u.hp <= 0 && ART.sprite(u.type.id, u.team, 'walk') && ART.sprite(u.type.id, u.team, 'death')) {
        state.corpses.push({ type: u.type, team: u.team, x: u.x, depth: u.depth, t: 0 });
      }
    }

    // Remove dead units
    state.units = state.units.filter((u) => u.hp > 0);

    // Win / lose
    if (state.towers.enemy.hp <= 0 || state.towers.player.hp <= 0) {
      state.over = true;
      state.winner = state.towers.enemy.hp <= 0 ? 'player' : 'enemy';
      if (!state.sandbox) showOverlay(state.winner);
    }
  }

  /** Visual-only timers (run even after game over so death animations finish). */
  function updateVisuals(dt) {
    for (const c of state.corpses) c.t += dt;
    state.corpses = state.corpses.filter((c) => {
      const spr = ART.sprite(c.type.id, c.team, 'death');
      return spr && c.t < spr.frames / spr.fps;
    });
    for (const e of state.effects) e.t += dt;
    state.effects = state.effects.filter((e) => e.t < e.dur);
    for (const n of state.nums) {
      n.t += dt;
      if (n.anchor.hp > 0) n.x = n.anchor.x;   // follow the unit while it lives (towers don't move)
    }
    state.nums = state.nums.filter((n) => n.t < n.dur);
  }

  function showOverlay(winner) {
    const overlay = document.getElementById('overlay');
    const title = document.getElementById('overlay-title');
    const banner = document.getElementById('overlay-banner');
    const won = winner === 'player';
    title.textContent = won ? 'Victory!' : 'Defeat';
    document.getElementById('overlay-sub').textContent =
      won ? 'The enemy tower has fallen.' : 'Your tower has fallen.';
    const art = ART.ui(won ? 'victory' : 'defeat');
    if (art) {
      banner.src = art.src;
      banner.alt = title.textContent;
      banner.classList.remove('hidden');
      title.classList.add('hidden');
    } else {
      banner.classList.add('hidden');
      title.classList.remove('hidden');
    }
    overlay.classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  function drawBar(x, y, w, h, frac, color) {
    ctx.fillStyle = '#000a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, frac), h);
    ctx.strokeStyle = '#fff8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /**
   * HP bar using an art frame (3-slice: end caps kept at native size, middle stretched).
   * The fill is drawn in code underneath the frame.
   */
  function drawFramedBar(frameImg, x, y, w, h, frac, color) {
    x = Math.round(x); y = Math.round(y);
    const inset = Math.max(1, Math.round(h / 4));
    ctx.fillStyle = '#000a';
    ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    ctx.fillStyle = color;
    ctx.fillRect(x + inset, y + inset, (w - inset * 2) * Math.max(0, Math.min(1, frac)), h - inset * 2);
    const iw = frameImg.width, ih = frameImg.height;
    const cap = Math.min(Math.floor(iw / 2) - 1, Math.max(2, Math.round(ih / 2)));
    const dcap = Math.round(cap * (h / ih));
    if (w <= dcap * 2 + 1) { ctx.drawImage(frameImg, x, y, w, h); return; }
    ctx.drawImage(frameImg, 0, 0, cap, ih, x, y, dcap, h);                                 // left cap
    ctx.drawImage(frameImg, cap, 0, iw - cap * 2, ih, x + dcap, y, w - dcap * 2, h);        // middle
    ctx.drawImage(frameImg, iw - cap, 0, cap, ih, x + w - dcap, y, dcap, h);                // right cap
  }

  // ---------------- Towers ----------------
  function towerArt(team) {
    const t = state.towers[team];
    if (t.hp <= 0) { const d = ART.tower(team, 'destroyed'); if (d) return d; }
    if (t.hp / t.maxHp < AM.TOWER_DAMAGED_BELOW) { const d = ART.tower(team, 'damaged'); if (d) return d; }
    return ART.tower(team, 'normal');
  }

  function drawTower(team) {
    const tw = gridToPx(C.TOWER_WIDTH_GRIDS);
    const x = team === 'player' ? 0 : C.STAGE_WIDTH_PX - tw;
    const tower = state.towers[team];
    const art = towerArt(team);

    if (art) {
      // Sprite: base on the ground line, outer edge flush with the canvas edge so nothing is
      // cropped (art is wider than the gameplay footprint and overhangs it on the inner side).
      const { w, h } = AM.TOWER_SIZE;
      const sx = team === 'player' ? 0 : C.STAGE_WIDTH_PX - w;
      const cx = sx + w / 2;
      const top = C.GROUND_Y_PX - h;
      ctx.drawImage(art, Math.round(sx), top, w, h);

      const barFrame = ART.ui('towerHpbarFrame');
      let barY, barCx;
      if (barFrame) {
        const bw = AM.UI.towerHpbarFrame.w, bh = AM.UI.towerHpbarFrame.h;
        const bx = Math.min(Math.max(cx - bw / 2, 4), C.STAGE_WIDTH_PX - bw - 4);
        barY = top - bh - 8;
        barCx = bx + bw / 2;
        drawFramedBar(barFrame, bx, barY, bw, bh, tower.hp / tower.maxHp, '#6f6');
      } else {
        barY = top - 16;
        barCx = cx;
        drawBar(x + 4, barY, tw - 8, 10, tower.hp / tower.maxHp, '#6f6');
      }
      // Label anchored to the inner side so it never runs off the canvas edge.
      const label = `${TEAM[team].name.toUpperCase()}  ${Math.ceil(tower.hp)}/${tower.maxHp}`;
      ctx.fillStyle = C.COLORS.text;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const half = ctx.measureText(label).width / 2;
      const lx = Math.min(Math.max(barCx, half + 4), C.STAGE_WIDTH_PX - half - 4);
      outlinedText(label, lx, barY - 6);
      return;
    }

    // ---- placeholder tower (original prototype drawing) ----
    const h = 170;
    const y = C.GROUND_Y_PX - h;

    ctx.fillStyle = TEAM[team].color;
    ctx.fillRect(x, y, tw, h);
    // battlements
    ctx.fillStyle = TEAM[team].color;
    for (let i = 0; i < 3; i++) ctx.fillRect(x + i * (tw / 3) + 2, y - 12, tw / 3 - 8, 12);
    // door
    ctx.fillStyle = '#0006';
    const doorX = team === 'player' ? x + tw - 22 : x + 4;
    ctx.fillRect(doorX, C.GROUND_Y_PX - 40, 18, 40);

    // HP bar + number
    const barFrame = ART.ui('towerHpbarFrame');
    if (barFrame) drawFramedBar(barFrame, x + 2, y - 36, tw - 4, 12, tower.hp / tower.maxHp, '#6f6');
    else drawBar(x + 4, y - 34, tw - 8, 10, tower.hp / tower.maxHp, '#6f6');
    ctx.fillStyle = C.COLORS.text;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(tower.hp)}/${tower.maxHp}`, x + tw / 2, y - 40);
    ctx.fillText(TEAM[team].name.toUpperCase(), x + tw / 2, y + 20);
  }

  // ---------------- Characters ----------------
  /** Which sprite strip + frame a unit shows right now, or null -> placeholder drawing. */
  function unitFrame(u) {
    const walk = ART.sprite(u.type.id, u.team, 'walk');
    if (!walk) return null;
    if (u.endureT > 0 && !state.over && !(u.stun > 0) && !(u.trapT > 0)) {   // Endure: 0 lift, 1 slam, then 2-3 braced loop
      const en = ART.sprite(u.type.id, u.team, 'endure');
      if (en) {
        const el = (u.endureDur || 5) - u.endureT;
        const f = el < 0.12 ? 0 : el < 0.3 ? Math.min(1, en.frames - 1) : en.frames >= 4 ? 2 + (Math.floor((el - 0.3) * 4) % 2) : en.frames - 1;
        return { spr: en, frame: f };
      }
    }
    if (state.over || u.state === 'stunned' || u.state === 'trapped' || u.knock) return { spr: walk, frame: 0 };   // idle = walk frame 0 (knocked back: wind-up interrupted)
    if (u.charge) return { spr: walk, frame: Math.floor(state.time * walk.fps * 2.5) % walk.frames };   // charging: fast stride
    if (u.castT > 0) {
      const ab = ART.sprite(u.type.id, u.team, 'ability');
      if (ab) {
        const el = CAST_ANIM_SEC - u.castT;
        return { spr: ab, frame: Math.min(ab.frames - 1, Math.floor(el * ab.fps)) };
      }
    }
    if (u.state === 'fight') {
      const atk = ART.sprite(u.type.id, u.team, 'attack');
      if (!atk) return { spr: walk, frame: 0 };
      // Attack strip plays once per attack, spread over the cooldown.
      // cooldown resets to cooldownSec on the hit and counts down to 0.
      const cd = u.type.cooldownSec;
      const phase = cd > 0 ? Math.min(0.9999, Math.max(0, (cd - u.cooldown) / cd)) : 0;
      // Per-unit hit frame: rotate the strip so frame hitFrame shows when the hit lands
      // (e.g. Brawn: 0-1 wind-up, 2 hit). Default 0 = strip starts on the hit.
      const hf = Math.min(atk.frames - 1, Math.max(0, u.type.hitFrame | 0));
      return { spr: atk, frame: (Math.floor(phase * atk.frames) + hf) % atk.frames };
    }
    const t = Math.max(0, state.time - (u.bornAt || 0));
    return { spr: walk, frame: Math.floor(t * walk.fps) % walk.frames };
  }

  /** Draw one frame with its feet (bottom-centre) at footX, footY. Mirrors for the enemy. */
  function drawSpriteFrame(spr, frame, footX, footY, mirror, flash, glow, tintAlpha) {
    const fw = spr.frameW, fh = spr.frameH;
    const sx = frame * spr.srcW;
    ctx.save();
    ctx.translate(Math.round(footX), Math.round(footY));
    if (mirror) ctx.scale(-1, 1);
    const dx = -Math.round(fw / 2), dy = -fh;
    if (spr.outline) { // fallback when magenta recolour was impossible: team-colour outline
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        ctx.drawImage(spr.outline, sx, 0, spr.srcW, spr.srcH, dx + ox, dy + oy, fw, fh);
      }
    }
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 10 * BLUR; }
    ctx.drawImage(spr.image, sx, 0, spr.srcW, spr.srcH, dx, dy, fw, fh);
    ctx.shadowBlur = 0;
    if (tintAlpha > 0) {           // Life Steal: subtle purple tint
      const tint = purpleOf(spr);
      if (tint) { ctx.globalAlpha = tintAlpha; ctx.drawImage(tint, sx, 0, spr.srcW, spr.srcH, dx, dy, fw, fh); ctx.globalAlpha = 1; }
    }
    if (flash) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(spr.flash, sx, 0, spr.srcW, spr.srcH, dx, dy, fw, fh);
    }
    ctx.restore();
  }

  /** Purple silhouette of a sprite strip (lazy, cached) for the Life Steal tint. */
  const purpleCache = new WeakMap();
  function purpleOf(spr) {
    let c = purpleCache.get(spr);
    if (c === undefined) {
      c = null;
      if (spr.flash && spr.flash.width) {
        c = document.createElement('canvas');
        c.width = spr.flash.width; c.height = spr.flash.height;
        const g = c.getContext('2d');
        g.drawImage(spr.flash, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = '#7b1fa2';
        g.fillRect(0, 0, c.width, c.height);
      }
      purpleCache.set(spr, c);
    }
    return c;
  }

  const LS_COLOR = '#6a1b9a';
  /** Life Steal visuals: rising purple motes + stack badge (droplet + count) beside the HP bar. */
  function drawLifesteal(u, px, footY, h, barRightX, barY) {
    const n = u.ls.length;
    if (!n) return;
    ctx.save();
    for (let i = 0; i < Math.min(4, 1 + Math.floor(n / 2)); i++) {
      const ph = (state.time * 0.7 + i / 3 + u.id * 0.37) % 1;
      const mx = px + Math.sin((i + 1) * 2.3 + u.id) * 9 + Math.sin(state.time * 3 + i) * 2;
      const my = footY - h * 0.15 - ph * h * 0.75;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.fillStyle = i % 2 ? '#ce93d8' : '#8e24aa';
      ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    const ix = Math.round(barRightX + 2), iy = Math.round(barY - 5);
    const icon = ART.fx('fx_lifesteal_mark');
    if (icon) {                    // 9x11 blood drop
      ctx.drawImage(icon.img, 0, 0, icon.srcW, icon.img.height, ix + 1, iy, icon.w, icon.h);
    } else {                       // dark-purple droplet
      ctx.fillStyle = LS_COLOR;
      ctx.strokeStyle = '#e1bee7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ix + 6, iy);
      ctx.bezierCurveTo(ix + 6, iy + 3, ix + 11, iy + 6, ix + 11, iy + 8.5);
      ctx.arc(ix + 6, iy + 8.5, 5, 0, Math.PI, false);
      ctx.bezierCurveTo(ix + 1, iy + 6, ix + 6, iy + 3, ix + 6, iy);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#f3e5f5';
    ctx.strokeText(String(n), ix + 12, iy + 10);
    ctx.fillText(String(n), ix + 12, iy + 10);
    ctx.restore();
  }

  /** Rallying Charge speed buff: small gold double chevron left of the HP bar. */
  function drawSpeedBuff(u, barLeftX, barY) {
    if (!(u.speedBuffT > 0)) return;
    const x = Math.round(barLeftX - 11), y = Math.round(barY - 3);
    const icon = ART.fx('fx_rally_buff');
    ctx.save();
    if (u.speedBuffT < 1) ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(state.time * 8));   // about to expire
    if (icon) {
      ctx.drawImage(icon.img, 0, 0, icon.srcW, icon.img.height, x, y, icon.w, icon.h);
    } else {
      ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1.5;
      for (const ox of [0, 4]) { ctx.beginPath(); ctx.moveTo(x + ox, y + 1); ctx.lineTo(x + ox + 3.5, y + 4.5); ctx.lineTo(x + ox, y + 8); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** Manual mode: glowing marker above a player unit whose ability is ready (click it). */
  function drawReadyIndicator(u, px, y) {
    if (u.team !== 'player' || autoFor(u) || !u.type.ability || u.abilityCd > 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 6);
    ctx.save();
    ctx.shadowColor = '#6fe6ff';
    ctx.shadowBlur = (6 + pulse * 8) * BLUR;
    const spark = ART.ui('ability_ready');
    if (spark) {
      // Mia's 14x14 cyan spark at 1x (integer position keeps the pixels crisp).
      const { w, h } = AM.UI.ability_ready;
      const bob = u.castQueued ? 0 : Math.round(pulse * 2);
      if (u.castQueued) ctx.globalAlpha = 0.6 + 0.4 * pulse;
      ctx.drawImage(spark, Math.round(px - w / 2), Math.round(y - h / 2 - bob), w, h);
    } else {
      // Fallback: cyan dot
      ctx.fillStyle = u.castQueued ? '#e0fbff' : '#6fe6ff';
      ctx.strokeStyle = '#0b3a48';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, y, u.castQueued ? 4 : 5 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  const hopLift = (u) => (u.hop ? Math.sin(Math.PI * Math.min(1, u.hop.t / u.hop.dur)) * 9 : 0);
  const lsTint = (u) => (u.ls.length ? Math.min(0.42, 0.18 + 0.04 * u.ls.length) : 0);

  function drawUnitHpBar(cx, y, w, frac, team) {
    const color = team === 'player' ? '#6cf' : '#f66';
    const frame = ART.ui('hpbarFrame');
    if (frame) drawFramedBar(frame, cx - w / 2, y - 4, w, AM.UI.hpbarFrame.h, frac, color);
    else drawBar(cx - w / 2, y, w, 4, frac, color);
  }

  /** Rarity marker: 1 grey / 2 silver-blue / 3 gold pips above the HP bar (SSR glows). */
  function drawRarityPips(u, cx, y) {
    const r = u.type.rarity;
    const n = r.pips || 1;
    const gap = 6;
    ctx.save();
    if (r.glow) { ctx.shadowColor = r.glow; ctx.shadowBlur = 6 * BLUR; }
    ctx.fillStyle = r.color;
    ctx.strokeStyle = '#000a';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const px = cx + (i - (n - 1) / 2) * gap;
      ctx.beginPath();
      ctx.moveTo(px, y - 3); ctx.lineTo(px + 2.5, y); ctx.lineTo(px, y + 3); ctx.lineTo(px - 2.5, y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  let trapLabelXs = [];   // x positions of TRAPPED labels drawn this frame (reset in render)
  /** STUN / taunt markers above a unit. */
  function drawStatus(u, cx, top) {
    if (u.stun > 0) {
      ctx.save();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff176';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText('STUN', cx, top - 18);
      ctx.fillText('STUN', cx, top - 18);
      // orbiting stars
      for (let i = 0; i < 3; i++) {
        const a = state.time * 6 + (i * Math.PI * 2) / 3;
        ctx.fillRect(cx + Math.cos(a) * 9 - 1.5, top - 6 + Math.sin(a) * 3 - 1.5, 3, 3);
      }
      ctx.restore();
    } else if (u.trapT > 0) {
      ctx.save();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#b3e5fc';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      // one label per bubble clump (several trapped units would stack into an unreadable smear)
      if (!trapLabelXs.some((x) => Math.abs(x - cx) < 46)) {
        trapLabelXs.push(cx);
        ctx.strokeText('TRAPPED', cx, top - 18);
        ctx.fillText('TRAPPED', cx, top - 18);
      }
      ctx.restore();
    } else if (u.tauntT > 0) {
      ctx.save();
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd54f';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText('!', cx, top - 16);
      ctx.fillText('!', cx, top - 16);
      ctx.restore();
    }
  }

  function drawUnitDebug(u, px, top) {
    const dir = dirOf(u);
    const y = C.GROUND_Y_PX + 4 + u.depth / 2;
    ctx.save();
    ctx.fillStyle = '#ff0';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    let label = `g${u.x.toFixed(1)} r${u.type.rangeGrids}g`;
    if (u.type.ability) label += ` ab${u.abilityCd.toFixed(1)}`;
    ctx.fillText(label, px, top - 28);
    // attack range in grids (line + end tick)
    const ex = px + dir * gridToPx(u.type.rangeGrids);
    ctx.strokeStyle = '#ff06';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, y); ctx.lineTo(ex, y);
    ctx.moveTo(ex, y - 3); ctx.lineTo(ex, y + 3);
    ctx.stroke();
    // defender zone of control
    if (u.type.blockGrids > 0) {
      ctx.fillStyle = '#ff980033';
      ctx.fillRect(px - gridToPx(u.type.blockGrids), y + 2, gridToPx(u.type.blockGrids) * 2, 4);
    }
    ctx.restore();
  }

  /** Shield Bash dash trail (Mia's 3-frame 48x32 loop) behind a charging unit, 1x, mirrored for the
   *  right side. Strip art: speed lines + dust trail to the LEFT of a right-facing unit. */
  function drawBashDash(u, px, footY, sprW) {
    const fxa = ART.fx('fx_shield_bash_dash');
    const dir = dirOf(u);
    ctx.save();
    ctx.translate(Math.round(px), Math.round(footY));
    if (dir < 0) ctx.scale(-1, 1);
    // right edge of the trail (art content ends at x ~42 of 48) tucked just behind his back/cape (frame x ~8 of 64)
    const x0 = Math.round(-sprW * (24 / 64)) - 42 + 6;
    if (fxa) {
      const f = Math.floor(state.time * fxa.fps) % fxa.frames;
      ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, x0, -fxa.h, fxa.w, fxa.h);
    } else {                                           // fallback: three speed lines
      ctx.strokeStyle = 'rgba(200,230,255,0.8)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x0 + 8 + i * 6, -28 + i * 8); ctx.lineTo(x0 + 44, -28 + i * 8); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** Endure guard glint (Mia's 32x64 4-frame loop) over Brawn's planted shield face, 1x, mirrored on the right. */
  function drawEndureGuard(u, px, footY, sprW) {
    const fxa = ART.fx('fx_endure_guard');
    const dir = dirOf(u);
    ctx.save();
    ctx.translate(Math.round(px), Math.round(footY));
    if (dir < 0) ctx.scale(-1, 1);
    const sx = Math.round(sprW * (52 / 64) - sprW / 2);   // shield face centre in the braced frames: x ~52 of 64 (shield x 48-56)
    if (fxa) {
      const f = Math.floor(state.time * fxa.fps) % fxa.frames;
      ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, sx - 16, -fxa.h, fxa.w, fxa.h);   // rim centre x 16.5
    } else {
      ctx.strokeStyle = 'rgba(255,206,110,0.7)'; ctx.lineWidth = 2;
      ctx.strokeRect(sx - 6, -60, 12, 58);
    }
    ctx.restore();
  }

  function drawUnit(u) {
    const px = gridToPx(u.x);
    const fr = unitFrame(u);
    const r = u.type.rarity;

    const lift = trapLift(u) + hopLift(u);
    if (u.charge) drawBashDash(u, px, C.GROUND_Y_PX - u.depth - lift, fr ? fr.spr.frameW : u.type.sizePx);
    if (fr) {
      const footY = C.GROUND_Y_PX - u.depth - lift;
      drawSpriteFrame(fr.spr, fr.frame, px, footY, dirOf(u) < 0, u.flash > 0, r.glow, lsTint(u));
      if (u.endureT > 0 && (u.endureDur || 5) - u.endureT >= 0.12) drawEndureGuard(u, px, footY, fr.spr.frameW);
      if (u.trapT > 0) drawBubble(px, footY - fr.spr.frameH * 0.45, fr.spr.frameW * 0.55, 'fx_bubble_trap', state.time);
      const top = footY - fr.spr.frameH;
      const bw = Math.max(24, fr.spr.frameW * 0.75);
      drawUnitHpBar(px, top - 7, bw, u.hp / u.type.hp, u.team);
      drawLifesteal(u, px, footY, fr.spr.frameH, px + bw / 2, top - 7);
      drawSpeedBuff(u, px - bw / 2, top - 7);
      drawRarityPips(u, px, top - 13);
      drawStatus(u, px, top - 8);
      drawReadyIndicator(u, px, top - 26);
      if (state.debug) drawUnitDebug(u, px, top);
      return;
    }

    // ---- placeholder unit: class-coloured square, team outline, class letter ----
    const s = u.type.sizePx;
    const top = C.GROUND_Y_PX - s - u.depth - lift;

    ctx.save();
    if (r.glow) { ctx.shadowColor = r.glow; ctx.shadowBlur = 12 * BLUR; }
    ctx.fillStyle = u.flash > 0 ? '#fff' : u.type.color;
    ctx.fillRect(px - s / 2, top, s, s);
    ctx.restore();
    ctx.strokeStyle = TEAM[u.team].color;
    ctx.lineWidth = 3;
    ctx.strokeRect(px - s / 2, top, s, s);
    // inner rarity border
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(px - s / 2 + 2.5, top + 2.5, s - 5, s - 5);
    if (u.castT > 0) { // ability pose: brief bright overlay
      ctx.fillStyle = `rgba(255,255,255,${(u.castT / CAST_ANIM_SEC) * 0.5})`;
      ctx.fillRect(px - s / 2, top, s, s);
    }

    // facing marker (rangers: a little bow line)
    const dir = dirOf(u);
    ctx.fillStyle = TEAM[u.team].color;
    if (u.type.ranged) {
      ctx.strokeStyle = TEAM[u.team].color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px + dir * (s / 2), top + s / 2, s / 2.5, -Math.PI / 2, Math.PI / 2, dir < 0);
      ctx.stroke();
    } else {
      ctx.fillRect(dir > 0 ? px + s / 2 : px - s / 2 - 4, top + s / 2 - 3, 4, 6);
    }

    // label
    ctx.fillStyle = '#000';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.type.short, px, top + s / 2 + 4);
    if (u.trapT > 0) drawBubble(px, top + s / 2, s * 0.75 + 4, 'fx_bubble_trap', state.time);
    if (u.ls.length) { ctx.save(); ctx.globalAlpha = lsTint(u); ctx.fillStyle = '#7b1fa2'; ctx.fillRect(px - s / 2, top, s, s); ctx.restore(); }

    drawUnitHpBar(px, top - 7, Math.max(s, 18), u.hp / u.type.hp, u.team);
    drawLifesteal(u, px, top + s, s, px + Math.max(s, 18) / 2, top - 7);
    drawSpeedBuff(u, px - Math.max(s, 18) / 2, top - 7);
    drawRarityPips(u, px, top - 13);
    drawStatus(u, px, top - 8);
    drawReadyIndicator(u, px, top - 26);
    if (state.debug) drawUnitDebug(u, px, top);
  }

  function drawCorpse(c) {
    const spr = ART.sprite(c.type.id, c.team, 'death');
    if (!spr) return;
    const frame = Math.min(spr.frames - 1, Math.floor(c.t * spr.fps));
    drawSpriteFrame(spr, frame, gridToPx(c.x), C.GROUND_Y_PX - c.depth, TEAM[c.team].dir < 0, false);
  }

  /** Persistent aura rings (Fortress) drawn on the ground under units. */
  function drawAuras() {
    for (const u of state.units) {
      const A = u.type.ability && C.ABILITIES[u.type.ability];
      if (!A || !A.auraGrids) continue;
      ctx.save();
      ctx.strokeStyle = '#ffd54f66';
      ctx.fillStyle = '#ffd54f14';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(gridToPx(u.x), C.GROUND_Y_PX + 2, gridToPx(A.auraGrids), 7, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Water bubble: sprite (fx key, may be an animated strip of square frames) or a drawn
   * translucent light-blue circle with a highlight.
   */
  function drawBubble(x, y, r, fxKey, age) {
    const fxa = ART.fx(fxKey);
    if (fxa) {
      const f = Math.floor((age || 0) * fxa.fps) % fxa.frames;
      const size = fxa.srcW * Math.max(1, Math.round((r * 4) / fxa.srcW) / 2);   // half-step nearest-neighbour scales (1x, 1.5x, 2x...) stay crisp
      ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, Math.round(x - size / 2), Math.round(y - size / 2), size, size);
      return;
    }
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(129, 212, 250, 0.35)';
    ctx.strokeStyle = 'rgba(225, 245, 254, 0.95)';
    ctx.lineWidth = r > 10 ? 2 : 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';            // highlight
    ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /**
   * Zones (Raven's Dark Cloud). layer 'ground' = area marker under units; 'cloud' = the cloud
   * itself, drawn over units (translucent) so units inside look engulfed.
   */
  function drawZones(layer) {
    for (const z of state.zones) {
      if (z.kind !== 'dark_cloud') continue;
      const age = state.time - z.born, left = z.until - state.time;
      const fade = Math.max(0, Math.min(1, age / 0.3, left / 0.5));
      const cx = gridToPx(z.x), rpx = gridToPx(z.rGrids);
      ctx.save();
      if (layer === 'ground') {
        ctx.globalAlpha = 0.7 * fade;
        ctx.fillStyle = 'rgba(74, 20, 140, 0.28)';
        ctx.strokeStyle = '#9c4dcc';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.ellipse(cx, C.GROUND_Y_PX + 2, rpx, 7, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
        continue;
      }
      const art = ART.fx('fx_dark_cloud');
      const cy = C.GROUND_Y_PX - 30;
      if (art) {                     // ground cloud, scaled to the cloud's diameter (half-steps, >= 1x)
        const f = Math.floor(age * art.fps) % art.frames;
        const sc = Math.max(1, Math.round((rpx * 2 * 2) / art.srcW) / 2);
        const w = art.w * sc, h = art.h * sc;
        ctx.globalAlpha = 0.92 * fade;
        ctx.drawImage(art.img, f * art.srcW, 0, art.srcW, art.img.height,
          Math.round(cx - w / 2), Math.round(C.GROUND_Y_PX + 6 - h), w, h);
        ctx.restore();
        continue;
      }
      // Placeholder: drifting dark puffs + a few falling black feathers.
      const puffs = [[-1, 0.2, 12], [-0.5, -0.35, 14], [0, 0.1, 16], [0.5, -0.3, 14], [1, 0.25, 12], [-0.2, 0.5, 11], [0.3, 0.55, 11]];
      puffs.forEach(([ox, oy, pr], i) => {
        const dx = Math.sin(age * 1.3 + i * 1.7) * 3, dy = Math.cos(age * 1.1 + i) * 2;
        ctx.globalAlpha = (i % 2 ? 0.5 : 0.62) * fade;
        ctx.fillStyle = i % 3 === 0 ? '#1a0b22' : i % 3 === 1 ? '#2e1440' : '#3d1a52';
        ctx.beginPath();
        ctx.arc(cx + ox * rpx + dx, cy + oy * 16 + dy, pr, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 0.35 * fade;           // faint violet rim light
      ctx.strokeStyle = '#b388ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 8, 15, Math.PI * 1.1, Math.PI * 1.75);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {             // feathers
        const ph = (age * 0.45 + i / 3) % 1;
        const fx_ = cx + (i - 1) * rpx * 0.8 + Math.sin(age * 2 + i) * 5;
        const fy = cy + 8 + ph * 34;
        ctx.globalAlpha = (1 - ph) * 0.9 * fade;
        ctx.fillStyle = '#0d0610';
        ctx.save();
        ctx.translate(fx_, fy);
        ctx.rotate(Math.sin(age * 3 + i * 2) * 0.8);
        ctx.beginPath(); ctx.ellipse(0, 0, 1.6, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#5e35b1'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 6); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /** Visual lift for bubble-trapped units (they float). */
  const trapLift = (u) => (u.trapT > 0 ? 7 + Math.sin(state.time * 5 + u.id) * 2 : 0);

  // ---- Arrow projectiles: Mia's fx_arrow.png (16x5, tip at the right edge) + a team-tinted fx_arrow_trail.png ----
  // Integer scale only, no smoothing. ARROW_SCALE 1x = the art's native pixel size, the same density as the 1x units
  // (desktop: 16x5 CSS px; iPhone 13 landscape: ~11x3.4 CSS px = 33x10 device px), about as long as a bow. It reads at
  // 9-10 grids on both (screenshot-arrows.png); 2x made arrows longer than the bows.
  const ARROW_SCALE = 1;
  const ARROW_TRAIL_TINT = 0.45;          // how strongly the white trail takes the shooter's team color (faint)
  const ARROW_TRAIL_ALPHA = 0.8;
  const arrowCache = new Map();           // `${color}|${dir}` -> baked canvas: tinted trail + arrow, tip at the edge
  /** Arrow + trail baked into one small canvas per team color and direction (one drawImage per arrow). */
  function arrowSprite(color, dir) {
    const arrow = ART.fx('fx_arrow');
    if (!arrow) return null;
    const ck = `${color}|${dir}`;
    let c = arrowCache.get(ck);
    if (c) return c;
    const trail = ART.fx('fx_arrow_trail');
    const s = ARROW_SCALE, aw = arrow.w * s, ah = arrow.h * s;
    const tw = trail ? trail.w * s : 0, th = trail ? trail.h * s : 0, overlap = trail ? 2 * s : 0;
    c = document.createElement('canvas');
    c.width = aw + tw - overlap; c.height = Math.max(ah, th);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (dir < 0) { g.translate(c.width, 0); g.scale(-1, 1); }   // mirrored for right-to-left
    if (trail) {
      // tint: white trail, then the team color painted onto its own pixels only (keeps the fade-out alpha)
      const t = document.createElement('canvas');
      t.width = trail.w; t.height = trail.h;
      const tg = t.getContext('2d');
      tg.drawImage(trail.img, 0, 0, trail.srcW, trail.img.height, 0, 0, trail.w, trail.h);
      tg.globalCompositeOperation = 'source-atop';
      tg.globalAlpha = ARROW_TRAIL_TINT;
      tg.fillStyle = color;
      tg.fillRect(0, 0, t.width, t.height);
      g.globalAlpha = ARROW_TRAIL_ALPHA;
      g.drawImage(t, 0, Math.floor((c.height - th) / 2), tw, th);
      g.globalAlpha = 1;
    }
    g.drawImage(arrow.img, 0, 0, arrow.srcW, arrow.img.height, c.width - aw, Math.floor((c.height - ah) / 2), aw, ah);
    c.tipY = Math.floor(c.height / 2);
    arrowCache.set(ck, c);
    return c;
  }
  /** Draws an arrow projectile with the sprite; false if the art is missing (caller draws the old line). */
  function drawArrowSprite(p, x, y, d) {
    if (!ART.fx('fx_arrow')) return false;
    // flight angle from the last drawn position (straight shots: 0); kept while paused
    let ang = p.lastDraw ? p.lastDraw.ang : 0;
    if (p.lastDraw) d = p.lastDraw.d;
    if (p.lastDraw && Math.abs(x - p.lastDraw.x) > 0.01) {
      const dx = x - p.lastDraw.x, dy = y - p.lastDraw.y;
      d = dx < 0 ? -1 : 1;
      ang = Math.atan2(dy, Math.abs(dx));
    }
    p.lastDraw = { x, y, ang, d };
    const spr = arrowSprite(TEAM[p.team].color, d);
    if (!spr) return false;
    const tip = Math.round(x + d * 4), ty = Math.round(y) - spr.tipY;   // tip where the old arrowhead was
    if (Math.abs(ang) <= 0.02) {          // straight flight: plain blit (the common case)
      ctx.drawImage(spr, d > 0 ? tip - spr.width : tip, ty);
      return true;
    }
    ctx.save();                           // angled flight: rotate about the tip
    ctx.translate(tip, Math.round(y));
    ctx.rotate(d > 0 ? ang : -ang);
    ctx.drawImage(spr, d > 0 ? -spr.width : 0, -spr.tipY);
    ctx.restore();
    return true;
  }

  function drawProjectiles() {
    ctx.save();
    for (const p of state.projectiles) {
      const x = gridToPx(p.x);
      let hitH = 20;
      if (p.target) {
        const spr = ART.sprite(p.target.type.id, p.target.team, 'walk');
        hitH = spr ? spr.frameH * 0.45 : p.target.type.sizePx * 0.6;
      }
      let y = C.GROUND_Y_PX - p.depth - hitH;
      const d = p.team === 'player' ? 1 : -1;
      const ps = (C.PROJECTILES && C.PROJECTILES[p.style]) || {};
      if (ps.wobblePx) y += Math.sin((state.time - (p.born || 0)) * ps.wobbleHz * Math.PI * 2) * ps.wobblePx;
      if (p.style === 'bubble') { drawBubble(x, y, ps.radiusPx || 6, 'fx_bubble', state.time - (p.born || 0)); continue; }
      if (p.style === 'bubble_big') {
        const by = C.GROUND_Y_PX - p.depth - 30 + Math.sin((state.time - (p.born || 0)) * 9) * 3;
        drawBubble(x, by, 14, 'fx_bubble_trap', state.time - (p.born || 0));
        continue;
      }
      if (drawArrowSprite(p, x, y, d)) continue;
      ctx.lineCap = 'round';              // fallback (no fx_arrow.png): code-drawn arrow
      ctx.strokeStyle = '#000b';          // dark outline so shots read on bright backgrounds
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - d * 12, y); ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = TEAM[p.team].color;
      ctx.beginPath();
      ctx.moveTo(x + d * 4, y); ctx.lineTo(x - d * 1, y - 3); ctx.lineTo(x - d * 1, y + 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Placeholder ability effects (shapes). k = 0..1 progress. */
  function drawEffect(e) {
    const k = Math.min(1, e.t / e.dur);
    const alpha = 1 - k;
    const midY = C.GROUND_Y_PX - (e.depth || 0) - 14;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.strokeStyle = e.color;
    ctx.fillStyle = e.color;
    switch (e.kind) {
      case 'ring': {   // expanding ground ring, radius in grids
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(gridToPx(e.x), C.GROUND_Y_PX - (e.depth || 0) / 2,
          Math.max(2, gridToPx(e.rGrids) * (0.4 + 0.6 * k)), 10 * (0.4 + 0.6 * k), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'arc': {    // cleave swing in front
        const cx = gridToPx(e.x);
        const r = gridToPx(e.lenGrids);
        ctx.lineWidth = 4;
        ctx.beginPath();
        if (e.dir > 0) ctx.arc(cx, midY, r, -Math.PI / 2.2 + k, Math.PI / 3);
        else ctx.arc(cx, midY, r, Math.PI - Math.PI / 3, Math.PI + Math.PI / 2.2 - k);
        ctx.stroke();
        break;
      }
      case 'dash': {   // speed trail
        const x0 = gridToPx(e.x0), x1 = gridToPx(e.x1);
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = Math.max(0, alpha * (1 - i * 0.25));
          ctx.fillRect(Math.min(x0, x1), midY - 6 + i * 6, Math.abs(x1 - x0), 2);
        }
        break;
      }
      case 'beam': {   // piercing shot line
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.moveTo(gridToPx(e.x0), midY); ctx.lineTo(gridToPx(e.x1), midY);
        ctx.stroke();
        break;
      }
      case 'rain': {   // arrows falling over an area
        const cx = gridToPx(e.x), r = gridToPx(e.rGrids);
        ctx.lineWidth = 2;
        for (let i = 0; i < 12; i++) {
          const ax = cx - r + ((i * 37) % 100) / 100 * 2 * r;
          const ay = C.GROUND_Y_PX - 120 + ((k * 130 + i * 23) % 130);
          ctx.beginPath(); ctx.moveTo(ax, ay - 10); ctx.lineTo(ax, ay); ctx.stroke();
        }
        ctx.globalAlpha = 0.35 * alpha;
        ctx.beginPath();
        ctx.ellipse(cx, C.GROUND_Y_PX + 2, r, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pop': {    // bubble pop: sprite strip or droplets + fading ring
        const cx = gridToPx(e.x), cy = e.big ? C.GROUND_Y_PX - 26 : midY - 6;
        const fxa = ART.fx('fx_bubble_pop');
        if (fxa) {
          ctx.globalAlpha = 1;
          const f = Math.min(fxa.frames - 1, Math.floor(k * fxa.frames));
          const size = e.big ? fxa.srcW * Math.max(1, Math.round((gridToPx(e.rGrids) * 2) / fxa.srcW)) : fxa.srcW;
          ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
          break;
        }
        const R = (e.big ? gridToPx(e.rGrids) : 8) * (0.5 + k);
        ctx.lineWidth = e.big ? 3 : 1.5;
        ctx.strokeStyle = '#e1f5fe';
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#81d4fa';
        const n = e.big ? 12 : 6;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rr = R * 1.25;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, e.big ? 3 : 1.6, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'trapbubble': {   // area marker under the trapped units for the trap duration
        ctx.globalAlpha = 0.5 + 0.2 * Math.sin(e.t * 8);
        ctx.strokeStyle = '#b3e5fc';
        ctx.fillStyle = 'rgba(129, 212, 250, 0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(gridToPx(e.x), C.GROUND_Y_PX + 2, gridToPx(e.rGrids), 7, 0, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'drain': {  // Life Steal: wisp homing from the drained unit back to its source (healer)
        const x0 = gridToPx(e.x0), x1 = gridToPx(e.src ? e.src.x : e.x0);
        const y0 = C.GROUND_Y_PX - (e.depth || 0) - 30, y1 = C.GROUND_Y_PX - ((e.src && e.src.depth) || 0) - 30;
        ctx.globalAlpha = 1;
        const wisp = ART.fx('fx_lifesteal_wisp');
        if (wisp) {
          const q = k * k * (3 - 2 * k);           // ease in/out
          const wx = x0 + (x1 - x0) * q, wy = y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 14;
          const f = Math.floor(e.t * wisp.fps) % wisp.frames;
          ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
          // art travels rightward (trail on its left): mirror when flying leftward
          ctx.translate(Math.round(wx), Math.round(wy));
          if (x1 < x0) ctx.scale(-1, 1);
          ctx.drawImage(wisp.img, f * wisp.srcW, 0, wisp.srcW, wisp.img.height, -Math.round(wisp.w / 2), -Math.round(wisp.h / 2), wisp.w, wisp.h);
          break;
        }
        for (let i = 0; i < 4; i++) {
          const q = Math.min(1, Math.max(0, k * 1.4 - i * 0.12));
          if (q <= 0 || q >= 1) continue;
          ctx.globalAlpha = 0.85 * (1 - q * 0.5);
          ctx.fillStyle = i % 2 ? '#ce93d8' : '#8e24aa';
          ctx.fillRect(Math.round(x0 + (x1 - x0) * q) - 1.5, Math.round(y0 + (y1 - y0) * q - Math.sin(q * Math.PI) * 10) - 1.5, 3, 3);
        }
        break;
      }
      case 'endureslam': {   // Endure: dust at the shield base, once, as the shield lands (after the 0.12 s lift)
        const fxa = ART.fx('fx_endure_slam');
        const u = e.unit;
        const kk = (e.t - (e.delay || 0)) / (e.dur - (e.delay || 0));
        if (!u || kk < 0) break;
        const fr = unitFrame(u), sprW = fr ? fr.spr.frameW : 64;
        ctx.globalAlpha = 1;
        ctx.translate(Math.round(gridToPx(u.x)), C.GROUND_Y_PX - (u.depth || 0));
        if (e.dir < 0) ctx.scale(-1, 1);
        const sx = Math.round(sprW * (52 / 64) - sprW / 2);
        if (fxa) {
          const f = Math.min(fxa.frames - 1, Math.floor(kk * fxa.frames));
          ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, sx - 24, -fxa.h, fxa.w, fxa.h);
        } else {
          ctx.globalAlpha = 1 - kk; ctx.fillStyle = '#a1887f';
          ctx.fillRect(sx - 14 - 8 * kk, -5, 28 + 16 * kk, 5);
        }
        break;
      }
      case 'endureknock': {  // Endure: push ring on the attacker being shoved (art pushes right; mirrored for left)
        const fxa = ART.fx('fx_endure_knock');
        const u = e.unit;
        const x = u ? u.x : e.x;
        const fr = u ? unitFrame(u) : null;
        const sprH = fr ? fr.spr.frameH : 32;
        ctx.globalAlpha = 1;
        ctx.translate(Math.round(gridToPx(x)), C.GROUND_Y_PX - (e.depth || 0) - Math.round(sprH * 0.5));
        if (e.dir < 0) ctx.scale(-1, 1);
        if (fxa) {
          const f = Math.min(fxa.frames - 1, Math.floor(k * fxa.frames));
          ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, -16 - 6, -16, fxa.w, fxa.h);   // ring starts at the hit side
        } else {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffccbc'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(-6 + 12 * k, 0, 10, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        }
        break;
      }
      case 'bashimpact': { // Shield Bash: Mia's 4-frame 48x48 gold burst + shockwave, on the shoved unit,
                           // following it during the push; art pushes RIGHT, mirrored when pushing left
        const fxa = ART.fx('fx_shield_bash_impact');
        const u = e.unit;
        const x = u ? u.x : e.x;
        const fr = u ? unitFrame(u) : null;
        const sprH = fr ? fr.spr.frameH : (u ? u.type.sizePx : 32);
        const cy = C.GROUND_Y_PX - (e.depth || 0) - Math.round(sprH * 0.5);
        ctx.globalAlpha = 1;
        ctx.translate(Math.round(gridToPx(x)), cy);
        if (e.dir < 0) ctx.scale(-1, 1);
        if (fxa) {
          const f = Math.min(fxa.frames - 1, Math.floor(k * fxa.frames));
          // burst centre sits at x ~18, y ~24 of 48 in the art (shockwave to its right): put the burst on the
          // side of the unit that was hit (10 px behind its centre, toward the charger)
          ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, -10 - 18, -24, fxa.w, fxa.h);
        } else {
          ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, 6 + 14 * k, -Math.PI / 2, Math.PI / 2); ctx.stroke();
        }
        break;
      }
      case 'nimble': { // Nimble Shot: Mia's 4-frame strip at Hera's bow, 1x, mirrored when she faces left
        const fxa = ART.fx('fx_nimble_shot');
        const u = e.src;
        if (!fxa || !u) break;                  // no art: no FX (the real arrows are normal projectiles)
        const fr = unitFrame(u);
        const sprW = fr ? fr.spr.frameW : u.type.sizePx, sprH = fr ? fr.spr.frameH : u.type.sizePx;
        const dir = dirOf(u);
        const footY = C.GROUND_Y_PX - u.depth - trapLift(u) - hopLift(u);
        // bow hand in Hera's 64px frames: x ~50 (of 64), arrow line y = 24 -> scaled to the sprite size
        const bx = Math.round(gridToPx(u.x) + dir * (sprW * (50 / 64) - sprW / 2));
        const by = Math.round(footY - sprH + sprH * (24 / 64) - 6);   // fx first-arrow row is y ~6
        const f = Math.min(fxa.frames - 1, Math.floor(k * fxa.frames));
        ctx.globalAlpha = 1;
        ctx.translate(bx, by);
        if (dir < 0) ctx.scale(-1, 1);
        ctx.drawImage(fxa.img, f * fxa.srcW, 0, fxa.srcW, fxa.img.height, 0, 0, fxa.w, fxa.h);
        break;
      }
      case 'rally': {  // Rallying Charge: light gathers into Dia, then a gold ring bursts out to her range
        const sx = gridToPx(e.src ? e.src.x : e.x);
        const cy = C.GROUND_Y_PX - (e.depth || 0) - 30;
        const rpx = gridToPx(e.rGrids);
        const art = ART.fx('fx_rally');
        ctx.globalAlpha = 1;
        if (art && art.frames >= 6) {
          const f = Math.min(5, Math.floor(k * 6));
          // gather frames at 1x around Dia; burst frames scaled (half-steps) to the buff range
          const sc = f < 3 ? 1 : Math.max(1, Math.round((rpx * 2 * 2) / art.srcW) / 2);
          const w = art.w * sc, h = art.h * sc;
          ctx.drawImage(art.img, f * art.srcW, 0, art.srcW, art.img.height, Math.round(sx - w / 2), Math.round(cy - h / 2), w, h);
          break;
        }
        if (k < 0.5) {                           // gather: gold motes converging
          const q = k / 0.5;
          ctx.fillStyle = '#ffe082';
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + q;
            const rr = (1 - q) * 30 + 3;
            ctx.fillRect(Math.round(sx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr * 0.8) - 1, 3, 3);
          }
        } else {                                 // burst: expanding gold ring out to the range
          const q = (k - 0.5) / 0.5;
          ctx.globalAlpha = 1 - q;
          ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(sx, cy + 18, rpx * q, 10 * q + 2, 0, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      }
      case 'text': {   // floating label
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const y = midY - 34 - k * 16;
        ctx.strokeText(e.text, gridToPx(e.x), y);
        ctx.fillText(e.text, gridToPx(e.x), y);
        break;
      }
    }
    ctx.restore();
  }

  /** Floating numbers: digit-sheet glyphs (6x9 cells, 5 px advance) at integer scale; text fallback. */
  const DIGIT_CHARS = '0123456789+-';
  const NUM_FALLBACK = { white: '#ffffff', red: '#ff5252', green: '#69f0ae' };
  function drawDamageNumbers() {
    if (!state.nums.length) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.shadowBlur = 0;
    const rise = DN.risePx != null ? DN.risePx : 12;
    for (const n of state.nums) {
      const v = Math.round(n.value);
      if (v < 1) continue;
      const k = Math.min(1, n.t / n.dur);
      ctx.globalAlpha = k < 0.45 ? 1 : Math.max(0, 1 - (k - 0.45) / 0.55);
      const text = (n.kind === 'green' ? '+' : '') + v;
      const sc = n.scale;
      const bottom = Math.round(n.y - rise * k);   // constant rise speed: numbers never catch up with each other
      const cx = Math.round(gridToPx(n.x)) + n.jitter;
      const sheet = ART.ui('digits_' + n.kind);
      if (sheet) {
        const def = AM.UI['digits_' + n.kind];
        const cw = def.cellW || 6, adv = def.advance || 5, ch = sheet.height;
        const w = ((text.length - 1) * adv + cw) * sc;
        let x = Math.round(cx - w / 2);
        const y = bottom - ch * sc;
        for (const c of text) {
          const gi = DIGIT_CHARS.indexOf(c);
          if (gi >= 0) ctx.drawImage(sheet, gi * cw, 0, cw, ch, x, y, cw * sc, ch * sc);
          x += adv * sc;
        }
      } else {
        ctx.font = `bold ${sc >= 2 ? 15 : 10}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.fillStyle = NUM_FALLBACK[n.kind];
        ctx.strokeText(text, cx, bottom);
        ctx.fillText(text, cx, bottom);
      }
    }
    ctx.restore();
  }

  /** Debug-only grid overlay (key G). The grid is never shown in normal play. */
  function drawGridDebug() {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let g = 0; g <= C.GRID_COUNT; g++) {
      const x = Math.round(gridToPx(g)) + 0.5;
      const major = g % 10 === 0;
      ctx.strokeStyle = major ? '#ff08' : '#ff02';
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, C.STAGE_HEIGHT_PX);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#ff0';
        ctx.fillText(String(g), Math.min(Math.max(x, 8), C.STAGE_WIDTH_PX - 10), 72);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff0';
    ctx.fillText(
      `DEBUG  stage ${C.STAGE_WIDTH_PX}px / grid ${C.GRID_SIZE_PX}px = ${C.GRID_COUNT} grids` +
      `  | towers front at g${TOWER_FRONT.player} & g${TOWER_FRONT.enemy}` +
      `  | units: ${state.units.length}  shots: ${state.projectiles.length}  t=${state.time.toFixed(1)}s` +
      `  | yellow line = range (grids), orange = defender zone`,
      8, C.STAGE_HEIGHT_PX - 8
    );
    ctx.restore();
  }

  /** Text with a dark outline, readable over busy/bright art. */
  function outlinedText(text, x, y) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000c';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
  }

  function drawHud() {
    // Over a background image use outlined text; otherwise plain text.
    const txt = ART.stage('bg') ? outlinedText : (t, x, y) => ctx.fillText(t, x, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.COLORS.text;
    ctx.font = 'bold 16px sans-serif';
    updateApHud();                 // AP counter + pip gauge: DOM overlay (#ap-hud), integer-scaled pixel art
    ctx.textAlign = 'right';
    txt(state.sandbox ? 'Sandbox: enemy AI off' : `Enemy next spawn: ${enemyNextSpawnEta().toFixed(1)}s`, C.STAGE_WIDTH_PX - 12, 26);
  }

  // ---------------- AP HUD (DOM overlay top-left of the stage) ----------------
  // '7 / 10' with Mia's AP crystal, and a gauge of CONFIG.AP.max pips (ui_ap_pip.png strip: filled
  // x0-9, empty x10-19) that fill one per AP; the next pip fills bottom-up in whole art pixels and
  // pulses softly. Drawn as DOM (not on the canvas) so it stays at an exact integer scale even when
  // the canvas is scaled to fit a phone. Missing art -> text ('AP' label, ●○ pips).
  const apHud = document.getElementById('ap-hud');
  let apHudKey = '';
  function apIconHtml(cls) {
    const ic = ART.ui('apIcon');
    return ic ? `<img class="${cls} ap-ic" src="${ic.src}" alt="AP" width="16" height="16" draggable="false">`
              : `<span class="${cls} ap-ic ap-ic-txt">AP</span>`;
  }
  function buildApHud() {
    const help = document.getElementById('help-ap');
    if (help) { const k = C.STAT_STANDARD.apCostByRarity;
      help.textContent = `Action points (AP): start ${C.AP.start}, +${C.AP.perSec} AP/s, max ${C.AP.max}; Common ${k.common} · SR ${k.sr} · SSR ${k.ssr} AP`; }
    if (!apHud) return;
    const pip = ART.ui('apPip');
    apHud.classList.toggle('no-art', !pip);
    if (pip) apHud.style.setProperty('--ap-pip', cssUrl(pip)); else apHud.style.removeProperty('--ap-pip');
    let pips = '';
    for (let i = 0; i < C.AP.max; i++) pips += pip ? '<i class="ap-pip"><i class="ap-fill"></i></i>' : '';
    apHud.innerHTML = `<span class="ap-count">${apIconHtml('ap-hud-ic')}<span class="ap-txt"><b class="ap-num">0</b><span class="ap-max">&thinsp;/&thinsp;${C.AP.max}</span></span></span>` +
      `<span class="ap-pips" aria-hidden="true">${pips}</span>`;
    apHud.title = `Action points: +${C.AP.perSec}/s, max ${C.AP.max}. Common ${C.STAT_STANDARD.apCostByRarity.common} · SR ${C.STAT_STANDARD.apCostByRarity.sr} · SSR ${C.STAT_STANDARD.apCostByRarity.ssr}`;
    apHudKey = '';
  }
  function updateApHud() {
    if (!apHud || !state) return;
    const v = Math.min(C.AP.max, state.resource), whole = apWhole(v);
    const frac = whole >= C.AP.max ? 0 : Math.max(0, v - whole);
    const fillPx = Math.floor(frac * 14);                 // 0..13 art pixels of the next pip
    const key = whole + ':' + fillPx;
    if (key === apHudKey) return;
    apHudKey = key;
    apHud.querySelector('.ap-num').textContent = whole;
    apHud.setAttribute('aria-label', `Action points ${whole} of ${C.AP.max}`);
    apHud.classList.toggle('full', whole >= C.AP.max);
    const pips = apHud.querySelectorAll('.ap-pip');
    if (pips.length) {
      pips.forEach((p, i) => {
        p.classList.toggle('on', i < whole);
        p.classList.toggle('next', i === whole);
        p.firstChild.style.height = i < whole ? '' : i === whole ? `calc(${fillPx}px * var(--ap-s))` : '0px';
      });
    } else {
      apHud.querySelector('.ap-pips').textContent = '●'.repeat(whole) + '○'.repeat(C.AP.max - whole);
    }
  }

  function drawBackground() {
    const bg = ART.stage('bg');
    const far = ART.stage('far');
    // Always clear with the sky colour first (art may have transparent areas).
    ctx.fillStyle = C.COLORS.sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (far) ctx.drawImage(far, 0, 0, AM.STAGE.far.w, AM.STAGE.far.h);
    if (bg) {
      ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = C.COLORS.ground;
      ctx.fillRect(0, C.GROUND_Y_PX, canvas.width, canvas.height - C.GROUND_Y_PX);
    }
  }

  function render() {
    trapLabelXs = [];
    ctx.imageSmoothingEnabled = false;
    drawBackground();

    if (state.debug) drawGridDebug();
    drawTower('player');
    drawTower('enemy');
    drawAuras();
    drawZones('ground');
    state.corpses.forEach(drawCorpse);     // dying units behind the living
    // draw back-row (higher depth) first
    [...state.units].sort((a, b) => b.depth - a.depth).forEach(drawUnit);
    drawZones('cloud');
    drawProjectiles();
    state.effects.forEach(drawEffect);
    drawDamageNumbers();
    drawHud();
    updateButtons();
    updateInfoPanel();
  }

  // ------------------------------------------------------------------
  // UI: spawn bar (9 units grouped by class) + keyboard
  // ------------------------------------------------------------------
  const buttonBar = document.getElementById('buttons');
  let buttons = [];

  function cssUrl(img) { return `url("${img.src.replace(/"/g, '%22')}")`; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Rarity stars (1x art, or a ★ text fallback) for a rarity id. scale = integer draw scale. */
  function starsHtml(rarityId, cls, scale) {
    const r = C.RARITIES[rarityId];
    const n = r.stars || 1;
    const img = ART.ui('stars_' + rarityId);
    const def = AM.UI['stars_' + rarityId];
    const label = `${r.name}: ${n} star${n > 1 ? 's' : ''}`;
    scale = scale || 1;
    return img
      ? `<img class="${cls}" src="${img.src}" width="${def.w * scale}" height="${def.h * scale}" alt="${label}" title="${label}">`
      : `<span class="${cls} stars-ph" style="color:${r.color}" role="img" aria-label="${label}" title="${label}">${'★'.repeat(n)}</span>`;
  }
  /** Class badge (Mia's 20x20 weapon disc at 1x, or a text glyph fallback). */
  const BADGE_GLYPH = { striker: '⚔', defender: '⛨', ranger: '➶' };
  function badgeHtml(classId) {
    const cls = C.CLASSES[classId];
    const img = ART.ui('badge_' + classId);
    const def = AM.UI['badge_' + classId];
    return img
      ? `<img class="cls-badge" src="${img.src}" width="${def.w}" height="${def.h}" alt="${esc(cls.name)}" title="Class: ${esc(cls.name)}">`
      : `<span class="cls-badge badge-ph" style="background:${cls.color}" role="img" aria-label="${esc(cls.name)}" title="Class: ${esc(cls.name)}">${BADGE_GLYPH[classId] || cls.tag[0]}</span>`;
  }
  /** Ability-ready spark (Mia's 14x14 cyan spark, or a cyan dot fallback). */
  function sparkHtml() {
    const img = ART.ui('ability_ready');
    const def = AM.UI.ability_ready;
    return img ? `<img class="spark" src="${img.src}" width="${def.w}" height="${def.h}" alt="">` : `<i class="spark spark-ph"></i>`;
  }
  /** Units of `roster` grouped by rarity (RARITIES order), each in CLASSES order. */
  function rosterByRarity(roster) {
    const classOrder = Object.keys(C.CLASSES);
    return Object.keys(C.RARITIES).map((rid) => ({
      rid, r: C.RARITIES[rid],
      units: roster.filter((t) => t.rarityId === rid).sort((x, y) => classOrder.indexOf(x.classId) - classOrder.indexOf(y.classId)),
    })).filter((g) => g.units.length);
  }

  /**
   * (Re)build the spawn bar: three rarity rows (Common, SR, SSR), each in class order
   * Striker, Defender, Ranger. Uses portrait / rarity frame / class icon / badge / star art
   * when available. On phones the rows collapse into one strip with dividers between groups.
   */
  function buildButtons() {
    buildApHud();                  // AP counter / pips follow CONFIG.AP.max and the art (rebuilt with the buttons)
    buttonBar.innerHTML = '';
    buttons = [];
    // Spawn-button frame (Mia's ui_spawn_frame.png, 256x64, 4 px gold trim + corner sparkles inside 8 px):
    // drawn as a 9-slice border-image around the whole desktop button, slice 8 at 1x (crisp: corners 1:1,
    // edges/fill are flat so stretching them adds no artifacts). Phones keep the plain look (CSS).
    const frameArtImg = ART.ui('button');
    const frameArt = frameArtImg && frameArtImg.naturalWidth >= 2 * frameArtImg.naturalHeight ? frameArtImg : null;
    buttonBar.classList.toggle('has-spawn-frame', !!frameArt);
    if (frameArt) buttonBar.style.setProperty('--spawn-frame', cssUrl(frameArt)); else buttonBar.style.removeProperty('--spawn-frame');
    const fac = C.FACTIONS[C.PLAYER_FACTION];
    const head = document.createElement('div');
    head.className = 'faction-head';
    head.innerHTML = `<span class="fac-swatches">${fac.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` +
      `<b>${esc(fac.name)}</b> <small>vs ${esc(C.FACTIONS[C.ENEMY_FACTION].name)} · unit names are placeholders</small>`;
    buttonBar.appendChild(head);
    rosterByRarity(PLAYER_ROSTER).forEach((g, gi) => {
      const row = document.createElement('div');
      row.className = `rarity-row rar-row-${g.rid}`;
      row.dataset.rarity = g.rid;
      row.style.setProperty('--rar', g.r.color);
      const keys = g.units.map((c) => c.key);
      const capNote = g.r.maxAlive ? ` · max ${g.r.maxAlive} alive at once` : '';
      row.innerHTML =
        (gi ? '<span class="rar-div" aria-hidden="true"></span>' : '') +
        `<div class="rar-head">${starsHtml(g.rid, 'rar-head-stars', 2)}<b>${esc(g.r.name)}</b>` +
        `<small>keys ${keys[0]}–${keys[keys.length - 1]}${g.rid === 'common' ? ' · no ability' : ' · ✦ ability'}${capNote}</small></div>` +
        `<div class="row-units"></div>`;
      const rowUnits = row.querySelector('.row-units');
      for (const c of g.units) {
        const r = c.rarity;
        const cls = c.cls;
        const A = c.ability ? C.ABILITIES[c.ability] : null;
        const cap = rarityCap(c);
        const b = document.createElement('button');
        b.className = `spawn unit rar-${c.rarityId} cls-${c.classId}${A ? ' has-ab' : ''}${cap ? ' has-cap' : ''}`;
        b.dataset.id = c.id;
        b.dataset.key = c.key;
        b.style.setProperty('--rar', r.color);
        b.title = unitTooltip(c);
        b.setAttribute('aria-label', `${c.name}, ${r.name} ${cls.name}, cost ${c.cost} AP, key ${c.key}`);
        const portrait = ART.ui('portrait_' + c.id);
        const rFrame = ART.ui('frame_' + c.rarityId);
        const classIcon = ART.ui('class_' + c.classId);
        const pic = portrait
          ? `<img class="portrait" src="${portrait.src}" width="64" height="64" alt="">`
          : `<span class="portrait ph" style="background:${c.color}">${esc(c.short)}</span>`;
        const frame = rFrame
          ? `<img class="rar-frame" src="${rFrame.src}" width="72" height="72" alt="">`
          : '';
        const tag = classIcon
          ? `<img class="class-icon sm" src="${classIcon.src}" width="24" height="24" alt="">`
          : `<span class="class-tag" style="background:${cls.color}">${cls.tag}</span>`;
        const info =
          `<b>[${c.key}] ${esc(c.name)}</b>` +
          `<span class="tags">${tag}<span class="cls-name">${esc(cls.name)}</span><span class="rar-tag">${r.name}</span><span class="cost" title="${c.cost} AP">${apIconHtml('cost-ap')}${c.cost}</span></span>` +
          `<small>HP ${c.hp} · DMG ${c.damage}/${c.cooldownSec}s · Rng ${c.rangeGrids} g · Spd ${c.speedGrids} g/s</small>` +
          `<small class="ab"${A ? ` title="${esc(A.desc)}"` : ''}>${A ? '✦ ' + esc(A.name) + (c.projectile && c.projectile !== 'arrow' ? ` · ${esc(c.projectile)} shots` : '') : 'No ability'}</small>`;
        b.innerHTML =
          `<span class="pf${rFrame ? ' has-frame' : ''}">${pic}${frame}` +
          starsHtml(c.rarityId, 'pf-stars', 1) +
          badgeHtml(c.classId) +
          (cap ? `<span class="capcount" title="${esc(r.name)} units alive (max ${cap} per side)">0/${cap}</span>` : '') +
          (A ? `<span class="cdbar hidden"><i></i></span><span class="castbtn" role="button" aria-label="Use ${esc(A.name)}" title="Use ${esc(A.name)} (frontmost ready unit) · Shift+${c.key}">${sparkHtml()}</span>` : '') +
          `</span>` +
          `<span class="info">${info}</span>`;
        bindSpawnButton(b, c);
        rowUnits.appendChild(b);
        buttons.push({ b, c, A, cap, bar: b.querySelector('.cdbar'), fill: b.querySelector('.cdbar i'),
          count: b.querySelector('.capcount'), last: '', lastCount: -1 });
      }
      buttonBar.appendChild(row);
    });
    buildEnemyRoster();
  }

  /** Brief "capped" shake on the spawn button(s) of a capped rarity. */
  function flashCapped(t) {
    for (const btn of buttons) {
      if (btn.c.id !== t.id) continue;
      btn.b.classList.remove('cap-flash');
      void btn.b.offsetWidth;   // restart the CSS animation
      btn.b.classList.add('cap-flash');
    }
  }

  /**
   * Spawn button input: tap/click = spawn; tap-and-hold (~0.45 s) = info panel (no spawn);
   * tapping the ✦ spark or the cooldown bar while the ability is ready = cast it for the
   * frontmost ready unit of that slot (manual mode). Buttons are never `disabled` (disabled
   * buttons swallow taps, which would block the info panel / cast badge when you're broke).
   */
  function bindSpawnButton(b, c) {
    let holdTimer = null, held = false, lastType = 'mouse';
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
    b.addEventListener('pointerdown', (e) => {
      held = false;
      lastType = e.pointerType || 'mouse';
      if (e.button > 0) return;
      cancelHold();
      holdTimer = setTimeout(() => { held = true; openInfo({ type: c }); }, 450);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, cancelHold);
    // Desktop: right-click = info panel. Touch long-press is handled by the hold timer above
    // (the browser's own long-press contextmenu is just suppressed: no callout / menu).
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (lastType === 'mouse' && !held) { cancelHold(); openInfo({ type: c }); }
    });
    b.addEventListener('click', (e) => {
      if (held) { held = false; e.preventDefault(); return; }
      const castHit = e.target.closest && e.target.closest('.castbtn, .cdbar');
      if (castHit && b.classList.contains('can-cast')) { castBySlot(c.key); return; }
      playerSpawn(c.id);
    });
  }

  // ---------------- Unit info panel (shared: menu portraits + battlefield units) ----------------
  // Opened by: right-click / long-press on a spawn button (type mode), or a tap on a battlefield
  // unit whose ability isn't ready / enemy unit, or long-press / right-click on any unit (live mode).
  // The game keeps running underneath; live mode refreshes HP, statuses and cooldown ~10x/s.
  const infoPanel = document.getElementById('info-panel');
  const ipBox = infoPanel ? infoPanel.querySelector('.ip-box') : null;
  let info = null;   // { type, unit|null, lastKey }
  const STAT_GLYPH = { hp: '♥', damage: '⚔', atkspeed: 'ϟ', movespeed: '»', range: '◎', cooldown: '⌛' };
  const fmt = (n, d) => { const v = +(+n).toFixed(d == null ? 2 : d); return String(v); };
  const pct = (m) => `${fmt(m * 100, 0)}%`;
  function statIcon(id) {
    const img = ART.ui('stat_' + id);
    return img ? `<img class="ip-ic" src="${img.src}" width="24" height="24" alt="">`
               : `<span class="ip-ic ip-ic-ph" aria-hidden="true">${STAT_GLYPH[id] || '•'}</span>`;
  }
  const statRow = (id, label, value, extra) =>
    `<div class="ip-stat" data-stat="${id}">${statIcon(id)}<span class="ip-lbl">${label}</span><span class="ip-val">${value}</span>${extra ? `<small>${extra}</small>` : ''}</div>`;
  /** Seconds per attack is the primary unit everywhere (attacks/s in brackets). */
  const atkSpeedText = (cd) => `${fmt(cd)} s / attack <small>(${fmt(1 / cd)}/s)</small>`;

  /** Concrete ability numbers, computed from CONFIG (never hardcoded text). */
  function abilityDetails(t, A) {
    const dmg = (m) => `${Math.round(t.damage * m)} dmg (${pct(m)})`;
    const g = (n) => `${fmt(n)} grid${n === 1 ? '' : 's'}`;
    const L = [];
    switch (t.ability) {
      case 'cleave': L.push(`Hits every enemy up to ${g(A.areaGrids)} in front`, `${dmg(A.damageMult)} each`); break;
      case 'dark_cloud': {
        const S = C.STATUSES.lifesteal;
        L.push(`Cloud ${g(A.offsetGrids)} in front, radius ${g(A.radiusGrids)}, lasts ${fmt(A.durationSec)} s`,
          `+${A.stacksOnEnter} ${S.name} stack to each enemy inside / walking in (once per cloud)`,
          `${S.name}: ${fmt(S.hpPerStackPerSec)} HP/s per stack for ${fmt(S.durationSec)} s (${fmt(S.hpPerStackPerSec * S.durationSec)} HP)${S.trueDamage ? ', true damage' : ''}${S.healSource ? ', heals her' : ''}`,
          `Then she hops back ${g(A.hopBackGrids)} · casts when an enemy is within ${g(A.triggerGrids)}`);
        break;
      }
      case 'rallying_charge':
        L.push(`Allies within ${g(A.rangeGrids)} on each side of her (incl. herself)`,
          `+${pct(A.speedBonus)} move speed for ${fmt(A.buffSec)} s (doesn't stack; re-cast refreshes)`);
        break;
      case 'dash_strike':
        L.push(`Dashes up to ${g(A.dashMaxGrids)} to an enemy within ${g(A.triggerGrids)}`,
          `${dmg(A.damageMult)} to it, ${dmg(A.damageMult * A.splashMult)} to enemies within ${g(A.splashGrids)}`);
        break;
      case 'shield_bash': L.push(`${dmg(A.damageMult)} + stun ${fmt(A.stunSec)} s`); break;
      case 'endure':
        L.push(`Plants his shield for ${fmt(A.durationSec)} s: no walking, keeps attacking whatever is in range`,
          `Takes ${pct(A.damageReduction)} less damage meanwhile (not true damage, e.g. Life Steal ticks)`,
          `Every enemy whose attack hits him (melee or arrow) is knocked back ${g(A.knockbackGrids)}${A.interruptsAttack !== false ? ', attack interrupted' : ''}`,
          `Casts when an enemy is within ${g(t.rangeGrids)} · towers and CC-immune units aren't moved`);
        break;
      case 'grey_shield_bash':
        L.push(`Charges forward up to ${g(A.chargeGrids)} (${fmt(A.chargeSpeedGrids)} grids/s), stops early at the enemy tower`,
          `Every enemy he runs into: knocked back ${g(A.knockbackGrids)} (once per charge)${A.interruptsAttack !== false ? ', attack interrupted' : ''}` +
            (A.damagePct > 0 ? ` · ${Math.round(t.damage * A.damagePct / 100)} dmg (${fmt(A.damagePct)}%)` : ''),
          `Casts when an enemy is within ${g(A.triggerGrids)} in front · towers and CC-immune units aren't moved`);
        break;
      case 'fortress':
        L.push(`Aura: allies within ${g(A.auraGrids)} take ${pct(A.allyDamageReduction)} less damage`,
          `Taunt: enemies within ${g(A.tauntGrids)} must attack it for ${fmt(A.tauntSec)} s`);
        break;
      case 'piercing_shot': L.push(`Bolt through every enemy in a line up to ${g(t.rangeGrids)}`, `${dmg(A.damageMult)} each`); break;
      case 'bubble_trap':
        L.push(`Bubble (${fmt(A.bubbleSpeedGrids)} grids/s) at the most crowded spot in range`,
          `Traps enemies within ${g(A.trapRadiusGrids)} for ${fmt(A.trapSec)} s (can't move or attack)`,
          `Then pops: ${dmg(A.popDamageMult)} to enemies within ${g(A.popRadiusGrids)}`);
        break;
      case 'nimble_shot': {
        const n = A.arrows || 2, per = Math.round(t.damage * A.damageMult);
        L.push(`${n} arrows × ${per} dmg = ${n * per} burst (${pct(A.damageMult)} each, normal hits)`,
          `${fmt(A.gapSec)} s apart, at her current target (next enemy in range if it falls)`,
          `Extra burst: doesn't reset her attack timer · casts when an enemy is within ${g(t.rangeGrids)}`);
        break;
      }
      case 'arrow_rain': L.push(`${dmg(A.damageMult)} to every enemy within ${g(A.radiusGrids)} of the most crowded spot in range`); break;
      default:
        for (const [k, v] of Object.entries(A)) if (typeof v === 'number' && !/cooldown/i.test(k)) L.push(`${k}: ${fmt(v)}`);
    }
    return L;
  }

  function portraitHtml(t) {
    const small = ART.ui('portrait_' + t.id);
    const fb = small ? small.src : '';
    const big = AM.LARGE_PORTRAIT ? AM.LARGE_PORTRAIT(t.art || t.id) : '';
    // Large 512px portrait (lazy); on error fall back to the 64px spawn portrait, then a placeholder.
    return `<span class="ip-pf" style="--rar:${t.rarity.color};background:${t.color}">` +
      (big || fb ? `<img class="ip-portrait" src="${esc(big || fb)}" alt="" data-fb="${esc(fb)}">` : '') +
      `<span class="ip-pf-ph" aria-hidden="true">${esc(t.short)}</span></span>`;
  }

  function buildInfoHtml(t, u) {
    const A = t.ability ? C.ABILITIES[t.ability] : null;
    const fac = t.faction;
    const team = u ? u.team : null;
    const spd = t.speedGrids;
    const sideTag = u ? `<span class="ip-live-tag ${team}">${team === 'player' ? 'YOUR UNIT' : 'ENEMY'} · LIVE</span>` : '';
    let h = `<button class="ip-close" type="button" aria-label="Close">✕</button>` +
      `<div class="ip-head">${portraitHtml(t)}<div class="ip-headtxt">` +
      `<div class="ip-name"><b id="ip-name">${esc(t.name)}</b></div>` +
      `<div class="ip-tags">${starsHtml(t.rarityId, 'ip-stars', 2)}<span class="ip-rar" style="color:${t.rarity.color}">${esc(t.rarity.name)}</span>` +
      `<span class="ip-cls">${badgeHtml(t.classId)}${esc(t.cls.name)}</span></div>` +
      `<div class="ip-fac"><span class="fac-swatches">${fac.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>${esc(fac.name)} ${sideTag}</div>` +
      `</div></div>` +
      (t.flavor ? `<p class="ip-flavor">“${esc(t.flavor)}”</p>` : '') +
      (t.bio ? `<p class="ip-bio">${esc(t.bio)}</p>` : '');
    const traits = [];
    if (t.armor) traits.push(`Armor ${pct(t.armor)}`);
    if (t.blockGrids) traits.push(`Zone of control ${fmt(t.blockGrids)} grids (enemies must stop and fight it)`);
    if (t.ranged) traits.push(`Ranged: ${t.projectile && t.projectile !== 'arrow' ? esc(t.projectile) + ' ' : ''}projectiles${t.projectile && C.PROJECTILES[t.projectile] && C.PROJECTILES[t.projectile].speedGrids ? ` (${fmt(C.PROJECTILES[t.projectile].speedGrids)} grids/s)` : ''}`);
    if (t.onHit && t.onHit.lifesteal) {
      const S = C.STATUSES.lifesteal;
      traits.push(`Each hit: +${t.onHit.lifesteal} ${S.name} (${fmt(S.hpPerStackPerSec)} HP/s per stack for ${fmt(S.durationSec)} s = ${fmt(S.hpPerStackPerSec * S.durationSec)} HP${S.trueDamage ? ', true damage' : ''}${S.healSource ? ', heals ' + (/placeholder/i.test(t.name) ? 'the attacker' : esc(t.name)) : ''})`);
    }
    if (t.rarity.maxAlive) traits.push(`Max ${t.rarity.maxAlive} ${esc(t.rarity.name)} units alive per side`);
    h += `<div class="ip-stats">` +
      statRow('hp', 'HP', `<span class="ip-hp">${u ? `${Math.ceil(Math.max(0, u.hp))} / ${t.hp}` : t.hp}</span>`) +
      statRow('damage', 'Damage', `${t.damage} / hit`, `${fmt(t.damage / t.cooldownSec, 1)} DPS`) +
      statRow('atkspeed', 'Attack', atkSpeedText(t.cooldownSec)) +
      statRow('movespeed', 'Move', `<span class="ip-spd">${fmt(spd)} grids/s</span>`) +
      statRow('range', 'Range', `${fmt(t.rangeGrids)} grids`) +
      `<div class="ip-stat" data-stat="cost"><span class="ip-ic ip-ap-box" aria-hidden="true">${apIconHtml('ip-ap-ic')}</span><span class="ip-lbl">Cost</span><span class="ip-val">${t.cost} AP</span></div>` +
      `</div>` +
      (traits.length ? `<ul class="ip-traits">${traits.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
    if (A) {
      h += `<div class="ip-ab"><div class="ip-ab-head"><span class="ip-ab-name">✦ ${esc(A.name)}</span>` +
        `<span class="ip-cd">${statIcon('cooldown')}${fmt(A.cooldownSec)} s cooldown <small>(first after ${fmt(A.firstCooldownSec != null ? A.firstCooldownSec : A.cooldownSec)} s)</small></span></div>` +
        `<ul class="ip-ab-list">${abilityDetails(t, A).map((x) => `<li>${x}</li>`).join('')}</ul>` +
        `<p class="ip-ab-desc">${esc(A.desc)}</p>` +
        (u ? `<div class="ip-ready"></div>` : '') + `</div>`;
    } else {
      h += `<div class="ip-ab none">No special ability (${esc(t.rarity.name)}).</div>`;
    }
    if (u) h += `<div class="ip-status"></div>`;
    else h += `<small class="ip-hint">Tap / click spawns · press and hold or right-click for this panel</small>`;
    return h;
  }

  /** Live part: HP, move speed (buffs), statuses, ability ready / cooldown. */
  function refreshInfoLive(force) {
    if (!info || !info.unit) return;
    const u = info.unit, t = u.type;
    const alive = u.hp > 0 && state.units.includes(u);
    const A = t.ability ? C.ABILITIES[t.ability] : null;
    const st = [];
    if (!alive) st.push('<b class="bad">Defeated</b>');
    else {
      if (u.ls.length) {
        const left = Math.max(...u.ls.map((x) => x.until)) - state.time;
        st.push(`<span class="s-ls">${C.STATUSES.lifesteal.name} ×${u.ls.length}</span> <small>(−${fmt(u.ls.length * C.STATUSES.lifesteal.hpPerStackPerSec)} HP/s, ${fmt(Math.max(0, left), 1)} s)</small>`);
      }
      if (u.speedBuffT > 0) st.push(`<span class="s-buff">Speed +${pct(u.speedBuffMult - 1)}</span> <small>(${fmt(u.speedBuffT, 1)} s)</small>`);
      if (u.stun > 0) st.push(`<span class="s-cc">Stunned</span> <small>(${fmt(u.stun, 1)} s)</small>`);
      if (u.trapT > 0) st.push(`<span class="s-cc">Trapped</span> <small>(${fmt(u.trapT, 1)} s)</small>`);
      if (u.tauntT > 0 && u.tauntBy) st.push(`<span class="s-cc">Taunted</span> <small>(${fmt(u.tauntT, 1)} s)</small>`);
      if (u.endureT > 0) st.push(`<span class="s-buff">Endure</span> <small>(${fmt(u.endureT, 1)} s, −${pct(u.endureDR || 0)} damage)</small>`);
      if (u.dmgTakenMult < 1) st.push(`<span class="s-buff">Damage taken −${pct(1 - u.dmgTakenMult)}</span> <small>(aura)</small>`);
    }
    const ready = alive && A && u.abilityCd <= 0;
    const auto = A && autoFor(u);
    const key = [Math.ceil(u.hp), st.join(''), A ? (ready ? 'R' + (auto ? 'a' : 'm') : fmt(u.abilityCd, 1)) : '', u.speedBuffMult].join('|');
    if (!force && key === info.lastKey) return;
    info.lastKey = key;
    const hpEl = ipBox.querySelector('.ip-hp');
    if (hpEl) {
      hpEl.textContent = `${Math.ceil(Math.max(0, u.hp))} / ${t.hp}`;
      const f = Math.max(0, u.hp) / t.hp;
      hpEl.className = 'ip-hp' + (f < 0.3 ? ' low' : f < 0.6 ? ' mid' : '');
    }
    const spdEl = ipBox.querySelector('.ip-spd');
    if (spdEl) spdEl.innerHTML = alive && u.speedBuffT > 0 ? `${fmt(t.speedGrids * u.speedBuffMult)} grids/s <small>(+${pct(u.speedBuffMult - 1)})</small>` : `${fmt(t.speedGrids)} grids/s`;
    const rd = ipBox.querySelector('.ip-ready');
    if (rd) {
      rd.className = 'ip-ready' + (ready ? ' ok' : '');
      rd.innerHTML = !alive ? '' : ready
        ? `${sparkHtml()} Ready${u.team === 'player' ? (auto ? ' (auto-casts)' : ' · tap the unit or Shift+' + esc(t.key) + ' to cast') : ' (enemy AI auto-casts)'}`
        : `${statIcon('cooldown')} Cooldown: ${fmt(Math.max(0, u.abilityCd), 1)} s left`;
    }
    const sEl = ipBox.querySelector('.ip-status');
    if (sEl) sEl.innerHTML = `<span class="ip-lbl">Status</span> ${st.length ? st.join(' · ') : '<small>none</small>'}`;
  }

  /** Open the shared info panel. opts: { type } (menu) or { unit } (battlefield, live). */
  function openInfo(opts) {
    if (!infoPanel) return;
    const u = opts.unit || null;
    const t = u ? u.type : opts.type;
    if (!t) return;
    info = { type: t, unit: u, lastKey: '' };
    ipBox.innerHTML = buildInfoHtml(t, u);
    ipBox.style.setProperty('--rar', t.rarity.color);
    ipBox.classList.toggle('live', !!u);
    const img = ipBox.querySelector('.ip-portrait');
    if (img) {
      img.addEventListener('error', () => {
        const fb = img.dataset.fb;
        if (fb && img.getAttribute('src') !== fb) img.src = fb; else img.remove();
      });
    }
    ipBox.querySelector('.ip-close').addEventListener('click', closeInfo);
    infoPanel.classList.remove('hidden');
    ipBox.scrollTop = 0;
    refreshInfoLive(true);
  }
  function closeInfo() {
    if (!infoPanel) return;
    infoPanel.classList.add('hidden');
    info = null;
  }
  const infoOpen = () => !!info && infoPanel && !infoPanel.classList.contains('hidden');
  // Back-compat name (older code / console snippets)
  const showInfo = (c) => openInfo({ type: c });
  let infoRefreshT = 0;
  function updateInfoPanel() {
    if (!infoOpen() || !info.unit) return;
    const now = performance.now();
    if (now - infoRefreshT < 100) return;
    infoRefreshT = now;
    refreshInfoLive(false);
  }
  if (infoPanel) {
    // Tap outside the box closes it (the tap doesn't reach the game below). Lifting the finger
    // from the opening hold is a pointerup, so it doesn't close it. Taps inside (scrolling) don't close.
    infoPanel.addEventListener('pointerdown', (e) => {
      if (ipBox.contains(e.target)) return;
      e.preventDefault();
      closeInfo();
    });
    infoPanel.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Tooltip text for a unit: name, faction/rarity/class, ability name + description, bio. */
  function unitTooltip(c) {
    const A = c.ability ? C.ABILITIES[c.ability] : null;
    return `${c.name} · ${c.faction.name} ${c.rarity.name} ${c.cls.name}\n` +
      `HP ${c.hp} · DMG ${c.damage}/${c.cooldownSec}s · Range ${c.rangeGrids} grids · Cost ${c.cost} AP\n` +
      (A ? `✦ ${A.name}: ${A.desc}` : 'Common: no special ability.') +
      (c.rarity.maxAlive ? `\nMax ${c.rarity.maxAlive} ${c.rarity.name} units alive at once per side.` : '') +
      (c.onHit && c.onHit.lifesteal ? `\nOn hit: +${c.onHit.lifesteal} ${C.STATUSES.lifesteal.name} (${C.STATUSES.lifesteal.desc})` : '') +
      (c.projectile && c.projectile !== 'arrow' ? `\nAttack: ${c.projectile} projectiles` : '') +
      (c.bio ? `\n${c.bio}` : '') +
      `\n(Right-click or press and hold for full details)`;
  }

  /** Read-only strip of the enemy faction's roster (hover for abilities), grouped by rarity. */
  function buildEnemyRoster() {
    let el = document.getElementById('enemy-roster');
    if (!el) {
      el = document.createElement('div');
      el.id = 'enemy-roster';
      buttonBar.parentNode.insertBefore(el, buttonBar.nextSibling);
    }
    const fac = C.FACTIONS[C.ENEMY_FACTION];
    el.innerHTML = `<span class="er-head">Enemy: <b>${esc(fac.name)}</b></span>` + rosterByRarity(ENEMY_ROSTER).map((g) =>
      `<span class="er-group" data-rarity="${g.rid}" style="--rar:${g.r.color}"><span class="er-ghead">${starsHtml(g.rid, 'er-stars', 1)}</span>` +
      g.units.map((c) => {
        const A = c.ability ? C.ABILITIES[c.ability] : null;
        const portrait = ART.ui('portrait_' + c.id);
        const pic = portrait ? `<img src="${portrait.src}" width="32" height="32" alt="">`
                             : `<span class="er-ph" style="background:${c.color}">${esc(c.short)}</span>`;
        return `<span class="er-unit rar-${c.rarityId}" style="--rar:${c.rarity.color}" data-id="${c.id}" title="${esc(unitTooltip(c))}">` +
          `<span class="er-pf">${pic}${badgeHtml(c.classId)}</span>` +
          `<span><b>${esc(c.name)}</b><small>${A ? '✦ ' + esc(A.name) : c.rarity.name + ' ' + esc(c.cls.name)}</small></span></span>`;
      }).join('') + `</span>`
    ).join('');
  }

  function applyRestartArt() {
    const btn = document.getElementById('restart');
    const art = ART.ui('restart');
    if (!art) return;
    btn.classList.add('has-art');
    btn.setAttribute('aria-label', 'Restart');
    btn.innerHTML = `<img src="${art.src}" width="${AM.UI.restart.w}" height="${AM.UI.restart.h}" alt="Restart">`;
  }

  function updateButtons() {
    for (const btn of buttons) {
      const { b, c, A } = btn;
      let capped = false;
      if (btn.cap) {
        const n = aliveOfRarity('player', c.rarityId);
        capped = n >= btn.cap;
        if (n !== btn.lastCount) {
          btn.lastCount = n;
          btn.count.textContent = `${n}/${btn.cap}`;
          btn.count.classList.toggle('full', capped);
          b.classList.toggle('capped', capped);
          b.title = unitTooltip(c) + (capped ? `\n${capMsg(c)} alive: wait for one to fall.` : '');
        }
      }
      const dis = state.over || capped || !canAfford(state.resource, c.cost);
      // Class only (not `disabled` / aria-disabled): an unaffordable / capped button still takes
      // the long-press info and the ✦ cast tap; playerSpawn() itself refuses when it can't spawn.
      if (btn.dis !== dis) { btn.dis = dis; b.classList.toggle('disabled', dis); }
      if (!btn.bar) continue;
      // Ability cooldown of the frontmost living unit of this type (hidden if none on the field).
      let front = null;
      for (const u of state.units) if (u.team === 'player' && u.type.id === c.id && u.hp > 0 && (!front || u.x > front.x)) front = u;
      const ready = front && front.abilityCd <= 0;
      const key = !front ? 'none' : ready ? (autoFor(front) ? 'ready-auto' : 'ready') : 'cd' + Math.round((1 - front.abilityCd / A.cooldownSec) * 50);
      if (key === btn.last) continue;
      btn.last = key;
      btn.bar.classList.toggle('hidden', !front);
      btn.bar.classList.toggle('ready', !!ready);
      btn.bar.classList.toggle('manual', !!ready && key === 'ready');
      b.classList.toggle('can-cast', !!ready && key === 'ready');
      if (front) btn.fill.style.width = (ready ? 100 : Math.round((1 - front.abilityCd / A.cooldownSec) * 100)) + '%';
      btn.bar.title = !front ? '' : ready ? (key === 'ready' ? `${A.name} ready: click the glowing unit or press Shift+${c.key}` : `${A.name} ready (auto)`) : `${A.name}: ${front.abilityCd.toFixed(1)} s`;
    }
  }

  // ---------------- HUD controls: Auto toggle + side swap ----------------
  const autoBtn = document.getElementById('auto-btn');
  const swapBtn = document.getElementById('swap-btn');
  const swapOverlayBtn = document.getElementById('swap-overlay');
  const numsBtn = document.getElementById('nums-btn');
  if (numsBtn) numsBtn.addEventListener('click', (e) => { setShowNums(!showNums); e.currentTarget.blur(); });
  function setAuto(on) {
    autoCast = !!on;
    refreshHudControls();
  }
  function refreshHudControls() {
    if (autoBtn) {
      autoBtn.textContent = `AUTO: ${autoCast ? 'ON' : 'OFF'}`;
      autoBtn.classList.toggle('on', autoCast);
      autoBtn.title = autoCast ? 'Your units cast abilities automatically (A to switch to manual)'
        : 'Manual: click a glowing unit or press Shift+1..9 to use its ability (A to turn Auto on)';
    }
    if (numsBtn) {
      numsBtn.classList.toggle('on', showNums);
      numsBtn.setAttribute('aria-pressed', showNums ? 'true' : 'false');
      numsBtn.title = `Damage numbers: ${showNums ? 'on' : 'off'} (N)`;
    }
    const other = C.FACTIONS[C.ENEMY_FACTION].name;
    if (swapBtn) { swapBtn.innerHTML = `⇄ <span class="long">Play as </span>${esc(other)}`; swapBtn.title = `Swap sides (F): you play ${other}. Restarts the match.`; }
    if (swapOverlayBtn) swapOverlayBtn.textContent = `⇄ Play as ${other}`;
  }
  /** Swap which faction the player controls (player stays on the left) and restart. */
  function swapSides() {
    const p = C.PLAYER_FACTION;
    C.PLAYER_FACTION = C.ENEMY_FACTION;
    C.ENEMY_FACTION = p;
    refreshRosters();
    try {
      const url = new URL(location.href);
      url.searchParams.set('side', C.PLAYER_FACTION);
      history.replaceState(null, '', url.toString());
    } catch (e) { /* file:// or sandboxed: fine, the swap still works */ }
    buildButtons();
    newGame();
    refreshHudControls();
  }
  if (autoBtn) autoBtn.addEventListener('click', (e) => { setAuto(!autoCast); e.currentTarget.blur(); });
  if (swapBtn) swapBtn.addEventListener('click', (e) => { swapSides(); e.currentTarget.blur(); });
  if (swapOverlayBtn) swapOverlayBtn.addEventListener('click', () => swapSides());

  // Touch-friendly buttons for things that are keyboard-only on desktop.
  const restartBtn = document.getElementById('restart-btn');
  const debugBtn = document.getElementById('debug-btn');
  const fsBtn = document.getElementById('fs-btn');
  if (restartBtn) restartBtn.addEventListener('click', (e) => { newGame(); e.currentTarget.blur(); });
  // Menu button (desktop + phone control rows): pause and open the main menu.
  const menuBtn = document.getElementById('menu-btn');
  const menuOverlayBtn = document.getElementById('menu-overlay');   // on the victory / defeat overlay
  function openMenu(e) {
    if (e && e.currentTarget) e.currentTarget.blur();
    if (!menuPresent()) return;
    closeInfo();
    if (window.Game.started) window.Game.pause();
    window.Menu.show();
  }
  if (menuBtn) menuBtn.addEventListener('click', openMenu);
  if (menuOverlayBtn) menuOverlayBtn.addEventListener('click', openMenu);
  if (debugBtn) debugBtn.addEventListener('click', (e) => { state.debug = !state.debug; debugBtn.classList.toggle('on', state.debug); e.currentTarget.blur(); });
  // Fullscreen (Android/desktop; iPhone Safari has no element fullscreen -> button stays hidden,
  // use "Add to Home Screen" there, which launches fullscreen via the apple-mobile-web-app tags).
  const root = document.documentElement;
  const fsSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen) && (document.fullscreenEnabled || document.webkitFullscreenEnabled);
  if (fsBtn && fsSupported) {
    fsBtn.classList.remove('hidden');
    fsBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (err) { /* user/browser refused: ignore */ }
    });
  }
  const rotateHint = document.getElementById('rotate-hint');
  if (rotateHint) rotateHint.querySelector('button').addEventListener('click', () => rotateHint.classList.add('dismissed'));
  // Web app manifest (home-screen install). Only over http(s): from file:// browsers reject it noisily.
  if (/^https?:$/.test(location.protocol) && !document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement('link');
    l.rel = 'manifest'; l.href = 'manifest.webmanifest';
    document.head.appendChild(l);
  }

  // ---------------- Battlefield click / tap: manual ability ----------------
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - canvas.clientLeft) * (canvas.width / canvas.clientWidth),
      y: (e.clientY - rect.top - canvas.clientTop) * (canvas.height / canvas.clientHeight),
    };
  }
  /** Hit test for one unit: distance score, or Infinity if (x, y) misses it. Generous box. */
  function unitHit(u, x, y) {
    const walk = ART.sprite(u.type.id, u.team, 'walk');
    const w = walk ? walk.frameW * 0.6 : u.type.sizePx;
    const h = walk ? walk.frameH : u.type.sizePx;
    const px = gridToPx(u.x), foot = C.GROUND_Y_PX - u.depth;
    const dx = Math.abs(x - px);
    if (dx > Math.max(w / 2, 14) + 10 || y < foot - h - 34 || y > foot + 14) return Infinity;
    return dx + Math.abs(y - (foot - h / 2)) * 0.25;
  }
  /** Player unit with an ability under (x, y) px; ready units preferred. */
  function unitAt(x, y) {
    let best = null, bestScore = Infinity;
    for (const u of state.units) {
      if (u.team !== 'player' || u.hp <= 0 || !u.type.ability) continue;
      const d = unitHit(u, x, y);
      if (d === Infinity) continue;
      const score = d + (u.abilityCd <= 0 ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }
  /** Any living unit (either side) under (x, y) px: the closest one. */
  function anyUnitAt(x, y) {
    let best = null, bestScore = Infinity;
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      const d = unitHit(u, x, y);
      if (d < bestScore) { bestScore = d; best = u; }
    }
    return best;
  }
  /** A ready ally the player may cast with a tap (manual mode only). */
  const castableAt = (x, y) => {
    if (autoCast || state.over) return null;
    const u = unitAt(x, y);
    return u && u.abilityCd <= 0 && !autoFor(u) ? u : null;
  };
  // Tap = cast a ready ally (as before), otherwise open the unit's live info panel.
  // Press and hold (~0.45 s) or right-click = always the info panel.
  let fieldPress = null;   // { id, x, y, cx, cy, timer, held, type }
  canvas.addEventListener('pointerdown', (e) => {
    if (!state || e.button > 0) return;
    const pt = canvasPoint(e);
    if (fieldPress) clearTimeout(fieldPress.timer);
    const press = { id: e.pointerId, x: pt.x, y: pt.y, cx: e.clientX, cy: e.clientY, held: false, type: e.pointerType };
    press.timer = setTimeout(() => {
      const u = anyUnitAt(press.x, press.y);
      if (u) { press.held = true; openInfo({ unit: u }); }
    }, 450);
    fieldPress = press;
    if (anyUnitAt(pt.x, pt.y)) e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    const press = fieldPress;
    if (!press || press.id !== e.pointerId) return;
    clearTimeout(press.timer);
    fieldPress = null;
    if (press.held || !state) return;
    if (Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > 14) return;   // a drag, not a tap
    const c = castableAt(press.x, press.y);
    if (c) { tryCast(c); return; }
    const u = anyUnitAt(press.x, press.y);
    if (u) openInfo({ unit: u });
  });
  canvas.addEventListener('pointercancel', () => { if (fieldPress) clearTimeout(fieldPress.timer); fieldPress = null; });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (fieldPress) { clearTimeout(fieldPress.timer); if (fieldPress.held) { fieldPress = null; return; } fieldPress = null; }
    if (!state) return;
    const pt = canvasPoint(e);
    const u = anyUnitAt(pt.x, pt.y);
    if (u) openInfo({ unit: u });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state) return;
    const pt = canvasPoint(e);
    if (fieldPress && Math.hypot(e.clientX - fieldPress.cx, e.clientY - fieldPress.cy) > 14) clearTimeout(fieldPress.timer);
    const cur = castableAt(pt.x, pt.y) ? 'pointer' : anyUnitAt(pt.x, pt.y) ? 'help' : '';
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoOpen()) { closeInfo(); e.preventDefault(); return; }
    if (!state || e.ctrlKey || e.metaKey || e.altKey) return;
    // Shift+1..9 (layout-independent via e.code): use the ability of the frontmost ready unit.
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (e.shiftKey && m) {
      if (!autoCast && !state.over) castBySlot(m[1]);
      e.preventDefault();
      return;
    }
    const c = PLAYER_ROSTER.find((ch) => ch.key === e.key);
    if (c) { playerSpawn(c.id); return; }
    const k = e.key.toLowerCase();
    if (k === 'g') state.debug = !state.debug;
    if (k === 'r') newGame();
    if (k === 'a') setAuto(!autoCast);
    if (k === 'f') swapSides();
    if (k === 'n') setShowNums(!showNums);
  });
  document.getElementById('restart').addEventListener('click', () => newGame());

  // ------------------------------------------------------------------
  // Main loop (delta-time based)
  // ------------------------------------------------------------------
  const MAX_STEP = 0.05; // clamp big frame gaps (e.g. tab switch) into small steps
  let last = performance.now();
  let paused = false;    // testing hook: freeze the real-time loop while simulating
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.25);
    if (!paused) {
      updateVisuals(dt);
      while (dt > 0) {            // sub-step so fast units never skip past a target
        const step = Math.min(dt, MAX_STEP);
        update(step);
        dt -= step;
      }
    }
    render();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------
  // Startup: load art (async; missing files are fine), then start.
  // Capped so a slow/hung request can never block the game.
  // ------------------------------------------------------------------
  const LOAD_TIMEOUT_MS = 2000;
  let started = false;        // boot done (render loop running)
  let matchStarted = false;   // a match has been started (by boot without menu, ?play=1, or Game.start)
  // Main menu (menu.js, optional): when present, boot shows it instead of starting a match,
  // unless the URL has ?play=1 (or ?nomenu=1). Without menu.js the game starts right away as before.
  const SKIP_MENU = (() => { try { const q = new URLSearchParams(location.search); return q.get('play') === '1' || q.get('nomenu') === '1'; } catch (e) { return false; } })();
  const menuPresent = () => !!(window.Menu && typeof window.Menu.show === 'function');
  function start() {
    if (started) return;
    started = true;
    buildButtons();
    applyRestartArt();
    newGame();
    refreshHudControls();
    if (menuBtn) menuBtn.classList.toggle('hidden', !menuPresent());
    if (menuOverlayBtn) menuOverlayBtn.classList.toggle('hidden', !menuPresent());
    if (menuPresent() && !SKIP_MENU) {
      paused = true;            // idle stage behind the menu; Game.start() begins the match
    } else {
      matchStarted = true;
    }
    last = performance.now();
    requestAnimationFrame(frame);
  }

  /**
   * Public game API (used by menu.js; see MENU.md).
   *   Game.start({ side, enemy, auto, stage }) : (re)start a match without reloading.
   *       side/enemy = faction ids from CONFIG.FACTIONS, auto = bool, stage = number (unused for now).
   *   Game.pause() / Game.resume()
   *   Game.started : true once a match has begun, until torn down (stays true after game over;
   *                  menu.js uses it to show Resume / New battle)
   *   Game.running : true while a match is in play (begun, not over, not paused)
   *   Game.paused  : true while paused
   */
  window.Game = {
    start(opts) {
      opts = opts || {};
      const F = C.FACTIONS;
      // omitted -> keep the current faction; given but not an own CONFIG.FACTIONS key -> the defaults
      let side = opts.side == null ? C.PLAYER_FACTION : isFaction(opts.side) ? opts.side : DEFAULT_PLAYER_FACTION;
      if (!isFaction(side)) side = DEFAULT_PLAYER_FACTION;
      let enemy = isFaction(opts.enemy) && opts.enemy !== side ? opts.enemy
        : (side === C.ENEMY_FACTION ? C.PLAYER_FACTION : C.ENEMY_FACTION);
      if (!isFaction(enemy) || enemy === side) enemy = side !== DEFAULT_ENEMY_FACTION ? DEFAULT_ENEMY_FACTION : DEFAULT_PLAYER_FACTION;
      if (enemy === side) enemy = Object.keys(F).find((id) => id !== side);
      C.PLAYER_FACTION = side;
      C.ENEMY_FACTION = enemy;
      refreshRosters();
      try {   // keep ?side in step (deep links / reload), like the in-game swap does
        const url = new URL(location.href);
        url.searchParams.set('side', side);
        history.replaceState(history.state, '', url.toString());
      } catch (e) { /* file:// or sandboxed: fine */ }
      if (typeof opts.auto === 'boolean') autoCast = opts.auto;
      if (!started) start();
      buildButtons();
      closeInfo();
      newGame();
      refreshHudControls();
      matchStarted = true;
      paused = false;
      last = performance.now();
      return { side, enemy, auto: autoCast, stage: opts.stage || 1 };
    },
    pause() { paused = true; closeInfo(); },
    resume() {
      if (!matchStarted) return;
      paused = false;
      last = performance.now();   // no time jump after a long pause
    },
    /** True once a match has begun (also after it ends, until Game.start replaces it). */
    get started() { return matchStarted; },
    /** True while a match is actually being played (begun and not over). */
    get running() { return matchStarted && !!state && !state.over && !paused; },
    get over() { return !!(state && state.over); },
    get paused() { return paused; },
  };

  buildButtons(); // placeholder buttons visible immediately
  ctx.fillStyle = C.COLORS.sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = C.COLORS.text;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Loading…', canvas.width / 2, canvas.height / 2);

  ART.loadAll({ player: C.COLORS.player, enemy: C.COLORS.enemy })
    .catch((e) => console.warn('[art] loading failed, using placeholders', e))
    .then(() => {
      if (started) { buildButtons(); applyRestartArt(); } // late art: refresh DOM UI
      start();
    });
  setTimeout(start, LOAD_TIMEOUT_MS);

  // Hooks for testing/console tinkering: TD.spawn('player','ranger_ssr'), TD.sim.battle(...)
  window.TD = {
    get state() { return state; },
    spawn: spawnUnit,
    playerSpawn,
    restart: newGame,
    renderOnce: () => render(),   // test hook: draw one frame now (visual checks / render-cost timing)
    toggleDebug: () => { state.debug = !state.debug; },
    art: ART,
    types: UNIT_TYPES,
    get roster() { return { player: PLAYER_ROSTER, enemy: ENEMY_ROSTER }; },
    /** Manual cast for a unit (as if clicked). */
    cast: tryCast,
    castBySlot,
    get auto() { return autoCast; },
    get showDamageNumbers() { return showNums; },
    setShowDamageNumbers: setShowNums,
    heal: healUnit,
    openInfo, closeInfo,
    /** Test hook: on-canvas boxes of visible damage numbers. */
    numRects: () => state.nums.filter((n) => n.t / n.dur < 0.7).map(numRect),
    get info() { return info; },
    get infoOpen() { return infoOpen(); },
    isCapped: (team, id) => isCapped(team, typeById(id)),
    aliveOfRarity,
    setAuto,
    swapSides,
    /** Canvas-pixel position of a unit (for click tests): { x, y } at its chest. */
    unitScreenPos(u) {
      const walk = ART.sprite(u.type.id, u.team, 'walk');
      const h = walk ? walk.frameH : u.type.sizePx;
      return { x: gridToPx(u.x), y: C.GROUND_Y_PX - u.depth - h * 0.5 };
    },
    /** What a unit currently shows: { src, mode, frame, frames } or null (placeholder shape). */
    frameOf(u) { const f = unitFrame(u); return f ? { src: f.spr.src, mode: f.spr.mode, frame: f.frame, frames: f.spr.frames, size: f.spr.frameW } : null; },
    sim: {
      /** Pause/resume the real-time loop. */
      pause(p) { paused = p !== false; },
      /** Advance the simulation by `seconds` in fixed steps (no rendering). */
      run(seconds, step) {
        step = step || MAX_STEP;
        for (let t = 0; t < seconds && !state.over; t += step) { updateVisuals(step); update(step); }
        return state;
      },
      /**
       * Sandbox battle: spawn `left` (array of unit ids, player side) and `right` (enemy side),
       * staggered by `staggerSec`, no economy/AI. Runs until one side is wiped or maxSec.
       * Returns { winner, timeSec, leftAlive, rightAlive, leftHpFrac, rightHpFrac, stats }.
       */
      battle(left, right, opts) {
        opts = opts || {};
        const stagger = opts.staggerSec != null ? opts.staggerSec : 0.6;
        const maxSec = opts.maxSec || 180;
        newGame({ sandbox: true, forceAuto: opts.forceAuto !== false });
        const queue = [];
        left.forEach((id, i) => queue.push({ t: i * stagger, team: 'player', id }));
        right.forEach((id, i) => queue.push({ t: i * stagger, team: 'enemy', id }));
        queue.sort((a, b) => a.t - b.t);
        const step = MAX_STEP;
        let maxHp = { player: 0, enemy: 0 };
        for (const q of queue) maxHp[q.team] += typeById(q.id).hp;
        while (state.time < maxSec) {
          while (queue.length && queue[0].t <= state.time) { const q = queue.shift(); spawnUnit(q.team, q.id); }
          update(step); updateVisuals(step);
          const pl = state.units.filter((u) => u.team === 'player').length;
          const en = state.units.filter((u) => u.team === 'enemy').length;
          if (!queue.length && (pl === 0 || en === 0)) break;
          if (state.over) break;
        }
        const side = (team) => state.units.filter((u) => u.team === team);
        const hpFrac = (team) => side(team).reduce((s, u) => s + Math.max(0, u.hp), 0) / maxHp[team];
        const L = side('player').length, R = side('enemy').length;
        return {
          winner: L && !R ? 'left' : R && !L ? 'right' : (state.towers.enemy.hp < state.towers.player.hp ? 'left' : 'right'),
          timeSec: +state.time.toFixed(1), leftAlive: L, rightAlive: R,
          leftHpFrac: +hpFrac('player').toFixed(3), rightHpFrac: +hpFrac('enemy').toFixed(3),
          stats: state.stats,
        };
      },
    },
  };
})();
