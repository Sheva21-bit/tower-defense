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
  // ?side=<faction> picks the player's faction (e.g. ?side=deva plays Deva vs Valkyries).
  (function applySideParam() {
    let side = null;
    try { side = new URLSearchParams(location.search).get('side'); } catch (e) { /* ignore */ }
    if (side && C.FACTIONS[side] && side !== C.PLAYER_FACTION) {
      if (side === C.ENEMY_FACTION) C.ENEMY_FACTION = C.PLAYER_FACTION;
      C.PLAYER_FACTION = side;
    }
  })();
  refreshRosters();
  // Player ability casting: false = manual (click / Shift+1..9). Kept across restarts.
  let autoCast = false;
  try { autoCast = new URLSearchParams(location.search).get('auto') === '1'; } catch (e) { /* ignore */ }
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
      towers: {
        player: { hp: C.TOWER_HP, maxHp: C.TOWER_HP },
        enemy:  { hp: C.TOWER_HP, maxHp: C.TOWER_HP },
      },
      resource: C.START_RESOURCE,
      enemyResource: C.ENEMY_START_RESOURCE,
      enemyNext: null,
      sandbox: !!opts.sandbox,   // testing: no economy, no enemy AI
      forceAuto: !!opts.forceAuto, // sims: player units auto-cast regardless of the Auto toggle
      over: false,
      winner: null,
      stats: newStats(),
      debug: state ? state.debug : false, // keep debug toggle across restarts
    };
    document.getElementById('overlay').classList.add('hidden');
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

  /** Player spawn: checks and spends resource. Returns true on success. */
  function playerSpawn(typeId) {
    if (state.over) return false;
    const t = typeById(typeId);
    if (!t || t.factionId !== C.PLAYER_FACTION || state.resource < t.cost) return false;
    state.resource -= t.cost;
    spawnUnit('player', typeId);
    return true;
  }

  /** Enemy AI: weighted random pick from its faction's roster (weights favour Commons). */
  function enemyPickType() {
    const total = ENEMY_ROSTER.reduce((s, c) => s + c.enemyWeight, 0);
    let r = Math.random() * total;
    for (const c of ENEMY_ROSTER) {
      r -= c.enemyWeight;
      if (r <= 0) return c.id;
    }
    return ENEMY_ROSTER[0].id;
  }

  /** Enemy economy: earns like the player, saves for its next pick, buys it when affordable. */
  function enemyThink(dt) {
    state.enemyResource = Math.min(C.MAX_RESOURCE, state.enemyResource + C.ENEMY_RESOURCE_PER_SEC * dt);
    if (!state.enemyNext) state.enemyNext = enemyPickType();
    const t = typeById(state.enemyNext);
    if (state.time >= C.ENEMY_FIRST_SPAWN_SEC && state.enemyResource >= t.cost) {
      state.enemyResource -= t.cost;
      spawnUnit('enemy', t.id);
      state.enemyNext = enemyPickType();
    }
  }

  function enemyNextSpawnEta() {
    if (!state.enemyNext) return Math.max(0, C.ENEMY_FIRST_SPAWN_SEC - state.time);
    const t = typeById(state.enemyNext);
    const need = Math.max(0, t.cost - state.enemyResource) / C.ENEMY_RESOURCE_PER_SEC;
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

  /** Apply damage to a unit: armor (class) and damage-taken multipliers (auras). */
  function damageUnit(target, amount, source, opts) {
    if (!target || target.hp <= 0) return 0;
    const trueDmg = opts && opts.trueDamage;     // true damage ignores armor and auras
    const dealt = Math.min(target.hp, amount * (trueDmg ? 1 : (1 - (target.type.armor || 0)) * target.dmgTakenMult));
    target.hp -= dealt;
    if (!(opts && opts.noFlash)) target.flash = 0.12;
    if (source) {
      const sid = source.type.id;
      state.stats.damageBy[sid] = (state.stats.damageBy[sid] || 0) + dealt;
      if (target.hp <= 0) state.stats.kills[sid] = (state.stats.kills[sid] || 0) + 1;
    }
    return dealt;
  }

  function damageTower(team, amount, source) {
    state.towers[team].hp = Math.max(0, state.towers[team].hp - amount);
    if (source) {
      const sid = source.type.id;
      state.stats.damageBy[sid] = (state.stats.damageBy[sid] || 0) + amount;
    }
  }

  /**
   * Move u toward x, but NEVER through a living enemy (stops NO_PASS_GAP_GRIDS short of the
   * first enemy ahead) and never into the enemy tower. This is what makes defenders a wall.
   */
  function moveTo(u, x) {
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
    u.x = nx;
  }

  /** Defender zone of control: nearest living enemy defender that holds u, or null. */
  function zocHolder(u) {
    let best = null, bd = Infinity;
    for (const o of state.units) {
      if (o.team === u.team || o.hp <= 0 || !(o.type.blockGrids > 0)) continue;
      if (o.stun > 0 || o.trapT > 0) continue;        // incapacitated defenders don't hold anyone
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
        const dealt = damageUnit(u, per, st.src, { trueDamage: S.trueDamage, noFlash: true });
        state.stats.lifestealDrain = (state.stats.lifestealDrain || 0) + dealt;
        const src = st.src;
        if (S.healSource && src && src.hp > 0 && dealt > 0) {
          const h = Math.min(dealt, src.type.hp - src.hp);
          if (h > 0) { src.hp += h; healed.set(src, (healed.get(src) || 0) + h); }
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
    addStatus,
    buffSpeed,
    hop,
    addZone,
    moveTo,
    fx,
  };

  /** Normal attack. Rangers fire a projectile; everyone else hits instantly. */
  function basicAttack(u, target) {
    const foeTeam = foeTeamOf(u);
    if (u.type.ranged) {
      const style = u.type.projectile || 'arrow';
      const ps = (C.PROJECTILES && C.PROJECTILES[style]) || {};
      state.projectiles.push({
        team: u.team, x: u.x + dirOf(u) * 0.5, depth: u.depth,
        target: target || null, towerTeam: target ? null : foeTeam,
        damage: u.type.damage, speed: ps.speedGrids || u.type.projectileSpeedGrids || 40, source: u,
        style, born: state.time, onHit: u.type.onHit,
        hitY: target ? target.type.sizePx / 2 : 60,
      });
      state.stats.projectiles++;
    } else if (target) {
      damageUnit(target, u.type.damage, u);
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
    u.cooldown = u.type.cooldownSec;
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
    const busy = u.stun > 0 || u.trapT > 0 || u.hop;
    if (!busy && !impl.canUse(u, A, abilityApi)) { noTarget(u); return 'no-target'; }
    if (!busy && u.cooldown <= 0) { doCast(u); return 'cast'; }
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
        else if (p.target) { damageUnit(p.target, p.damage, p.source); applyOnHit(p.onHit, p.target, p.source); }
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
      // Player resource regen
      state.resource = Math.min(C.MAX_RESOURCE, state.resource + C.RESOURCE_PER_SEC * dt);
      enemyThink(dt);
    }

    // Passives (auras) are recomputed from scratch each tick.
    for (const u of state.units) u.dmgTakenMult = 1;
    for (const u of state.units) {
      if (u.hp <= 0 || !u.type.ability) continue;
      const impl = ABILITY_IMPL[u.type.ability];
      if (impl && impl.passive) impl.passive(u, C.ABILITIES[u.type.ability], abilityApi);
    }

    // Units
    for (const u of state.units) {
      if (u.hp <= 0) continue;
      const dir = dirOf(u);
      const foeTeam = foeTeamOf(u);
      u.cooldown = Math.max(0, u.cooldown - dt);
      u.abilityCd = Math.max(0, u.abilityCd - dt);
      u.flash = Math.max(0, u.flash - dt);
      u.castT = Math.max(0, u.castT - dt);
      u.tauntT = Math.max(0, u.tauntT - dt);
      if (u.tauntT <= 0) u.tauntBy = null;

      if (u.ls.length) { updateLifesteal(u); if (u.hp <= 0) continue; }   // DoT ticks even while stunned/trapped
      if (u.speedBuffT > 0) { u.speedBuffT = Math.max(0, u.speedBuffT - dt); if (u.speedBuffT <= 0) u.speedBuffMult = 1; }
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

      // Ability (counts as this cycle's attack). Auto for the AI (and the player when Auto
      // is on); otherwise only when the player queued a manual cast.
      const abId = u.type.ability;
      if (abId && u.abilityCd <= 0 && u.cooldown <= 0 && (autoFor(u) || u.castQueued)) {
        const impl = ABILITY_IMPL[abId];
        if (impl && impl.canUse(u, C.ABILITIES[abId], abilityApi)) doCast(u);
        else if (u.castQueued) { u.castQueued = false; noTarget(u); }
        if (u.hop) continue;
      }

      const target = pickTarget(u);
      u.target = target;
      const distToTower = (TOWER_FRONT[foeTeam] - u.x) * dir;
      const towerInRange = distToTower <= u.type.rangeGrids;

      if (target || towerInRange) {
        u.state = 'fight';
        if (u.cooldown <= 0) {
          basicAttack(u, target);
          u.cooldown = u.type.cooldownSec;
        }
      } else if (zocHolder(u)) {
        u.state = 'fight';           // held by a defender it can't reach yet: it may not walk on
      } else {
        u.state = 'walk';
        // Movement in grids: speedGrids (grids/sec) * dt (sec); never through enemies.
        moveTo(u, u.x + dir * u.type.speedGrids * u.speedBuffMult * dt);
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
    if (state.over || u.state === 'stunned' || u.state === 'trapped') return { spr: walk, frame: 0 };   // idle = walk frame 0
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
      return { spr: atk, frame: Math.floor(phase * atk.frames) };
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
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur = (8 + pulse * 8) * BLUR;
    ctx.fillStyle = u.castQueued ? '#fff8e1' : '#ffd54f';
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 1.5;
    const r = u.castQueued ? 5 : 6 + pulse * 1.5;
    ctx.beginPath();                // 4-point star
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2 + (u.castQueued ? state.time * 6 : 0);
      const rr = i % 2 ? r * 0.42 : r;
      ctx.lineTo(px + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
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

  function drawUnit(u) {
    const px = gridToPx(u.x);
    const fr = unitFrame(u);
    const r = u.type.rarity;

    const lift = trapLift(u) + hopLift(u);
    if (fr) {
      const footY = C.GROUND_Y_PX - u.depth - lift;
      drawSpriteFrame(fr.spr, fr.frame, px, footY, dirOf(u) < 0, u.flash > 0, r.glow, lsTint(u));
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
      ctx.lineCap = 'round';
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
    const icon = ART.ui('resourceIcon');
    if (icon) {
      const { w, h } = AM.UI.resourceIcon;
      ctx.drawImage(icon, 12, 26 - 17, w, h);
      txt(`${Math.floor(state.resource)} / ${C.MAX_RESOURCE}  (+${C.RESOURCE_PER_SEC}/s)`, 12 + w + 6, 26);
    } else {
      txt(`Resource: ${Math.floor(state.resource)} / ${C.MAX_RESOURCE}  (+${C.RESOURCE_PER_SEC}/s)`, 12, 26);
    }
    ctx.textAlign = 'right';
    txt(state.sandbox ? 'Sandbox: enemy AI off' : `Enemy next spawn: ${enemyNextSpawnEta().toFixed(1)}s`, C.STAGE_WIDTH_PX - 12, 26);
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
    drawHud();
    updateButtons();
  }

  // ------------------------------------------------------------------
  // UI: spawn bar (9 units grouped by class) + keyboard
  // ------------------------------------------------------------------
  const buttonBar = document.getElementById('buttons');
  let buttons = [];

  function cssUrl(img) { return `url("${img.src.replace(/"/g, '%22')}")`; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** (Re)build the spawn bar, using portrait / rarity frame / class icon art when available. */
  function buildButtons() {
    buttonBar.innerHTML = '';
    buttons = [];
    const frameArt = ART.ui('button');
    const fac = C.FACTIONS[C.PLAYER_FACTION];
    const head = document.createElement('div');
    head.className = 'faction-head';
    head.innerHTML = `<span class="fac-swatches">${fac.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>` +
      `<b>${esc(fac.name)}</b> <small>vs ${esc(C.FACTIONS[C.ENEMY_FACTION].name)} · unit names are placeholders</small>`;
    buttonBar.appendChild(head);
    for (const [classId, cls] of Object.entries(C.CLASSES)) {
      const units = PLAYER_ROSTER.filter((t) => t.classId === classId);
      if (!units.length) continue;
      const group = document.createElement('div');
      group.className = 'unit-group';
      const icon = ART.ui('class_' + classId);
      group.innerHTML =
        `<div class="group-head" title="${esc(cls.desc)}">` +
        (icon ? `<img class="class-icon" src="${icon.src}" width="24" height="24" alt="">` : `<span class="class-tag" style="background:${cls.color}">${cls.tag}</span>`) +
        `<b>${esc(cls.name)}s</b> <small>${esc(cls.desc)}</small></div>`;
      for (const c of units) {
        const r = c.rarity;
        const A = c.ability ? C.ABILITIES[c.ability] : null;
        const b = document.createElement('button');
        b.className = `spawn unit rar-${c.rarityId}`;
        b.style.setProperty('--rar', r.color);
        b.title = unitTooltip(c);
        const portrait = ART.ui('portrait_' + c.id);
        const rFrame = ART.ui('frame_' + c.rarityId);
        const classIcon = ART.ui('class_' + classId);
        const pic = portrait
          ? `<img class="portrait" src="${portrait.src}" width="64" height="64" alt="">`
          : `<span class="portrait ph" style="background:${c.color}">${esc(c.short)}</span>`;
        const frame = rFrame
          ? `<img class="rar-frame" src="${rFrame.src}" width="72" height="72" alt="">`
          : '';
        const tag = classIcon
          ? `<img class="class-icon sm" src="${classIcon.src}" width="24" height="24" alt="${cls.tag}">`
          : `<span class="class-tag" style="background:${cls.color}">${cls.tag}</span>`;
        const info =
          `<b>[${c.key}] ${esc(c.name)}</b>` +
          `<span class="tags"><span class="rar-tag">${r.name}</span>${tag}<span class="cost">${c.cost}</span></span>` +
          `<small>HP ${c.hp} · DMG ${c.damage}/${c.cooldownSec}s · Rng ${c.rangeGrids} g · Spd ${c.speedGrids} g/s</small>` +
          `<small class="ab"${A ? ` title="${esc(A.desc)}"` : ''}>${A ? '★ ' + esc(A.name) + (c.projectile && c.projectile !== 'arrow' ? ` · ${esc(c.projectile)} shots` : '') : 'No ability'}</small>`;
        b.innerHTML =
          `<span class="pf${rFrame ? ' has-frame' : ''}">${pic}${frame}` +
          (A ? `<span class="cdbar hidden"><i></i></span><span class="castbtn" title="Use ${esc(A.name)} (frontmost ready unit) · Shift+${c.key}">★</span>` : '') +
          `</span>` +
          (frameArt ? `<span class="info btn-frame" style='background-image:${cssUrl(frameArt)}'>${info}</span>`
                    : `<span class="info">${info}</span>`);
        bindSpawnButton(b, c);
        group.appendChild(b);
        buttons.push({ b, c, A, bar: b.querySelector('.cdbar'), fill: b.querySelector('.cdbar i'), last: '' });
      }
      buttonBar.appendChild(group);
    }
    buildEnemyRoster();
  }

  /**
   * Spawn button input: tap/click = spawn; tap-and-hold (~0.45 s) = info panel (no spawn);
   * tapping the ★ badge or the cooldown bar while the ability is ready = cast it for the
   * frontmost ready unit of that slot (manual mode). Buttons are never `disabled` (disabled
   * buttons swallow taps, which would block the info panel / cast badge when you're broke).
   */
  function bindSpawnButton(b, c) {
    let holdTimer = null, held = false;
    const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
    b.addEventListener('pointerdown', (e) => {
      held = false;
      if (e.button > 0) return;
      cancelHold();
      holdTimer = setTimeout(() => { held = true; showInfo(c); }, 450);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, cancelHold);
    b.addEventListener('contextmenu', (e) => e.preventDefault());   // no long-press callout / menu
    b.addEventListener('click', (e) => {
      if (held) { held = false; e.preventDefault(); return; }
      const castHit = e.target.closest && e.target.closest('.castbtn, .cdbar');
      if (castHit && b.classList.contains('can-cast')) { castBySlot(c.key); return; }
      playerSpawn(c.id);
    });
  }

  // ---------------- Info panel (long-press on a spawn button) ----------------
  const infoPanel = document.getElementById('info-panel');
  function showInfo(c) {
    if (!infoPanel) return;
    infoPanel.querySelector('.ip-text').textContent = unitTooltip(c);
    infoPanel.classList.remove('hidden');
  }
  if (infoPanel) {
    // Full-screen backdrop: the next tap anywhere closes it (and doesn't reach the game below).
    // Lifting the finger from the opening hold is a pointerup, so it doesn't close it.
    infoPanel.addEventListener('pointerdown', (e) => { e.preventDefault(); infoPanel.classList.add('hidden'); });
  }

  /** Tooltip text for a unit: name, faction/rarity/class, ability name + description, bio. */
  function unitTooltip(c) {
    const A = c.ability ? C.ABILITIES[c.ability] : null;
    return `${c.name} · ${c.faction.name} ${c.rarity.name} ${c.cls.name}\n` +
      `HP ${c.hp} · DMG ${c.damage}/${c.cooldownSec}s · Range ${c.rangeGrids} grids · Cost ${c.cost}\n` +
      (A ? `★ ${A.name}: ${A.desc}` : 'Common: no special ability.') +
      (c.onHit && c.onHit.lifesteal ? `\nOn hit: +${c.onHit.lifesteal} ${C.STATUSES.lifesteal.name} (${C.STATUSES.lifesteal.desc})` : '') +
      (c.projectile && c.projectile !== 'arrow' ? `\nAttack: ${c.projectile} projectiles` : '') +
      (c.bio ? `\n${c.bio}` : '');
  }

  /** Read-only strip of the enemy faction's roster (hover for abilities). */
  function buildEnemyRoster() {
    let el = document.getElementById('enemy-roster');
    if (!el) {
      el = document.createElement('div');
      el.id = 'enemy-roster';
      buttonBar.parentNode.insertBefore(el, buttonBar.nextSibling);
    }
    const fac = C.FACTIONS[C.ENEMY_FACTION];
    el.innerHTML = `<span class="er-head">Enemy: <b>${esc(fac.name)}</b></span>` + ENEMY_ROSTER.map((c) => {
      const A = c.ability ? C.ABILITIES[c.ability] : null;
      const portrait = ART.ui('portrait_' + c.id);
      const pic = portrait ? `<img src="${portrait.src}" width="32" height="32" alt="">`
                           : `<span class="er-ph" style="background:${c.color}">${esc(c.short)}</span>`;
      return `<span class="er-unit rar-${c.rarityId}" style="--rar:${c.rarity.color}" data-id="${c.id}" title="${esc(unitTooltip(c))}">` +
        pic + `<span><b>${esc(c.name)}</b><small>${A ? '★ ' + esc(A.name) : c.rarity.name + ' ' + esc(c.cls.name)}</small></span></span>`;
    }).join('');
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
      const dis = state.over || state.resource < c.cost;
      // Class only (not `disabled` / aria-disabled): an unaffordable button still takes the
      // long-press info and the ★ cast tap; playerSpawn() itself refuses when you can't pay.
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
  /** Player unit with an ability under (x, y) px; generous hit box, ready units preferred. */
  function unitAt(x, y) {
    let best = null, bestScore = Infinity;
    for (const u of state.units) {
      if (u.team !== 'player' || u.hp <= 0 || !u.type.ability) continue;
      const walk = ART.sprite(u.type.id, u.team, 'walk');
      const w = walk ? walk.frameW * 0.6 : u.type.sizePx;
      const h = walk ? walk.frameH : u.type.sizePx;
      const px = gridToPx(u.x), foot = C.GROUND_Y_PX - u.depth;
      const dx = Math.abs(x - px);
      if (dx > Math.max(w / 2, 14) + 10 || y < foot - h - 34 || y > foot + 14) continue;
      const score = dx + (u.abilityCd <= 0 ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = u; }
    }
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!state || state.over || autoCast) return;
    const pt = canvasPoint(e);
    const u = unitAt(pt.x, pt.y);
    if (u) { tryCast(u); e.preventDefault(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state) return;
    const pt = canvasPoint(e);
    const u = !autoCast && !state.over ? unitAt(pt.x, pt.y) : null;
    const cur = u && u.abilityCd <= 0 ? 'pointer' : '';
    if (canvas.style.cursor !== cur) canvas.style.cursor = cur;
  });

  window.addEventListener('keydown', (e) => {
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
  let started = false;
  function start() {
    if (started) return;
    started = true;
    buildButtons();
    applyRestartArt();
    newGame();
    refreshHudControls();
    last = performance.now();
    requestAnimationFrame(frame);
  }

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
    toggleDebug: () => { state.debug = !state.debug; },
    art: ART,
    types: UNIT_TYPES,
    get roster() { return { player: PLAYER_ROSTER, enemy: ENEMY_ROSTER }; },
    /** Manual cast for a unit (as if clicked). */
    cast: tryCast,
    castBySlot,
    get auto() { return autoCast; },
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
