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

  // ---- Economy: ACTION POINTS (AP), set by the boss. SAME rules for the player and the enemy AI ----
  // Each side starts with `start` AP and gains `perSec` AP per second up to `max`. AP are spent in whole
  // numbers (unit costs: STAT_STANDARD.apCostByRarity); the internal pool is fractional so the gauge can
  // show progress toward the next pip.
  AP: {
    start: 3,
    perSec: 1,
    max: 10,      // confirmed by the boss
  },

  // ---- Enemy AI ----
  // The enemy earns AP exactly like the player (CONFIG.AP) and buys from its roster.
  // It picks its next unit by ENEMY_WEIGHT (rarity weight x unit weight) and saves up for it.
  ENEMY_FIRST_SPAWN_SEC: 3,       // AI pacing: never spawns before this (it still earns AP meanwhile)

  // ---- Combat rules ----
  NO_PASS_GAP_GRIDS: 1,           // a unit can never walk closer than this to/through a living enemy

  // =====================================================================================
  // ---- STAT STANDARD (set by the boss) — HP and damage per hit come ONLY from here ----
  // =====================================================================================
  // No rarity multipliers and no per-slot / per-unit overrides for hp or damage: the unit
  // builder below reads these tables directly (an hp/damage override is ignored with a warning).
  // Ability damage that scales from damage per hit (Cleave 130%, Dash Strike 250%, Pela's pop
  // 120%, ...) follows these values automatically.
  STAT_STANDARD: {
    // HP per class: the SAME for every rarity.
    hpByClass: { striker: 100, defender: 150, ranger: 75 },   // ranger 75: boss update (was 50)
    // Damage per hit, by rarity then class.
    damageByRarity: {
      // Boss update (12:32): ALL Rangers 10 per hit (was 15); Defenders +10 (Common 15, SR/SSR 20).
      common: {
        striker:  5,
        defender: 15,  // was 5 (+10, boss)
        ranger:   10,  // ALL Rangers deal 10 (was 15)
      },
      sr:  { striker: 10, defender: 20, ranger: 10 },   // Defender 20 (was 10), Ranger 10 (was 15)
      ssr: { striker: 10, defender: 20, ranger: 10 },   // Defender 20 (was 10), Ranger 10 (was 15)
    },
    // Spawn cost in AP, by rarity (same for every class and faction). A unit may set `apCost` in
    // FACTION_UNITS (or a roster slot) for a future "some units cost more" exception.
    apCostByRarity: {
      common: 2,    // ALL Common units
      sr:     3,    // ALL SR units (incl. Dia, Raven, Pela)
      ssr:    5,    // ALL SSR units (confirmed by the boss)
    },
  },

  // ---- Classes: base stats (everything except HP / damage, which are in STAT_STANDARD) ----
  //   speedGrids            : grids moved per second
  //   rangeGrids            : attacks when an enemy unit/tower is within this many grids
  //   cooldownSec           : seconds between attacks
  //   armor                 : fraction of incoming damage ignored (0..1)
  //   blockGrids            : DEFENDER ZONE OF CONTROL. Any enemy within this many grids of a
  //                           living defender is HELD: it cannot walk on and must attack that
  //                           defender (it may not ignore it to hit something else).
  //   ranged / projectileSpeedGrids : attacks fire a projectile (grids per second)
  CLASSES: {
    striker: {
      name: 'Striker', tag: 'STR', color: '#ffb74d',
      desc: 'Damage dealer with balanced health. Short range.',
      speedGrids: 3.5, rangeGrids: 1.8, cooldownSec: 1.0,
      armor: 0,
    },
    defender: {
      name: 'Defender', tag: 'DEF', color: '#90a4ae',
      desc: 'High health, 25% armor. Enemies in its zone of control must stop and fight it.',
      // BOSS RULE: defenders attack LESS often than everyone else. The defender attack interval
      // must stay ABOVE the striker (1.0 s) and ranger (1.4 s) intervals. (Checked at load:
      // a console warning fires if a future tweak breaks it.)
      speedGrids: 2.2, rangeGrids: 1.5, cooldownSec: 1.6,
      armor: 0.25, blockGrids: 1.5,
    },
    ranger: {
      name: 'Ranger', tag: 'RNG', color: '#aed581',
      desc: 'Attacks from far away with projectiles. Low health.',
      speedGrids: 3.0, rangeGrids: 9, cooldownSec: 1.4,
      armor: 0, ranged: true, projectileSpeedGrids: 40,
    },
  },

  // ---- Rarities: visuals / AI weight / cap (HP, damage and AP cost come from STAT_STANDARD) ----
  //   enemyWeight : how often the enemy AI picks units of this rarity (relative)
  //   sizeMult    : placeholder square size (visual only)
  //   pips        : rarity marker pips drawn on the unit (visual only)
  //   stars       : rarity stars shown in the spawn menu (ui_stars_<rarity>.png; visual only)
  //   maxAlive    : max units of this rarity ALIVE at once PER SIDE (all classes combined);
  //                 null/absent = no cap. Applies to the player and the enemy AI alike.
  RARITIES: {
    common: { name: 'Common', short: 'C',   color: '#9e9e9e', glow: null, stars: 1, maxAlive: 3,
              enemyWeight: 6,   sizeMult: 1.0,  pips: 1 },
    sr:     { name: 'SR',     short: 'SR',  color: '#9ecbff', glow: null, stars: 2,
              enemyWeight: 2.5, sizeMult: 1.12, pips: 2 },
    ssr:    { name: 'SSR',    short: 'SSR', color: '#ffd54f', glow: '#ffd54f', stars: 3,
              enemyWeight: 1,   sizeMult: 1.25, pips: 3 },
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
  // Order = spawn-menu order: grouped by rarity (Common, SR, SSR), each in class order
  // (Striker, Defender, Ranger). Hotkeys follow it: Common 1-3, SR 4-6, SSR 7-9.
  //   overrides: optional per-slot stat overrides (final values; NOT hp / damage / cost, see STAT_STANDARD)
  //   apCost   : optional AP cost exception for this slot (default STAT_STANDARD.apCostByRarity)
  //   ability  : id from ABILITIES, or null (Commons have none)
  //   key      : keyboard shortcut (player roster); Shift+key casts that slot's ability
  ROSTER_SLOTS: [
    { class: 'striker',  rarity: 'common', ability: null,            key: '1' },
    { class: 'defender', rarity: 'common', ability: null,            key: '2' },
    { class: 'ranger',   rarity: 'common', ability: null,            key: '3' },
    { class: 'striker',  rarity: 'sr',     ability: 'cleave',        key: '4' },
    { class: 'defender', rarity: 'sr',     ability: 'shield_bash',   key: '5' },
    { class: 'ranger',   rarity: 'sr',     ability: 'piercing_shot', key: '6', overrides: { rangeGrids: 10 } },
    { class: 'striker',  rarity: 'ssr',    ability: 'dash_strike',   key: '7', overrides: { speedGrids: 4 } },
    { class: 'defender', rarity: 'ssr',    ability: 'fortress',      key: '8' },
    { class: 'ranger',   rarity: 'ssr',    ability: 'arrow_rain',    key: '9', overrides: { rangeGrids: 11 } },
  ],

  // ---- Per-faction unit identity (ALL NAMES ARE PLACEHOLDERS until the backstory lands) ----
  // Unit id = art file prefix. Default id: <faction>_<rarity>_<class> (e.g. elf_ssr_ranger);
  // the SR units use the ids the artist delivered: <faction>_<class> (e.g. elf_ranger).
  //   spriteSize: draw size of the sprite frames in px (default: by class, see assets.js)
  //   art: optional art file prefix if different from id (lets a faction borrow another's art)
  //   Named characters can also customise their kit while keeping the slot's stats:
  //   ability   : replaces the slot's ability (id from ABILITIES, or null for none)
  //   projectile: projectile style for ranged attacks (id from PROJECTILES; default 'arrow')
  //   overrides : per-unit stat overrides applied after the slot's overrides (use sparingly; NOT hp / damage / cost)
  //   apCost    : optional AP cost exception for this unit (future "some units cost more")
  //   bio       : short character note (shown in the tooltip + info panel)
  //   flavor    : one-line flavor text for the unit info panel (from Petra's STORY.md; copied here,
  //               STORY.md is never loaded at runtime)
  //   onHit     : statuses added by each NORMAL attack that hits a unit, e.g. { lifesteal: 1 }
  //               (stacks per hit; towers are immune). See STATUSES.
  //   hitFrame  : attack-strip frame index on which the hit lands (default 0). The strip is
  //               rotated so this frame shows at the moment of the hit; frames before it read
  //               as the wind-up leading into the next hit. Art-only; does not change timing.
  FACTION_UNITS: {
    valkyrie: {
      striker:  { common: { name: 'Valkyrie Footman (placeholder)', art: 'elf_common_striker' },
                  sr:     { name: 'Dia', id: 'valkyrie_dia', spriteSize: 64,
                            ability: 'rallying_charge',
                            bio: 'Main character. Her battle cry lights up the squad.',
                            flavor: 'The youngest blade of the sisterhood. Too honest to stay quiet, too kind to stay out of the fight.' },
                  ssr:    { name: 'Valkyrie SSR Striker (placeholder)', art: 'elf_ssr_striker' } },
      defender: { common: { name: 'Valkyrie Shieldbearer (placeholder)', art: 'elf_common_defender' },
                  sr:     { name: 'Grey', id: 'valkyrie_defender', spriteSize: 64,   // own art (Mia): valkyrie_defender_*.png
                            ability: 'grey_shield_bash',
                            bio: 'A young plate-armored knight with a huge round shield and a double-bladed axe.',
                            flavor: "He knocked on the Valkyries' gate every day for a year. Now nothing gets past him." },   // Petra, STORY.md
                  ssr:    { name: 'Valkyrie SSR Defender (placeholder)', art: 'elf_ssr_defender' } },
      ranger:   { common: { name: 'Valkyrie Archer (placeholder)', art: 'elf_common_ranger' },
                  sr:     { name: 'Hera', id: 'valkyrie_ranger', spriteSize: 64,   // own art (Mia): valkyrie_ranger_*.png
                            ability: 'nimble_shot',
                            bio: 'Half human, half angel, with a single wing. A blunt, cheerful tomboy with a sharp eye.',
                            flavor: 'One wing, two arrows, zero patience. She never learned to fly, so she learned never to miss.' },
                  ssr:    { name: 'Valkyrie SSR Ranger (placeholder)', art: 'elf_ssr_ranger' } },
    },
    deva: {
      striker:  { common: { name: 'Deva Footman (placeholder)', art: 'darkelf_common_striker' },
                  sr:     { name: 'Raven', id: 'deva_raven', spriteSize: 64,
                            ability: 'dark_cloud', onHit: { lifesteal: 1 },
                            bio: 'Dia\'s foil. Her strikes leave a draining curse that feeds her.',
                            flavor: 'A nun who stopped believing the sermons but kept the habit. She takes what she\'s owed, one drop at a time.' },
                  ssr:    { name: 'Deva SSR Striker (placeholder)', art: 'darkelf_ssr_striker' } },
      defender: { common: { name: 'Deva Shieldbearer (placeholder)', art: 'darkelf_common_defender' },
                  sr:     { name: 'Brawn', id: 'deva_defender', spriteSize: 64,   // own art (Mia): deva_defender_*.png
                            ability: 'endure',
                            hitFrame: 2,   // attack strip: 0-1 wind-up, 2 hit (red arc), 3 follow-through
                            bio: 'A mortal ex-pit fighter with pale tattoos on both bare arms, a big shield and a spiked mace.',
                            flavor: "Every tattoo is a fight he walked away from. He's running out of room." },   // Petra
                  ssr:    { name: 'Deva SSR Defender (placeholder)', art: 'darkelf_ssr_defender' } },
      ranger:   { common: { name: 'Deva Archer (placeholder)', art: 'darkelf_common_ranger' },
                  sr:     { name: 'Pela', id: 'deva_ranger', spriteSize: 64,
                            ability: 'bubble_trap', projectile: 'bubble',
                            bio: 'Timid elf girl who values her friends, but gets excited causing mayhem. Fights with water bubbles.',
                            flavor: 'Shy, sweet, fiercely loyal, and a little too delighted when things go pop.' },
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
    grey_shield_bash: {   // Grey (Valkyrie SR Defender). NOT the Deva SR Defender's shield_bash above.
      name: 'Shield Bash', cooldownSec: 20, firstCooldownSec: 2,
      triggerGrids: 2.5,       // cast condition: an enemy within this many grids IN FRONT of him
      chargeGrids: 2,          // he charges forward up to this far (stops early at the enemy tower)
      chargeSpeedGrids: 10,    // charge speed, grids per second (2 grids = 0.2 s)
      knockbackGrids: 3,       // every enemy he bumps into is shoved this far (clamped at its own tower)
      knockbackSec: 0.25,      // ...as a smooth push over this long (not a teleport)
      damagePct: 0,            // % of his damage per hit dealt to each bumped enemy (0 = no damage)
      interruptsAttack: true,  // a shoved unit's attack wind-up restarts (its attack timer goes back to full)
      offCycle: true,          // a charge is a move, not a swing: castable whenever ready (no wait for his slow
                               // 1.6 s attack timer), and does NOT reset his attack timer; he can't attack while charging
      desc: 'Charges forward with his shield up. Every enemy he runs into is knocked back and its attack is interrupted; he keeps going to the end of the charge.',
    },
    endure: {   // Brawn (Deva SR Defender)
      name: 'Endure', cooldownSec: 15, firstCooldownSec: 3,   // cooldown 15 s: PLACEHOLDER (boss)
      durationSec: 5,          // he plants the shield: no walking for 5 s, but keeps attacking whatever is in range
      damageReduction: 0.2,    // takes 20% less damage while it lasts (true damage, e.g. Life Steal ticks, ignores it
                               // like it ignores armor and auras)
      knockbackGrids: 1,       // every enemy whose DIRECT attack hits him (melee hit or arrow; not DoT / AoE abilities)
      knockbackSec: 0.15,      // is shoved back 1 grid over 0.15 s (Grey's knockback: clamped at towers, ccImmune immune)
      interruptsAttack: true,  // ...and its attack wind-up restarts (attack timer back to full)
      offCycle: true,          // a stance, not a swing: castable whenever ready, doesn't cost him an attack
      slamFxSec: 0.33, knockFxSec: 0.33,
      desc: 'Plants his shield and stands his ground: takes less damage, and every enemy whose attack hits him is knocked back.',
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
    nimble_shot: {   // Hera (Valkyrie SR Ranger). Replaces Piercing Shot.
      name: 'Nimble Shot', cooldownSec: 5, firstCooldownSec: 2,   // cooldown 5 s: boss said "for now"
      arrows: 2,          // arrows per cast, each a normal attack hit (standard projectile, onHit applies)
      gapSec: 0.15,       // time between arrows
      damageMult: 1.0,    // per arrow (100% = her damage per hit)
      offCycle: true,     // extra burst ON TOP of her attack rhythm: castable whether or not her normal attack
                          // is ready, does NOT reset her attack timer; no normal attack starts during the burst
      fxSec: 0.3,         // fx_nimble_shot.png (4 frames) play time at her bow
      desc: 'Fires two arrows in quick succession at her current target, each a normal hit. If the target falls after the first arrow, the second goes to the next enemy in range (or is skipped).',
    },
    arrow_rain: {
      name: 'Arrow Rain', cooldownSec: 9, firstCooldownSec: 2,
      radiusGrids: 3, damageMult: 1.8,
      desc: 'Rains arrows on the most crowded spot in range: 180% damage to every enemy within 3 grids.',
    },
  },

  // ---- Floating damage numbers (visual only) ----
  // Toggle in game with key N (or the "123" button on phones); the choice is saved in
  // localStorage and overrides this default.
  SHOW_DAMAGE_NUMBERS: true,
  DAMAGE_NUMBERS: {
    maxActive: 40,           // anti-clutter: oldest numbers are dropped beyond this
    maxPerTarget: 4,         // anti-clutter: max numbers over one unit; fresh ones fan out sideways/up
    durationSec: 0.6,        // float + fade time
    risePx: 12,              // how far a number floats up
    jitterPx: 3,             // random x offset (+/-) so stacked hits don't sit on top of each other
    mergeSec: 0.25,          // life steal ticks (red) / heals (green) on the same unit within this window merge into one number
    hitScale: 2,             // direct hits (white) drawn at 2x; DoT (red) and heals (green) at 1x
    dotScale: 1,
    healScale: 1,
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
 * (HP / damage / AP cost from STAT_STANDARD; other stats = class base + slot / unit overrides).
 * CONFIG.UNIT_TYPES holds all of them;
 * CONFIG.rosterOf(factionId) gives one faction's 9 units in slot order.
 * `cost` = spawn cost in AP (whole number): ident.apCost ?? slot.apCost ?? STAT_STANDARD.apCostByRarity.
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
    const STD = CONFIG.STAT_STANDARD;
    const stdHp = STD.hpByClass[slot.class];
    const stdDmg = (STD.damageByRarity[slot.rarity] || {})[slot.class];
    if (stdHp == null) throw new Error(`STAT_STANDARD.hpByClass: missing ${slot.class}`);
    if (stdDmg == null) throw new Error(`STAT_STANDARD.damageByRarity: missing ${slot.rarity}.${slot.class}`);
    const apCost = ident.apCost != null ? ident.apCost : slot.apCost != null ? slot.apCost : STD.apCostByRarity[slot.rarity];
    if (!(apCost >= 0)) throw new Error(`STAT_STANDARD.apCostByRarity: missing ${slot.rarity}`);
    const t = {
      id: ident.id || `${factionId}_${slot.rarity}_${slot.class}`,
      art: ident.art || ident.id || `${factionId}_${slot.rarity}_${slot.class}`,
      name: ident.name || `${faction.name} ${rar.name} ${cls.name}`,
      key: slot.key,
      factionId, faction,
      classId: slot.class,
      rarityId: slot.rarity,
      cls, rarity: rar,
      hp: stdHp,          // STAT_STANDARD (same for every rarity)
      damage: stdDmg,     // STAT_STANDARD
      speedGrids: cls.speedGrids,
      rangeGrids: cls.rangeGrids,
      cooldownSec: cls.cooldownSec,
      cost: Math.round(apCost),   // AP (STAT_STANDARD.apCostByRarity or an apCost exception)
      armor: cls.armor || 0,
      blockGrids: cls.blockGrids || 0,
      ranged: !!cls.ranged,
      projectileSpeedGrids: cls.projectileSpeedGrids || 0,
      // Named characters may replace the slot's ability (ident.ability, null = none).
      ability: ('ability' in ident ? ident.ability : slot.ability) || null,
      projectile: cls.ranged ? (ident.projectile || 'arrow') : null,
      bio: ident.bio || null,
      flavor: ident.flavor || null,
      ccImmune: !!ident.ccImmune,   // future bosses: immune to stun / trap
      onHit: ident.onHit || null,   // e.g. { lifesteal: 1 }: statuses added by normal hits
      hitFrame: ident.hitFrame | 0,   // attack-strip frame shown when the hit lands (art only)
      enemyWeight: rar.enemyWeight * (slot.enemyWeight || 1),
      color: cls.color,
      sizePx: Math.round({ striker: 22, defender: 28, ranger: 18 }[slot.class] * rar.sizeMult),
      spriteSize: ident.spriteSize || null,
      factionColoredArt: !!faction.factionColoredArt,
      short: cls.tag[0],   // letter drawn on the placeholder square
    };
    // Overrides may tune anything EXCEPT hp / damage / cost (the boss's standard is authoritative;
    // a cost exception goes in `apCost` on the unit or slot, not in overrides).
    for (const ov of [slot.overrides || {}, ident.overrides || {}]) {
      for (const [k, v] of Object.entries(ov)) {
        if (k === 'hp' || k === 'damage' || k === 'cost') {
          if (typeof console !== 'undefined') console.warn(`[config] ${t.id}: ${k} override ignored (STAT_STANDARD${k === 'cost' ? '; use apCost' : ''})`);
          continue;
        }
        t[k] = v;
      }
    }
    if (t.ability && !CONFIG.ABILITIES[t.ability]) throw new Error(`Unit ${t.id}: unknown ability ${t.ability}`);
    for (const st of Object.keys(t.onHit || {})) if (!CONFIG.STATUSES[st]) throw new Error(`Unit ${t.id}: unknown onHit status ${st}`);
    if (t.projectile && !CONFIG.PROJECTILES[t.projectile]) throw new Error(`Unit ${t.id}: unknown projectile ${t.projectile}`);
    CONFIG.UNIT_TYPES.push(t);
  }
}
// Boss rule guard: defender attack interval must stay above striker and ranger.
(function checkDefenderInterval() {
  const C = CONFIG.CLASSES, d = C.defender.cooldownSec;
  if (!(d > C.striker.cooldownSec && d > C.ranger.cooldownSec)) {
    console.warn(`[config] boss rule broken: defender attack interval (${d} s) must be above striker (${C.striker.cooldownSec} s) and ranger (${C.ranger.cooldownSec} s)`);
  }
})();
CONFIG.rosterOf = (factionId) => CONFIG.UNIT_TYPES.filter((t) => t.factionId === factionId);
// Backwards-compatible alias (older code / console snippets use CHARACTERS).
CONFIG.CHARACTERS = CONFIG.UNIT_TYPES;
