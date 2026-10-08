# Units (v3: Valkyries vs Deva, named characters)

All numbers live in `config.js`. **HP, damage per hit and AP cost come only from the boss's
`CONFIG.STAT_STANDARD`** (no rarity multipliers, no per-unit HP/damage/cost overrides). Speed, range, cooldown,
armor and abilities come from the class, plus optional roster-slot overrides (marked *). Distances are in **grids** (1 grid = 10 px; the stage is 100 grids,
and each tower front is 6 grids from its edge). Speed is in grids per second.

Factions: **Valkyries** (player, left) vs **Deva** (angels, enemy AI, right). Both have the same 9
roster slots, so stats are mirrored. Only names, art and (for named characters) kits differ. Units
marked *(placeholder)* borrow High Elf / Dark Elf art through the `art` field until their own art lands.
The High Elf and Dark Elf factions are still in `config.js` (switch `PLAYER_FACTION` / `ENEMY_FACTION`).

**Spawn menu / hotkeys are grouped by rarity:** Common = keys **1–3**, SR = **4–6**, SSR = **7–9**, each in class order
Striker, Defender, Ranger (the table below is grouped by class; the Key column shows the new keys). Every portrait shows
its rarity stars (top-left), class badge (bottom-right: red sword / blue shield / green bow) and AP cost with Mia's AP crystal (bottom-left).

## Stat standard (boss) — `CONFIG.STAT_STANDARD`
| | Striker | Defender | Ranger |
|---|---|---|---|
| **HP** (every rarity) | 100 | 150 | 75 |
| **Damage / hit, Common** | 5 | 15 | 10 |
| **Damage / hit, SR** | 10 | 20 | 10 |
| **Damage / hit, SSR** | 10 | 20 | 10 |

Boss update (12:32): **all Rangers 10 per hit** (was 15); **Defenders +10** (Common 15, was 5; SR/SSR 20, was 10).

**AP cost** (`STAT_STANDARD.apCostByRarity`): **Common 2 · SR 3 (incl. Dia, Hera, Raven, Pela) · SSR 5**. A future "this unit costs
more" exception goes in `apCost` on the unit (`FACTION_UNITS`) or roster slot. An `hp` / `damage` / `cost` key inside
`overrides` is ignored with a console warning.

**Action points** (`CONFIG.AP`, same rules for the player and the enemy AI): start **3 AP**, **+1 AP per second**, max **10 AP**.
AP are spent in whole numbers; the pool fills continuously, so the HUD gauge (10 pips, `ui_ap_pip.png`) shows the next pip
charging. Spawn buttons you can't afford grey out; the Commons cap still applies (a blocked spawn costs nothing).

Ability damage scales from damage per hit, so it follows the standard automatically (Cleave 130%, Dash Strike 250% + 50%
splash, Shield Bash 150%, Piercing Shot 160%, Bubble Trap pop 120%, Arrow Rain 180%). **The only flat damage number is
Life Steal: 1 HP/s per stack for 5 s (true damage)**, used by Raven's hits and Dark Cloud; it doesn't scale.

**Commons cap:** at most **3 Common units alive at once per side** (all Common classes combined;
`CONFIG.RARITIES.common.maxAlive`). A blocked spawn costs nothing and shows "Max 3 commons"; the Common buttons show
`n/3` and grey out while capped; dying units free the slot. The enemy AI follows the same cap and buys something else instead.

**Flavor text** in the unit info panel comes from Petra's `STORY.md` (copied into the `flavor` field in
`FACTION_UNITS`; `STORY.md` itself isn't loaded by the game).

**Named characters so far (each has their own kit, see below):** **Dia** (`valkyrie_dia`, Valkyrie SR Striker),
**Grey** (`valkyrie_defender`, Valkyrie SR Defender), **Hera** (`valkyrie_ranger`, Valkyrie SR Ranger), **Raven** (`deva_raven`, Deva SR Striker), **Brawn** (`deva_defender`, Deva SR Defender) and **Pela** (`deva_ranger`, Deva SR Ranger).

