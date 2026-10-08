/*
 * config.js — ALL game tunables live here.
 * Change numbers in this file to rebalance the game; game.js reads from CONFIG.
 *
 * GRID SYSTEM (invisible to the player):
 *   A "grid" is the number of pixels it takes to cross one section of the stage.
 *   GRID_COUNT = STAGE_WIDTH_PX / GRID_SIZE_PX
 *   e.g. 1000 px stage / 10 px per grid = 100 grids end to end.
 *   Every speed, range, area and distance is expressed in grids, so balance stays the
 *   same if you later change the stage's pixel size.
 *   Pixels per second = speedGrids * GRID_SIZE_PX.
 *
 * Units = FACTION x ROSTER SLOT. A slot is CLASS base stats x RARITY multipliers
 * (+ optional overrides), identical for every faction; FACTION_UNITS gives each faction's
 * unit its id (= art prefix) and name. To add a unit type: add a ROSTER_SLOT. To add a
 * faction: add it to FACTIONS + FACTION_UNITS. To add an ability: add data to ABILITIES here
 * and a handler with the same id in abilities.js.
 */
const CONFIG = {
  // ---- Stage ----
  STAGE_WIDTH_PX: 1000,     // stage width end to end, in pixels (also the canvas width)
  STAGE_HEIGHT_PX: 400,     // canvas height in pixels (visual only)
  GRID_SIZE_PX: 10,         // pixels per grid
  // GRID_COUNT is computed below (do not edit directly)

  GROUND_Y_PX: 300,         // y position of the ground line units walk on (visual only)

  // ---- Towers ----
  TOWER_HP: 1000,
  TOWER_WIDTH_GRIDS: 6,     // each tower occupies this many grids at its end of the stage

  // ---- Player economy ----
  START_RESOURCE: 50,
  RESOURCE_PER_SEC: 10,
  MAX_RESOURCE: 250,

  // ---- Enemy AI ----
  // The enemy earns resource exactly like the player and buys from the same roster.
  // It picks its next unit by ENEMY_WEIGHT (rarity weight x unit weight) and saves up for it.
  ENEMY_START_RESOURCE: 50,
  ENEMY_RESOURCE_PER_SEC: 10,
  ENEMY_FIRST_SPAWN_SEC: 3,       // never spawns before this

  // ---- Combat rules ----
  NO_PASS_GAP_GRIDS: 1,           // a unit can never walk closer than this to/through a living enemy

  // ---- Classes: base stats (Common level) ----
  //   hp, damage            : hit points / damage per attack
  //   speedGrids            : grids moved per second
  //   rangeGrids            : attacks when an enemy unit/tower is within this many grids
  //   cooldownSec           : seconds between attacks
  //   cost                  : resource cost (before rarity multiplier)
  //   armor                 : fraction of incoming damage ignored (0..1)
  //   blockGrids            : DEFENDER ZONE OF CONTROL. Any enemy within this many grids of a
  //                           living defender is HELD: it cannot walk on and must attack that
  //                           defender (it may not ignore it to hit something else).
  //   ranged / projectileSpeedGrids : attacks fire a projectile (grids per second)
  CLASSES: {
    striker: {
      name: 'Striker', tag: 'STR', color: '#ffb74d',
      desc: 'Damage dealer with balanced health. Short range.',
      hp: 120, damage: 15, speedGrids: 3.5, rangeGrids: 1.8, cooldownSec: 1.0, cost: 50,
      armor: 0,
    },
    defender: {
      name: 'Defender', tag: 'DEF', color: '#90a4ae',
      desc: 'High health, 25% armor. Enemies in its zone of control must stop and fight it.',
      hp: 280, damage: 8, speedGrids: 2.2, rangeGrids: 1.5, cooldownSec: 1.2, cost: 60,
      armor: 0.25, blockGrids: 1.5,
    },
    ranger: {
      name: 'Ranger', tag: 'RNG', color: '#aed581',
      desc: 'Attacks from far away with projectiles. Low health.',
      hp: 65, damage: 13, speedGrids: 3.0, rangeGrids: 9, cooldownSec: 1.4, cost: 55,
      armor: 0, ranged: true, projectileSpeedGrids: 40,
    },
  },

  // ---- Rarities: multipliers applied to the class base stats ----
  //   enemyWeight : how often the enemy AI picks units of this rarity (relative)
  //   sizeMult    : placeholder square size (visual only)
  //   pips        : rarity marker pips drawn on the unit (visual only)
  RARITIES: {
    common: { name: 'Common', short: 'C',   color: '#9e9e9e', glow: null,
              hpMult: 1.0, damageMult: 1.0, costMult: 1.0, enemyWeight: 6,   sizeMult: 1.0,  pips: 1 },
    sr:     { name: 'SR',     short: 'SR',  color: '#9ecbff', glow: null,
              hpMult: 1.6, damageMult: 1.5, costMult: 2.2, enemyWeight: 2.5, sizeMult: 1.12, pips: 2 },
    ssr:    { name: 'SSR',    short: 'SSR', color: '#ffd54f', glow: '#ffd54f',
              hpMult: 2.5, damageMult: 2.2, costMult: 3.6, enemyWeight: 1,   sizeMult: 1.25, pips: 3 },
  },

  // ---- Factions ----
  // Every unit belongs to a faction. The player fields PLAYER_FACTION (left side), the enemy
  // AI fields ENEMY_FACTION (right side). More races (angels, dwarves, ...) = add a faction
  // here + its names in FACTION_UNITS.
  //   factionColoredArt: the art already carries the faction's colours -> no magenta recolour,
  //                      no _blue/_red variants, no tint (the HP bar colour marks the team).
  FACTIONS: {
    valkyrie: { name: 'Valkyries', colors: ['#ff4fa3', '#3d7bd9', '#e8e8f0'], factionColoredArt: true,
               desc: 'Player faction 1. Main character: Dia (squad-level, not faction leader). Units without Valkyrie art yet borrow High Elf art.' },
    deva:    { name: 'Deva', colors: ['#1a1a1a', '#c0c0c8', '#b0182a'], factionColoredArt: true,
               desc: 'Faction 2 (angels). Main character: Raven, Dia\'s foil (squad-level, not faction leader). Units without Deva art yet borrow Dark Elf art.' },
    elf:     { name: 'High Elves', colors: ['#3d7bd9', '#c0c8d8', '#ffd54f'], factionColoredArt: true,
               desc: 'Blue, silver and gold.' },
    darkelf: { name: 'Dark Elves', colors: ['#b0182a', '#1a1a1a', '#5e1224'], factionColoredArt: true,
               desc: 'Crimson and black.' },
  },
  PLAYER_FACTION: 'valkyrie',
  ENEMY_FACTION: 'deva',

  // ---- Roster slots: the same 9 slots for every faction (stats/abilities mirror) ----
  //   overrides: optional per-slot stat overrides (final values, after multipliers)
  //   ability  : id from ABILITIES, or null (Commons have none)
  //   key      : keyboard shortcut (player roster)
  ROSTER_SLOTS: [
    { class: 'striker',  rarity: 'common', ability: null,            key: '1', overrides: { cost: 45 } },
    { class: 'striker',  rarity: 'sr',     ability: 'cleave',        key: '2' },
    { class: 'striker',  rarity: 'ssr',    ability: 'dash_strike',   key: '3', overrides: { speedGrids: 4, hp: 330, cost: 185 } },
    { class: 'defender', rarity: 'common', ability: null,            key: '4' },
    { class: 'defender', rarity: 'sr',     ability: 'shield_bash',   key: '5', overrides: { cost: 115 } },
    { class: 'defender', rarity: 'ssr',    ability: 'fortress',      key: '6' },
    { class: 'ranger',   rarity: 'common', ability: null,            key: '7', overrides: { cost: 45 } },
    { class: 'ranger',   rarity: 'sr',     ability: 'piercing_shot', key: '8', overrides: { rangeGrids: 10 } },
    { class: 'ranger',   rarity: 'ssr',    ability: 'arrow_rain',    key: '9', overrides: { rangeGrids: 11, cost: 210 } },
  ],

  // ---- Per-faction unit identity (ALL NAMES ARE PLACEHOLDERS until the backstory lands) ----
  // Unit id = art file prefix. Default id: <faction>_<rarity>_<class> (e.g. elf_ssr_ranger);
  // the SR units use the ids the artist delivered: <faction>_<class> (e.g. elf_ranger).
  //   spriteSize: draw size of the sprite frames in px (default: by class, see assets.js)
  //   art: optional art file prefix if different from id (lets a faction borrow another's art)
  //   Named characters can also customise their kit while keeping the slot's stats:
  //   ability   : replaces the slot's ability (id from ABILITIES, or null for none)
  //   projectile: projectile style for ranged attacks (id from PROJECTILES; default 'arrow')
  //   overrides : per-unit stat overrides applied after the slot's overrides (use sparingly)
  //   bio       : short character note (shown in the tooltip)
  //   onHit     : statuses added by each NORMAL attack that hits a unit, e.g. { lifesteal: 1 }
  //               (stacks per hit; towers are immune). See STATUSES.
  FACTION_UNITS: {
    valkyrie: {
      striker:  { common: { name: 'Valkyrie Footman (placeholder)', art: 'elf_common_striker' },
                  sr:     { name: 'Dia', id: 'valkyrie_dia', spriteSize: 64,
                            ability: 'rallying_charge',
                            bio: 'Main character. Her battle cry lights up the squad.' },
                  ssr:    { name: 'Valkyrie SSR Striker (placeholder)', art: 'elf_ssr_striker' } },
      defender: { common: { name: 'Valkyrie Shieldbearer (placeholder)', art: 'elf_common_defender' },
                  sr:     { name: 'Valkyrie SR Defender (placeholder)', art: 'elf_defender', spriteSize: 64 },
                  ssr:    { name: 'Valkyrie SSR Defender (placeholder)', art: 'elf_ssr_defender' } },
      ranger:   { common: { name: 'Valkyrie Archer (placeholder)', art: 'elf_common_ranger' },
                  sr:     { name: 'Valkyrie SR Ranger (placeholder)', art: 'elf_ranger', spriteSize: 64 },
                  ssr:    { name: 'Valkyrie SSR Ranger (placeholder)', art: 'elf_ssr_ranger' } },
    },
    deva: {
      striker:  { common: { name: 'Deva Footman (placeholder)', art: 'darkelf_common_striker' },
                  sr:     { name: 'Raven', id: 'deva_raven', spriteSize: 64,
                            ability: 'dark_cloud', onHit: { lifesteal: 1 },
                            overrides: { damage: 22 },   // 23 -> 22 offsets Life Steal (sims: ~49% vs a Cleave SR striker)
                            bio: 'Dia\'s foil. Her strikes leave a draining curse that feeds her.' },
                  ssr:    { name: 'Deva SSR Striker (placeholder)', art: 'darkelf_ssr_striker' } },
      defender: { common: { name: 'Deva Shieldbearer (placeholder)', art: 'darkelf_common_defender' },
                  sr:     { name: 'Deva SR Defender (placeholder)', art: 'darkelf_defender', spriteSize: 64 },
                  ssr:    { name: 'Deva SSR Defender (placeholder)', art: 'darkelf_ssr_defender' } },
      ranger:   { common: { name: 'Deva Archer (placeholder)', art: 'darkelf_common_ranger' },
                  sr:     { name: 'Pela', id: 'deva_ranger', spriteSize: 64,
                            ability: 'bubble_trap', projectile: 'bubble',
                            bio: 'Timid elf girl who values her friends, but gets excited causing mayhem. Fights with water bubbles.' },
                  ssr:    { name: 'Deva SSR Ranger (placeholder)', art: 'darkelf_ssr_ranger' } },
    },
    elf: {
      striker:  { common: { name: 'Elven Footman' },
                  sr:     { name: 'High Elf Bladedancer', id: 'elf_striker',  spriteSize: 64 },
                  ssr:    { name: 'Sunblade Champion' } },
      defender: { common: { name: 'Elven Shieldbearer' },
                  sr:     { name: 'Aegis Warden',         id: 'elf_defender', spriteSize: 64 },
                  ssr:    { name: 'Silver Bastion' } },
      ranger:   { common: { name: 'Elven Archer' },
                  sr:     { name: 'Sylvan Archer',        id: 'elf_ranger',   spriteSize: 64 },
                  ssr:    { name: 'Starfall Ranger' } },
    },
    darkelf: {
      striker:  { common: { name: 'Dark Elf Cutthroat' },
                  sr:     { name: 'Shadow Blade',         id: 'darkelf_striker',  spriteSize: 64 },
                  ssr:    { name: 'Bloodmoon Reaver' } },
      defender: { common: { name: 'Dark Elf Shieldguard' },
                  sr:     { name: 'Obsidian Guard',       id: 'darkelf_defender', spriteSize: 64 },
                  ssr:    { name: 'Doomwall Sentinel' } },
      ranger:   { common: { name: 'Dark Elf Crossbow' },
                  sr:     { name: 'Nightshade Archer',    id: 'darkelf_ranger',   spriteSize: 64 },
                  ssr:    { name: 'Venomstorm Sniper' } },
    },
  },

  // ---- Projectile styles (ranged normal attacks) ----
  //   speedGrids: flight speed (grids/s); null = use the class's projectileSpeedGrids
  //   wobblePx / wobbleHz: visual vertical wobble while flying
  //   popFx: small pop effect where it lands (visual)
  PROJECTILES: {
    arrow:  { speedGrids: null, wobblePx: 0, wobbleHz: 0, popFx: false },
    bubble: { speedGrids: 16, wobblePx: 4, wobbleHz: 2.5, popFx: true, radiusPx: 6 },
  },

  // ---- Statuses (stacking effects on units; towers are immune) ----
  STATUSES: {
    // Life Steal (Raven): every stack drains HP over time from the afflicted unit and
    // heals the unit that applied it.
    lifesteal: {
      name: 'Life Steal',
      hpPerStackPerSec: 1,     // HP drained per stack per second
      tickSec: 1,              // drain is applied in ticks (once per second)
      healSource: true,        // the source (e.g. Raven) heals by the amount drained while alive (capped at max HP)
      trueDamage: true,        // ignores armor and damage-reduction auras
      durationSec: 5,          // lifestealDurationSec: each stack has its OWN timer (new stacks don't refresh old ones);
                               //   it drains once per tickSec while it lasts (5 s = 5 HP per stack). null = until death
      maxStacks: null,         // null = no cap
      desc: 'Each stack drains 1 HP per second for 5 s (true damage) and heals whoever applied it. Stacks have their own timers.',
    },
  },

  // ---- Abilities (data). Logic lives in abilities.js under the same id. ----
  // All areas / distances are in grids. Abilities are cooldown based: when off cooldown and the
  // condition is met, the ability replaces a normal attack: automatically for the enemy AI (and the
  // player with Auto on), otherwise when the player triggers it (click unit / Shift+1..9).
  // firstCooldownSec = delay after spawning before the first use.
  ABILITIES: {
    cleave: {
      name: 'Cleave', cooldownSec: 5, firstCooldownSec: 2,
      areaGrids: 2.5, damageMult: 1.3,
      desc: 'Swings through every enemy up to 2.5 grids in front for 130% damage.',
    },
    dark_cloud: {   // Raven (SR Striker). Replaces Cleave.
      name: 'Dark Cloud', cooldownSec: 8, firstCooldownSec: 2,
      offsetGrids: 2,          // cloud centre, in front of Raven
      radiusGrids: 2,          // enemies within this many grids of the centre are "in the cloud"
      durationSec: 5,
      stacksOnEnter: 1,        // Life Steal stacks, once per enemy per cloud (entering or inside when cast)
      triggerGrids: 4.5,       // condition: an enemy within this many grids in front of Raven
      hopBackGrids: 2,         // Raven hops back toward her own tower (never behind its front)
      hopSec: 0.2,
      desc: 'Conjures a dark cloud 2 grids in front (radius 2 grids, 5 s). Every enemy inside or walking in gets +1 Life Steal (once per cloud). Raven hops back 2 grids.',
    },
    rallying_charge: {   // Dia (SR Striker). Replaces Cleave.
      name: 'Rallying Charge', cooldownSec: 10, firstCooldownSec: 1,
      rangeGrids: 2,           // allies within 2 grids in front of or behind Dia (4-grid-wide zone centred on her, incl. Dia)
      speedBonus: 0.05,        // +5% movement speed (small by design)
      buffSec: 6,              // doesn't stack; re-casting refreshes the duration
      desc: 'Dia shouts and light gathers around her: allies within 2 grids on either side of her (incl. Dia) gain +5% movement speed for 6 s. Doesn\'t stack; re-cast refreshes.',
    },
    dash_strike: {
      name: 'Dash Strike', cooldownSec: 8, firstCooldownSec: 1,
      triggerGrids: 7, dashMaxGrids: 6, damageMult: 2.5, splashGrids: 1.5, splashMult: 0.5,
      desc: 'Dashes up to 6 grids to an enemy within 7 grids and hits it for 250% damage (50% to enemies within 1.5 grids of it).',
    },
    shield_bash: {
      name: 'Shield Bash', cooldownSec: 6, firstCooldownSec: 2,
      damageMult: 1.5, stunSec: 1.5,
      desc: 'Bashes its target for 150% damage and stuns it for 1.5 s.',
    },
    fortress: {
      name: 'Fortress', cooldownSec: 8, firstCooldownSec: 1,
      auraGrids: 4, allyDamageReduction: 0.25,
      tauntGrids: 5, tauntSec: 3,
      desc: 'Aura: allies within 4 grids (incl. itself) take 25% less damage. Taunt: every 8 s, enemies within 5 grids that can reach it must attack it for 3 s.',
    },
    piercing_shot: {
      name: 'Piercing Shot', cooldownSec: 6, firstCooldownSec: 2,
      damageMult: 1.6,
      desc: 'Fires a bolt through every enemy in a line up to its full range for 160% damage.',
    },
    bubble_trap: {   // Pela (SR Ranger). Replaces Piercing Shot; tuned to be roughly equal at SR.
      name: 'Bubble Trap', cooldownSec: 7, firstCooldownSec: 2,
      bubbleSpeedGrids: 14, trapRadiusGrids: 1.5, trapSec: 1.5,
      popRadiusGrids: 1.8, popDamageMult: 1.2,
      desc: 'Launches a big water bubble at the most crowded spot in range. Enemies within 1.5 grids are trapped for 1.5 s (they float and can\'t move or attack), then it pops for 120% damage to enemies within 1.8 grids.',
    },
    arrow_rain: {
      name: 'Arrow Rain', cooldownSec: 9, firstCooldownSec: 2,
      radiusGrids: 3, damageMult: 1.8,
      desc: 'Rains arrows on the most crowded spot in range: 180% damage to every enemy within 3 grids.',
    },
  },

  // ---- Colors ----
  COLORS: {
    sky: '#1b2238',
    ground: '#3b3f2a',
    player: '#3d7bd9',     // left tower / player team tint
    enemy: '#d9443d',      // right tower / enemy team tint
    text: '#ffffff',
  },
};

