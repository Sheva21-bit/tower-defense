/*
 * abilities.js — ability LOGIC. Ability DATA (cooldowns, areas, multipliers, text) lives in
 * CONFIG.ABILITIES in config.js under the same id.
 *
 * Each handler:
 *   canUse(u, A, api) -> boolean   condition check (called only when the ability is off cooldown)
 *   use(u, A, api)                 do it (game.js then puts it on cooldown and counts it as
 *                                  the unit's attack for this cycle)
 *   passive(u, A, api)  optional   runs every tick while the unit is alive (auras etc.)
 *
 * u = the acting unit, A = its CONFIG.ABILITIES entry, api = helpers from game.js:
 *   api.foes(u)                 living enemy units
 *   api.allies(u)               living friendly units (incl. u)
 *   api.ahead(u, o)             signed grid distance from u to o in u's walking direction
 *   api.dist(a, b)              absolute grid distance
 *   api.currentTarget(u)        the unit u would attack now (or null)
 *   api.damage(target, amount, source)   applies armor / auras, hit flash
 *   api.stun(target, sec)       api.taunt(target, byUnit, sec)
 *   api.moveTo(u, x)            moves u toward x but never through living enemies / towers
 *   api.fx(effect)              spawn a visual effect (see drawEffect in game.js)
 *   api.trap(target, sec)       bubble-trap a unit: can't move/attack/use abilities (ignored by ccImmune)
 *   api.launch({ fromX, toX, speedGrids, style, depth, source, onArrive })
 *                               fly a projectile to a grid position, then call onArrive()
 *   api.later(sec, fn)          run fn after `sec` seconds of game time
 *   api.shoot(u, target, mult)  fire u's normal ranged attack (standard projectile, onHit) at a unit, mult x damage
 *   api.canAct(u)               alive and not stunned / trapped / hopping
 *   api.doomed(t)               projectiles already in flight at t will kill it
 *   api.burst(u, sec)           block u's normal attack for `sec` (multi-shot abilities)
 *   api.addStatus(target, id, stacks, source)   add stacking status (CONFIG.STATUSES, e.g. 'lifesteal')
 *   api.buffSpeed(target, mult, sec)  movement-speed buff (no stacking; re-apply refreshes)
 *   api.hop(u, dxGrids, sec)    quick scripted move (never behind own tower front / through enemies)
 *   api.addZone({ kind, x, rGrids, until, team, onEnter(o) })
 *                               persistent area; onEnter runs once per enemy unit inside it
 *   api.state                   live game state (api.state.time = game seconds)
 * All distances are in GRIDS.
 * To add an ability: add data in config.js ABILITIES, add a handler here, set it on a unit.
 */