| Key | Class | Rarity | Valkyries (id) | Deva (id) | HP | DMG | Cooldown (s) | DPS | Speed (g/s) | Range (g) | Cost (AP) | Ability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Striker | Common | Valkyrie Footman (`valkyrie_common_striker`) | Deva Footman (`deva_common_striker`) | 100 | 5 | 1.0 | 5.0 | 3.5 | 1.8 | 2 | none |
| 4 | Striker | SR | **Dia** (`valkyrie_dia`) | **Raven** (`deva_raven`) | 100 | 10 | 1.0 | 10.0 | 3.5 | 1.8 | 3 | Slot default **Cleave** (hits every enemy up to 2.5 grids in front for 130% damage = 13, 5 s cooldown; used by e.g. the High/Dark Elf SR strikers). Dia: **Rallying Charge**; Raven: **Life Steal** hits + **Dark Cloud** (below). |
| 7 | Striker | SSR | Valkyrie SSR Striker (`valkyrie_ssr_striker`) | Deva SSR Striker (`deva_ssr_striker`) | 100 | 10 | 1.0 | 10.0 | 4* | 1.8 | 5 | **Dash Strike**: dashes up to 6 grids to an enemy within 7 grids and hits it for 250% damage (25), plus 50% (5) to enemies within 1.5 grids of it. Can't dash through enemies. 8 s cooldown. |
| 2 | Defender | Common | Valkyrie Shieldbearer (`valkyrie_common_defender`) | Deva Shieldbearer (`deva_common_defender`) | 150 | 15 | 1.6 | 9.4 | 2.2 | 1.5 | 2 | none (class traits only) |
| 5 | Defender | SR | **Grey** (`valkyrie_defender`) | **Brawn** (`deva_defender`) | 150 | 20 | 1.6 | 12.5 | 2.2 | 1.5 | 3 | Slot default **Shield Bash** (150% damage = 30 and stuns the target for 1.5 s, 6 s cooldown; used by the High/Dark Elf SR defenders). Grey: his own **Shield Bash** charge (`grey_shield_bash`); Brawn: **Endure** (below). |
| 8 | Defender | SSR | Valkyrie SSR Defender (`valkyrie_ssr_defender`) | Deva SSR Defender (`deva_ssr_defender`) | 150 | 20 | 1.6 | 12.5 | 2.2 | 1.5 | 5 | **Fortress**: passive aura, so allies within 4 grids (itself included) take 25% less damage. Taunt every 8 s: enemies within 5 grids that can reach it must attack it for 3 s. |
| 3 | Ranger | Common | Valkyrie Archer (`valkyrie_common_ranger`) | Deva Archer (`deva_common_ranger`) | 75 | 10 | 1.4 | 7.1 | 3.0 | 9 | 2 | none |
| 6 | Ranger | SR | **Hera** (`valkyrie_ranger`) | **Pela** (`deva_ranger`) | 75 | 10 | 1.4 | 7.1 | 3.0 | 10* | 3 | Slot default **Piercing Shot** (a bolt through every enemy in a line up to full range, 160% damage = 16, 6 s cooldown; used by e.g. the High/Dark Elf SR rangers). Hera: **Nimble Shot**; Pela: **Bubble Trap** (below). |
| 9 | Ranger | SSR | Valkyrie SSR Ranger (`valkyrie_ssr_ranger`) | Deva SSR Ranger (`deva_ssr_ranger`) | 75 | 10 | 1.4 | 7.1 | 3.0 | 11* | 5 | **Arrow Rain**: hits the most crowded spot in range for 180% damage (18) to every enemy within 3 grids. 9 s cooldown. |

**Defender attack interval: 1.6 s for every defender, both factions** (`CONFIG.CLASSES.defender.cooldownSec`). Boss rule:
defenders attack less often than everyone else, so the defender interval must stay above the striker (1.0 s) and ranger
(1.4 s) intervals; `config.js` warns in the console at load if a tweak breaks that. (Was 1.2 s.)

Defender DPS is before the target's armor; hits on a Defender are reduced 25% by its armor (e.g. a Common Striker's 5 → 3.75).

## Controls: manual abilities and Auto
- **Auto is OFF by default.** Your units then only use abilities when you tell them to. Units whose
  ability is ready show a **cyan spark** (`ui_ability_ready.png`) above them (it pulses / dims once you've queued a cast).
  - **Click / tap the unit** on the battlefield (generous hit box), or
  - **Shift+1..9** = the frontmost ready unit of that roster slot (e.g. Shift+4 = frontmost ready Dia/Raven).
  - Targets are picked automatically (same targeting as auto). If the condition isn't met (e.g. no enemy
    in reach) you see a brief **"No target"** and the cooldown is **not** used. If the unit is mid-attack,
    stunned, trapped or hopping, the cast is queued and fires as soon as it can act.