// Derived value: number of grids across the stage.
CONFIG.GRID_COUNT = CONFIG.STAGE_WIDTH_PX / CONFIG.GRID_SIZE_PX;

/*
 * Resolve the roster: for every faction x roster slot -> final unit type
 * (class base x rarity multipliers + slot overrides). CONFIG.UNIT_TYPES holds all of them;
 * CONFIG.rosterOf(factionId) gives one faction's 9 units in slot order.
 * (Costs round to 5, hp/damage to whole numbers.)
 */
CONFIG.UNIT_TYPES = [];
for (const [factionId, faction] of Object.entries(CONFIG.FACTIONS)) {
  for (const slot of CONFIG.ROSTER_SLOTS) {
    const cls = CONFIG.CLASSES[slot.class];
    const rar = CONFIG.RARITIES[slot.rarity];
    if (!cls) throw new Error(`Roster slot: unknown class ${slot.class}`);
    if (!rar) throw new Error(`Roster slot: unknown rarity ${slot.rarity}`);
    if (slot.ability && !CONFIG.ABILITIES[slot.ability]) throw new Error(`Roster slot: unknown ability ${slot.ability}`);
    const ident = ((CONFIG.FACTION_UNITS[factionId] || {})[slot.class] || {})[slot.rarity] || {};
    const t = {
      id: ident.id || `${factionId}_${slot.rarity}_${slot.class}`,
      art: ident.art || ident.id || `${factionId}_${slot.rarity}_${slot.class}`,
      name: ident.name || `${faction.name} ${rar.name} ${cls.name}`,
      key: slot.key,
      factionId, faction,
      classId: slot.class,
      rarityId: slot.rarity,
      cls, rarity: rar,
      hp: Math.round(cls.hp * rar.hpMult),
      damage: Math.round(cls.damage * rar.damageMult),
      speedGrids: cls.speedGrids,
      rangeGrids: cls.rangeGrids,
      cooldownSec: cls.cooldownSec,
      cost: Math.round((cls.cost * rar.costMult) / 5) * 5,
      armor: cls.armor || 0,
      blockGrids: cls.blockGrids || 0,
      ranged: !!cls.ranged,
      projectileSpeedGrids: cls.projectileSpeedGrids || 0,
      // Named characters may replace the slot's ability (ident.ability, null = none).
      ability: ('ability' in ident ? ident.ability : slot.ability) || null,
      projectile: cls.ranged ? (ident.projectile || 'arrow') : null,
      bio: ident.bio || null,
      ccImmune: !!ident.ccImmune,   // future bosses: immune to stun / trap
      onHit: ident.onHit || null,   // e.g. { lifesteal: 1 }: statuses added by normal hits
      enemyWeight: rar.enemyWeight * (slot.enemyWeight || 1),
      color: cls.color,
      sizePx: Math.round({ striker: 22, defender: 28, ranger: 18 }[slot.class] * rar.sizeMult),
      spriteSize: ident.spriteSize || null,
      factionColoredArt: !!faction.factionColoredArt,
      short: cls.tag[0],   // letter drawn on the placeholder square
    };
    Object.assign(t, slot.overrides || {}, ident.overrides || {});
    if (t.ability && !CONFIG.ABILITIES[t.ability]) throw new Error(`Unit ${t.id}: unknown ability ${t.ability}`);
    for (const st of Object.keys(t.onHit || {})) if (!CONFIG.STATUSES[st]) throw new Error(`Unit ${t.id}: unknown onHit status ${st}`);
    if (t.projectile && !CONFIG.PROJECTILES[t.projectile]) throw new Error(`Unit ${t.id}: unknown projectile ${t.projectile}`);
    CONFIG.UNIT_TYPES.push(t);
  }
}
CONFIG.rosterOf = (factionId) => CONFIG.UNIT_TYPES.filter((t) => t.factionId === factionId);
// Backwards-compatible alias (older code / console snippets use CHARACTERS).
CONFIG.CHARACTERS = CONFIG.UNIT_TYPES;