const ABILITY_IMPL = {
  // ---- Striker SR: hit every enemy in a short area in front ----
  cleave: {
    canUse(u, A, api) {
      return api.foes(u).some((o) => { const d = api.ahead(u, o); return d >= -0.5 && d <= A.areaGrids; });
    },
    use(u, A, api) {
      for (const o of api.foes(u)) {
        const d = api.ahead(u, o);
        if (d >= -0.5 && d <= A.areaGrids) api.damage(o, u.type.damage * A.damageMult, u);
      }
      api.fx({ kind: 'arc', x: u.x, dir: api.dir(u), lenGrids: A.areaGrids, color: '#ffcc80', depth: u.depth, dur: 0.3 });
    },
  },

  // ---- Dia (named SR Striker): Rallying Charge -> allies nearby move faster ----
  rallying_charge: {
    canUse() { return true; },                 // Dia herself always counts as an ally in range
    use(u, A, api) {
      for (const a of api.allies(u)) if (api.dist(u, a) <= A.rangeGrids) api.buffSpeed(a, 1 + A.speedBonus, A.buffSec);
      api.fx({ kind: 'rally', x: u.x, rGrids: A.rangeGrids, depth: u.depth, src: u, dur: 0.6 });
      api.fx({ kind: 'text', x: u.x, text: 'Rally!', color: '#ffe082', depth: u.depth, dur: 0.8 });
    },
  },

  // ---- Raven (named SR Striker): Dark Cloud zone -> +Life Steal on entry, hop back ----
  dark_cloud: {
    canUse(u, A, api) {
      return api.foes(u).some((o) => { const d = api.ahead(u, o); return d >= -0.5 && d <= A.triggerGrids; });
    },
    use(u, A, api) {
      const dir = api.dir(u);
      const cx = u.x + dir * A.offsetGrids;
      api.addZone({
        kind: 'dark_cloud', x: cx, rGrids: A.radiusGrids, team: u.team, source: u,
        until: api.state.time + A.durationSec, dur: A.durationSec,
        // Once per enemy per cloud: entering it, or already inside when cast.
        onEnter: (o) => api.addStatus(o, 'lifesteal', A.stacksOnEnter, u),
      });
      api.hop(u, -dir * A.hopBackGrids, A.hopSec);
      api.fx({ kind: 'text', x: u.x, text: 'Dark Cloud!', color: '#ce93d8', depth: u.depth, dur: 0.8 });
    },
  },

  // ---- Striker SSR: dash forward to an enemy and deliver a big hit ----
  dash_strike: {
    pick(u, A, api) {
      let best = null, bd = Infinity;
      for (const o of api.foes(u)) {
        const d = api.ahead(u, o);
        if (d >= 0 && d <= A.triggerGrids && d < bd) { bd = d; best = o; }
      }
      return best;
    },
    canUse(u, A, api) { return !!this.pick(u, A, api); },
    use(u, A, api) {
      const target = this.pick(u, A, api);
      const dir = api.dir(u);
      const from = u.x;
      const want = target.x - dir * api.C.NO_PASS_GAP_GRIDS;
      const capped = from + dir * Math.min(A.dashMaxGrids, Math.max(0, (want - from) * dir));
      api.moveTo(u, capped);                              // never passes defenders / anyone
      api.fx({ kind: 'dash', x0: from, x1: u.x, color: '#ffd54f', depth: u.depth, dur: 0.35 });
      // Hit the nearest enemy now in reach (normally the dash target).
      let hit = null, bd = Infinity;
      for (const o of api.foes(u)) {
        const d = api.dist(u, o);
        if (d <= u.type.rangeGrids + 0.01 && d < bd) { bd = d; hit = o; }
      }
      if (!hit) return;
      api.damage(hit, u.type.damage * A.damageMult, u);
      for (const o of api.foes(u)) {
        if (o !== hit && api.dist(o, hit) <= A.splashGrids) api.damage(o, u.type.damage * A.splashMult, u);
      }
      api.fx({ kind: 'ring', x: hit.x, rGrids: A.splashGrids, color: '#ffd54f', depth: hit.depth, dur: 0.4 });
      api.fx({ kind: 'text', x: hit.x, text: 'DASH!', color: '#ffd54f', depth: hit.depth, dur: 0.7 });
    },
  },

  // ---- Defender SR: damage + stun the current target ----
  shield_bash: {
    canUse(u, A, api) {
      const t = api.currentTarget(u);
      return !!t && t.stun <= 0;
    },
    use(u, A, api) {
      const t = api.currentTarget(u);
      api.damage(t, u.type.damage * A.damageMult, u);
      api.stun(t, A.stunSec);
      api.fx({ kind: 'ring', x: t.x, rGrids: 0.8, color: '#e0e0e0', depth: t.depth, dur: 0.3 });
    },
  },

  // ---- Defender SSR: damage-reduction aura (passive) + periodic taunt ----
  fortress: {
    passive(u, A, api) {
      for (const a of api.allies(u)) {
        if (api.dist(u, a) <= A.auraGrids) a.dmgTakenMult = Math.min(a.dmgTakenMult, 1 - A.allyDamageReduction);
      }
    },
    canUse(u, A, api) { return api.foes(u).some((o) => api.dist(u, o) <= A.tauntGrids); },
    use(u, A, api) {
      for (const o of api.foes(u)) if (api.dist(u, o) <= A.tauntGrids) api.taunt(o, u, A.tauntSec);
      api.fx({ kind: 'ring', x: u.x, rGrids: A.tauntGrids, color: '#ffd54f', depth: u.depth, dur: 0.6 });
      api.fx({ kind: 'text', x: u.x, text: 'TAUNT!', color: '#ffd54f', depth: u.depth, dur: 0.8 });
    },
  },

  // ---- Ranger SR: line shot through every enemy within range ----
  piercing_shot: {
    canUse(u, A, api) {
      return api.foes(u).some((o) => { const d = api.ahead(u, o); return d >= 0 && d <= u.type.rangeGrids; });
    },
    use(u, A, api) {
      for (const o of api.foes(u)) {
        const d = api.ahead(u, o);
        if (d >= 0 && d <= u.type.rangeGrids) api.damage(o, u.type.damage * A.damageMult, u);
      }
      api.fx({ kind: 'beam', x0: u.x, x1: u.x + api.dir(u) * u.type.rangeGrids, color: '#b3e5fc', depth: u.depth, dur: 0.3 });
    },
  },

  // ---- Pela (named SR Ranger): big bubble -> trap an area -> pop for splash damage ----
  bubble_trap: {
    pickCenter(u, A, api) {
      const inRange = api.foes(u).filter((o) => api.dist(u, o) <= u.type.rangeGrids);
      let center = null, bestCount = -1, bestD = Infinity;
      for (const c of inRange) {
        const n = inRange.filter((o) => api.dist(o, c) <= A.trapRadiusGrids).length;
        const d = api.dist(u, c);
        if (n > bestCount || (n === bestCount && d < bestD)) { bestCount = n; bestD = d; center = c; }
      }
      return center;
    },
    canUse(u, A, api) { return !!this.pickCenter(u, A, api); },
    use(u, A, api) {
      const cx = this.pickCenter(u, A, api).x;
      api.fx({ kind: 'text', x: u.x, text: 'Bubbles!', color: '#b3e5fc', depth: u.depth, dur: 0.7 });
      api.launch({
        fromX: u.x + api.dir(u) * 0.5, toX: cx, speedGrids: A.bubbleSpeedGrids, style: 'bubble_big',
        depth: u.depth, source: u,
        onArrive: () => {
          // Trap every living enemy within trapRadiusGrids of the landing point.
          const trapped = api.foes(u).filter((o) => Math.abs(o.x - cx) <= A.trapRadiusGrids);
          for (const o of trapped) api.trap(o, A.trapSec);
          api.fx({ kind: 'trapbubble', x: cx, rGrids: A.trapRadiusGrids, color: '#81d4fa', dur: A.trapSec });
          api.later(A.trapSec, () => {
            // Pop: splash every enemy within popRadiusGrids (works even if Pela has died).
            for (const o of api.foes(u)) {
              if (Math.abs(o.x - cx) <= A.popRadiusGrids) api.damage(o, u.type.damage * A.popDamageMult, u);
            }
            api.fx({ kind: 'pop', x: cx, rGrids: A.popRadiusGrids, color: '#b3e5fc', big: true, dur: 0.5 });
            api.fx({ kind: 'text', x: cx, text: 'POP!', color: '#e1f5fe', dur: 0.7 });
          });
        },
      });
    },
  },

  // ---- Hera (Valkyrie SR Ranger): two quick arrows, an extra burst on top of her attack rhythm ----
  // offCycle (config): castable whether or not her normal attack is ready; her attack timer is NOT reset;
  // api.burst blocks a normal attack from starting until the last arrow has left.
  nimble_shot: {
    canUse(u, A, api) { return !!api.currentTarget(u); },   // an enemy within her attack range
    use(u, A, api) {
      const first = api.currentTarget(u);
      const n = Math.max(1, A.arrows || 2);
      api.burst(u, A.gapSec * (n - 1) + 1e-6);
      api.fx({ kind: 'nimble', src: u, x: u.x, depth: u.depth, dur: A.fxSec || 0.3 });
      api.shoot(u, first, A.damageMult);
      for (let i = 1; i < n; i++) {
        api.later(A.gapSec * i, () => {
          if (!api.canAct(u)) return;                       // died / stunned / trapped mid-burst: rest skipped
          // Same target while it lives; if it fell (or arrows already in flight will finish it), the next
          // valid target in range; else skipped.
          let t = first.hp > 0 && !api.doomed(first) ? first : null;
          if (!t) t = api.foes(u).filter((o) => o !== first && !api.doomed(o) && api.dist(u, o) <= u.type.rangeGrids)
            .sort((a, b) => api.dist(u, a) - api.dist(u, b))[0] || null;
          if (t) api.shoot(u, t, A.damageMult);
        });
      }
    },
  },

  // ---- Grey (Valkyrie SR Defender): shield charge that shoves everyone he runs into ----
  // (A different ability from the generic shield_bash above.) The engine resolves the charge each tick
  // (api.charge): bumped enemies are hit once per charge, knocked back smoothly (clamped at their own
  // tower; ccImmune units aren't moved) and their attack wind-up restarts. Towers are unaffected.
  grey_shield_bash: {
    canUse(u, A, api) {           // an enemy within triggerGrids IN FRONT of him
      return api.foes(u).some((o) => { const a = api.ahead(u, o); return a >= -0.5 && a <= A.triggerGrids; });
    },
    use(u, A, api) {
      api.charge(u, {
        left: A.chargeGrids, speed: A.chargeSpeedGrids,
        knockGrids: A.knockbackGrids, knockSec: A.knockbackSec,
        damage: u.type.damage * (A.damagePct || 0) / 100,
        interrupt: A.interruptsAttack !== false,
      });
    },
  },

  // ---- Brawn (Deva SR Defender): Endure. Plants his shield; the engine does the rest (api.endure): no walking,
  // keeps attacking, damage reduction, and direct attackers are knocked back (Grey's knockback code). ----
  endure: {
    canUse(u, A, api) { return api.foes(u).some((o) => api.dist(u, o) <= u.type.rangeGrids); },   // an enemy within his range
    use(u, A, api) { api.endure(u, A); },
  },

  // ---- Ranger SSR: AoE on the most crowded spot within range ----
  arrow_rain: {
    canUse(u, A, api) { return api.foes(u).some((o) => api.dist(u, o) <= u.type.rangeGrids); },
    use(u, A, api) {
      const inRange = api.foes(u).filter((o) => api.dist(u, o) <= u.type.rangeGrids);
      let center = null, bestCount = -1, bestD = Infinity;
      for (const c of inRange) {
        const n = inRange.filter((o) => api.dist(o, c) <= A.radiusGrids).length;
        const d = api.dist(u, c);
        if (n > bestCount || (n === bestCount && d < bestD)) { bestCount = n; bestD = d; center = c; }
      }
      const cx = center.x;
      for (const o of api.foes(u)) {
        if (Math.abs(o.x - cx) <= A.radiusGrids) api.damage(o, u.type.damage * A.damageMult, u);
      }
      api.fx({ kind: 'rain', x: cx, rGrids: A.radiusGrids, color: '#ffe082', dur: 0.6 });
    },
  },
};