- **Unit info panel:** tapping/clicking a unit whose ability is **not** ready (or with no ability, or any enemy) opens its
  live info panel (HP, statuses, cooldown). **Press and hold** or **right-click** any unit, or a spawn portrait, always opens
  it. All numbers in the panel are computed from `config.js`. The game keeps running underneath. Esc / ✕ / tap outside closes it.
- **AUTO button** (top of the battlefield) or key **A**: your units cast automatically, as before. The enemy
  AI always casts automatically. Balance sims always run with auto.
- Each spawn button with an ability shows a small **cooldown bar** on its portrait for the frontmost unit of
  that type on the field (blue = charging, cyan = ready, pulsing cyan = ready and waiting for you), plus the cyan
  spark in the portrait's top-right corner (tap it to cast).
- **Swap sides:** the **⇄ Play as …** button (top of the battlefield and on the victory/defeat screen), key **F**, or the
  URL `?side=deva` / `?side=valkyrie`. You always play on the left; this swaps which faction is yours. It
  restarts the match. `?auto=1` starts with Auto on.

## Statuses
- **Life Steal** (`CONFIG.STATUSES.lifesteal`): stacking. **Each stack drains 1 HP per second for 5 s**
  (`hpPerStackPerSec: 1`, `tickSec: 1`, `durationSec: 5` = 5 HP per stack). Each stack has its own timer, so a new stack
  doesn't refresh older ones. The drain is **true damage** (ignores armor and Fortress, `trueDamage: true`) and
  **heals the unit that applied it** while that unit is alive (`healSource: true`, capped at its max HP; a
  wisp flies back to the healer). Ticks keep running while stunned or trapped. **Towers are immune.**
  Shown as a blood drop with the stack count above the unit, plus a purple tint and rising motes.
- **Rally (speed buff)**: +5% movement speed. It doesn't stack; re-applying refreshes it. Shown as a gold double chevron left of the HP bar.

## Dia (`valkyrie_dia`): Rallying Charge
Slot stats (SR Striker). **Rallying Charge** replaces Cleave: 10 s cooldown, first use 1 s after spawning. Dia
shouts and light gathers around her, then a gold ring bursts out. **Allies within 2 grids in front of or behind her** (a
4-grid-wide zone centred on her, Dia included) get **+5% movement speed for 6 s**. It doesn't stack; re-casting refreshes. It can always be cast.
- Balance note (measured under the old pre-standard stats): +5% speed is small by design, so Dia trades Cleave's damage
  for it; she won ~41–45% vs an identical Cleave striker. That is **not** compensated, per spec.

## Raven (`deva_raven`): Life Steal + Dark Cloud
*Dia's foil. Her strikes leave a draining curse that feeds her.* Standard SR Striker stats (100 HP, 10 damage, 3 AP); her old
22-damage override was removed with the stat standard.
- **Normal attack:** each hit on a unit also adds **+1 Life Steal** stack (above). Towers get no stacks.
- **Dark Cloud** (replaces Cleave): 8 s cooldown, first use 2 s after spawning. Condition: an enemy within
  4.5 grids in front of her. A dark cloud forms **2 grids in front of her** (radius **2 grids**, lasts **5 s**). Every
  enemy that **is inside when cast or walks in** gets **+1 Life Steal**, **once per unit per cloud**. On cast, Raven
  **hops back 2 grids** toward her own tower (0.2 s; never behind her tower's front, never through enemies).
- Balance (old stats, pre-standard): she was tuned to ~49–54% vs a Cleave SR striker by a 22-damage override, which the
  standard removes. Under the standard her Life Steal (a flat 5 HP per stack) is relatively much stronger against 75–150 HP
  units; see the balance notes in the README / Brian's `sim/REPORT.md`. In a 1v1 she always beats Dia.

## Hera (`valkyrie_ranger`): Nimble Shot
*Half human, half angel, with a single wing. A blunt, cheerful tomboy with a sharp eye.*
Standard SR Ranger stats (75 HP, 10 damage, 1.4 s, 10 grids from the SR-ranger slot, 3 AP), no unit overrides, normal arrows.
Flavor (Petra): "One wing, two arrows, zero patience. She never learned to fly, so she learned never to miss."
- **Nimble Shot** (`CONFIG.ABILITIES.nimble_shot`, replaces Piercing Shot): **5 s cooldown** (boss: "for now"), first use 2 s
  after spawning. Condition: an enemy within her attack range. She fires **2 arrows** (`arrows`) **0.15 s apart** (`gapSec`), each a
  **normal hit for 100% damage** (`damageMult`, the one number to trim): **10 + 10 = 20 burst**, standard arrow projectiles, separate damage numbers.
  Arrow 2 goes to the same target; if that target fell (or the arrows already in flight will finish it), it goes to the
  nearest other enemy in range, or is skipped. If Hera dies or is stunned/trapped during the gap, the second arrow is skipped.
- **Attack timer: NOT reset.** Nimble Shot is an extra burst on top of her normal rhythm (`offCycle: true`): she can cast it
  whether or not her normal attack is ready, her attack timer keeps running, and a normal attack can't start during the 0.15 s
  burst (it fires right after if it came due meanwhile).
- Manual (tap her / the spark / Shift+6) or AUTO like the others. FX: `fx_nimble_shot.png` at her bow (1x, mirrored on the right).
- Balance (Brian's quick sim, `node sim/balance.js --only valkyrie_ranger --quick`), after the 12:32 update (rangers 10 dmg,
  so 10 + 10 burst; defenders 20): duel 44%, single-file 56%, stacked 78%, economy 94% vs the 9 Deva slots (at 15 dmg:
  78 / 89 / 78 / 94%).

## Grey (`valkyrie_defender`): Shield Bash charge
*A young plate-armored knight with a huge round shield and a double-bladed axe.* (Member of Dia's squad.)
Standard SR Defender stats (150 HP, 20 damage, 1.6 s, 25% armor, zone of control 1.5 grids, 3 AP), no unit overrides.
Own art: `valkyrie_defender_walk/attack/death.png` (6/4/4 frames, 64x64, he stands 56 px tall; heavy double-bladed axe chop with a wind-up), portraits.
Flavor (Petra): "He knocked on the Valkyries' gate every day for a year. Now nothing gets past him."
- **Shield Bash** (`CONFIG.ABILITIES.grey_shield_bash`, a new per-unit ability; the High/Dark Elf SR defenders keep the old
  `shield_bash`): **20 s cooldown** (`cooldownSec`), first use 2 s after spawning. Condition: an enemy within **2.5 grids
  in front** of him (`triggerGrids`).
- He **charges forward up to 2 grids** (`chargeGrids`) at **10 grids/s** (`chargeSpeedGrids`, i.e. 0.2 s). Every enemy he runs
  into is **knocked back 3 grids** (`knockbackGrids`): a smooth push over **0.25 s** (`knockbackSec`, ease-out), not a
  teleport. He keeps going and stops at the end of the 2 grids, or earlier at the enemy tower (or against something that
  can't be moved).
  - Each enemy is hit **once per charge**. Damage: `damagePct`% of his damage per bumped enemy, **default 0** (no damage;
    the info panel shows a damage line only when it isn't 0).
  - **Clamped:** nobody is pushed past their own tower's front (or the other tower). Towers are unaffected.
  - **ccImmune** units (future bosses) are hit but not moved, so he stops against them.
  - **Knockback interrupts the attack wind-up** (`interruptsAttack`): the shoved unit can't move, attack or cast during the
    push, and its attack timer restarts from full (its attack animation restarts). A shoved unit's own charge / hop is
    cancelled, and a shoved Defender's zone of control is suspended during the push.
  - **Attack timer:** the charge is a move, not a swing (`offCycle: true`). It fires as soon as it's ready (no wait for his
    slow 1.6 s attack timer) and doesn't reset his attack timer. He can't attack while charging.
- Manual (tap him / the spark / Shift+5) or AUTO like the others.
- FX: `fx_shield_bash_dash.png` (3-frame loop) behind him while he charges; `fx_shield_bash_impact.png` (4 frames, gold
  burst + shockwave) on each bumped enemy as its knockback starts, following it. Both 1x and mirrored on the right side.
- Fair ticks: charges and knockbacks run in their own step after the timers (all chargers move from the same positions,
  then every bump is found, then all knockbacks start), so two Greys charging each other shove each other equally,
  whatever the spawn order.
- Balance (Brian's quick sim, `node sim/balance.js --only valkyrie_defender --quick`, 8 runs per pair vs the 9 Deva slots),
  after the 12:32 stat update (defenders 20 dmg, rangers 10): duel 78%, single-file 78%, stacked 75%, economy 67%. In duels he
  beats everything except Brawn and the Deva SSR Defender. (Before the stat update, at 10 dmg: 56 / 56 / 67 / 56%.)

## Brawn (`deva_defender`): Endure
*A mortal ex-pit fighter with pale tattoos on both bare arms, a big shield and a spiked mace.* (Replaces the borrowed Dark Elf
defender in the Deva SR Defender slot; the old id `deva_sr_defender` is now `deva_defender`.)
Standard SR Defender stats (150 HP, 20 damage, 1.6 s, 25% armor, zone of control 1.5 grids, 3 AP), no unit overrides.
Own art: `deva_defender_walk/attack/death.png` (6/4/4 frames, 64x64; the attack is a mace swing over the shield, hit on frame index 2 via `hitFrame: 2`) + `deva_defender_endure.png`.
Flavor (Petra): "Every tattoo is a fight he walked away from. He's running out of room."
- **Endure** (`CONFIG.ABILITIES.endure`): **15 s cooldown** (placeholder), first use **3 s** after spawning. Condition: an
  enemy within his attack range (1.5 grids). Manual (tap / spark / Shift+5 when you play Deva) or AUTO; the enemy AI uses it.
- He **plants the shield for 5 s** (`durationSec`): no walking (enemies he can't reach stay unreached), but he **keeps
  attacking** whatever is in range. He **takes 20% less damage** (`damageReduction`) meanwhile.
- **Every enemy whose direct attack hits him is knocked back 1 grid** (`knockbackGrids`, over 0.15 s): normal melee hits and
  arrows (including Hera's Nimble Shot arrows, which are normal hits). Not DoT (Life Steal ticks), not AoE ability damage.
  Uses Grey's knockback code: clamped at the attacker's own tower, ccImmune units aren't moved, and the attacker's attack
  wind-up restarts (`interruptsAttack`). One knock per hit (each attacker at most once per tick).
- Choices: Endure starts counting from the tick after the cast (fair ticks: hits in the cast tick aren't reduced or reflected).
  True damage (Life Steal) ignores the 20%, as it ignores armor and the Fortress aura. It's a stance (`offCycle: true`), so
  casting it doesn't cost him an attack. A stun/trap doesn't end it (he stays planted).
- Animation: `deva_defender_endure.png` frame 0 (lift, 0.12 s), 1 (slam, until 0.3 s), then 2-3 braced loop at 4 fps for the
  rest. FX: `fx_endure_slam.png` dust at the shield base once on the slam; `fx_endure_guard.png` gold glint looping over the
  shield face while active; `fx_endure_knock.png` push ring on each attacker as it's shoved. All 1x, mirrored on the right.
  The info panel shows "Endure (x s, −20% damage)" in his status while it's up.
- Balance (Brian's quick sim, `node sim/balance.js --only deva_defender --quick`, vs the 9 Valkyrie slots): duel 89%,
  single-file 94%, stacked 89%, economy 78%. Duels: loses only to the Valkyrie SSR Defender (beats Grey). Stacked: Grey 75%,
  Hera 25% against him. Economy: Hera and the SSR Ranger beat him. (For reference, the placeholder Deva SR Defender with the
  old Shield Bash scored 89 / 78 / 67 / 78% at 10 dmg.)

## Pela (`deva_ranger`): water-bubble kit
*A timid elf girl who values her friends, but gets excited causing mayhem. Her abilities involve water bubbles.*
Her stats are the normal SR Ranger slot (above). Only her attack style and ability differ.

- **Bubble shots (normal attack):** slow, wobbling water bubbles (16 grids/s instead of 40, with ±4 px
  wobble at 2.5 Hz). Same damage as an arrow (10) and they do damage when they land. They pop on hit, or pop
  harmlessly if the target dies first.
- **Bubble Trap (replaces Piercing Shot):** 7 s cooldown, first use 2 s after spawning. She lobs a big
  bubble (14 grids/s) at the **most crowded spot within her range** (10 grids). Every enemy within
  **1.5 grids** of that spot is **trapped for 1.5 s**: it floats inside a bubble and can't move, attack or use
  abilities. When the bubble **pops**, it deals **120% damage (12)** to every enemy within **1.8 grids**. Defender
  armor and Fortress still apply.
  - Trapped units can still be hit. A new trap doesn't stack and just keeps the longer duration. A trapped
    Defender's zone of control is **suspended** (it still physically blocks), and the same now applies
    to a stunned Defender. Stun and trap run down together.
  - **Bosses and towers are unaffected:** units with `ccImmune: true` ignore trap and stun, and towers aren't units.
  - The pop still happens if Pela dies while the bubble is up.
  - Balance (old stats, pre-standard): Pela beat an otherwise identical Piercing Shot ranger in ~51–55% at 120% pop damage.

## Named characters: per-unit kits
A `CONFIG.FACTION_UNITS` entry can give a named character its own kit while it keeps its slot's stats:
`ability: '<id in CONFIG.ABILITIES>'` replaces the slot ability (`null` = none), `projectile: '<id in
CONFIG.PROJECTILES>'` sets the ranged attack style (`arrow` default, `bubble`), and `overrides: { ... }`
tweaks stats (not HP / damage / cost: those are the stat standard; use `apCost` for a cost exception). `onHit: { lifesteal: 1 }` adds statuses with every normal hit on a unit. `bio:` is shown in tooltips, and
`ccImmune: true` is for bosses. Unknown ids are reported at load.
Ability names and descriptions show on spawn-button tooltips (player) and on the **Enemy** roster strip
under the spawn bar (hover a chip).

## Class traits (every rarity)
- **Striker**: 100 HP, short range, fastest attack (1.0 s).
- **Attack intervals:** Striker 1.0 s, Ranger 1.4 s, Defender 1.6 s (boss rule: defenders always the slowest).
- **Defender**: 150 HP, slowest attack (1.6 s), 25% armor (takes 75% damage). **Zone of control**: any enemy within 1.5 grids
  of a living Defender is held. It can't walk on, and it has to attack that Defender instead of
  anything else. Separately, no unit can ever walk through a living enemy (it stops 1 grid
  short), so Defenders form a wall.
- **Ranger**: long range (9–11 grids), 75 HP, 10 damage per hit at every rarity. Fires visible projectiles that do damage when
  they land. If the target dies first, the shot fizzles.

## Rarities
Rarity no longer multiplies HP, damage or cost (see Stat standard).

| Rarity | AP cost | Enemy pick share | Look |
|---|---|---|---|
| Common | 2 | 21% each (63% total) | grey frame, 1 grey pip; max 3 alive per side |
| SR | 3 | 9% each (26% total) | silver-blue frame, 2 pips, ability |
| SSR | 5 | 4% each (11% total) | gold frame with glow, 3 gold pips, glowing unit, ability |

## Abilities: how they fire
Abilities have their own cooldowns and run from data. An ability is used in place of a
normal attack when it is off cooldown, the attack is ready, and its condition holds
(for example, an enemy in the area). This happens automatically for the enemy AI (and for you with Auto on);
otherwise you trigger it yourself (see Controls). The first use comes 1–2 s after spawning. To add one, put
its data in `CONFIG.ABILITIES` and its logic in `abilities.js` under the same id, then set
`ability:` on a roster slot. To add a faction, add it to `CONFIG.FACTIONS` and give its 9 units
names/ids in `CONFIG.FACTION_UNITS`.

## Enemy AI
The enemy uses exactly the player's AP rules (start 3, +1 AP/s, max 10, same costs) and buys from the **Deva** roster
(`ENEMY_FACTION`). It picks its next unit by the weights above (never a capped Common) and saves up until it can afford it.
It doesn't spawn before `ENEMY_FIRST_SPAWN_SEC` (3 s; it keeps earning AP meanwhile).

## Combat resolution (fair ticks)
Every simulation tick runs in two phases so the order units were spawned in never decides an even fight:
**move** (every unit on both sides decides walk/hold from the same positions, then walks), then **act** (abilities,
attacks, cooldowns). Damage dealt during the tick is buffered and applied at the end, so simultaneous attackers both land
and deaths resolve together. Stuns / traps / Life Steal stacks applied during a tick take effect from the next tick.
Charges (Grey's Shield Bash) and knockbacks resolve in their own order-independent step after the timers.
Timers snap to 0 within 1e-9 s, so float drift never adds a tick (a 1.6 s interval is exactly 96 ticks at 60 fps).
Identical units in a mirror now draw regardless of spawn order (Brian's `sim/balance.js` bias check: 9/9 draws).
