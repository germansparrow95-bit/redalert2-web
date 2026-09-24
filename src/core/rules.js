/*
 * Red Alert Web - game rules: armour classes, warheads, unit/building stats,
 * faction rosters and difficulty settings.
 *
 * Everything in here is original data authored for this project.  It follows
 * the *style* of the classic isometric RTS (ore economy, power management,
 * armour/warhead table, build tree) without copying any proprietary asset.
 */
(function (RA) {
  'use strict';

  var Rules = RA.Rules = {};

  Rules.SIM_HZ = 30;
  Rules.TICKS_PER_SEC = 30;
  var sec = function (s) { return Math.round(s * Rules.TICKS_PER_SEC); };

  // ---------------------------------------------------------------------
  // Armour classes & warhead multipliers
  // ---------------------------------------------------------------------
  Rules.ARMOR = ['infantry', 'light', 'heavy', 'concrete', 'air'];

  Rules.WARHEADS = {
    smallArms: { infantry: 1.00, light: 0.35, heavy: 0.20, concrete: 0.30, air: 0.55 },
    ap:        { infantry: 0.25, light: 1.00, heavy: 0.60, concrete: 0.62, air: 0.20 },
    he:        { infantry: 0.65, light: 0.65, heavy: 1.00, concrete: 1.00, air: 0.00 },
    rocket:    { infantry: 0.50, light: 0.95, heavy: 0.70, concrete: 0.60, air: 1.00 },
    flak:      { infantry: 0.55, light: 0.35, heavy: 0.25, concrete: 0.20, air: 1.25 },
    tesla:     { infantry: 1.20, light: 0.85, heavy: 0.60, concrete: 0.60, air: 0.00 },
    prism:     { infantry: 0.60, light: 1.00, heavy: 0.90, concrete: 1.00, air: 0.00 }
  };

  Rules.warheadMultiplier = function (warhead, armor) {
    var row = Rules.WARHEADS[warhead];
    if (!row) return 1;
    var m = row[armor];
    return m === undefined ? 1 : m;
  };

  /** Which domains a warhead can hurt (used by splash damage). */
  Rules.WARHEAD_DOMAINS = {
    smallArms: { ground: true, air: true },
    ap:        { ground: true, air: false },
    he:        { ground: true, air: false },
    rocket:    { ground: true, air: true },
    flak:      { ground: true, air: true },
    tesla:     { ground: true, air: false },
    prism:     { ground: true, air: false }
  };
  Rules.canWarheadHit = function (warhead, target) {
    var d = Rules.WARHEAD_DOMAINS[warhead];
    if (!d) return true;
    return target.def && target.def.flying ? !!d.air : !!d.ground;
  };

  // ---------------------------------------------------------------------
  // Player colours (classic RTS palette)
  // ---------------------------------------------------------------------
  Rules.PLAYER_COLORS = [
    { id: 'gold',   name: 'Gold',       hex: '#e8c341', dark: '#8a6d16', light: '#ffe89a' },
    { id: 'red',    name: 'Red',        hex: '#d63a2f', dark: '#7a1a13', light: '#ff8b7c' },
    { id: 'blue',   name: 'Blue',       hex: '#3f6fe0', dark: '#1c3578', light: '#8fb0ff' },
    { id: 'green',  name: 'Green',      hex: '#49a942', dark: '#1f5a1b', light: '#9ce096' },
    { id: 'orange', name: 'Orange',     hex: '#e08a2a', dark: '#7a4410', light: '#ffc180' },
    { id: 'sky',    name: 'Sky Blue',   hex: '#57c9e0', dark: '#1d6d80', light: '#a9edf7' },
    { id: 'purple', name: 'Purple',     hex: '#9752c9', dark: '#4d2470', light: '#cfa4e8' },
    { id: 'grey',   name: 'Dark Grey',  hex: '#7d8794', dark: '#3b434d', light: '#c0c8d2' }
  ];

  // ---------------------------------------------------------------------
  // Buildings
  // ---------------------------------------------------------------------
  // power: positive = produces, negative = consumes.
  // tags: used by prerequisite checks (faction independent).
  var BUILDINGS = [
    {
      id: 'conyard', name: 'Construction Yard', faction: 'any', tab: 'structures',
      cost: 2500, buildTime: sec(40), power: 0, hp: 1500, armor: 'concrete', sight: 8,
      w: 3, h: 3, prereq: [], tags: ['conyard', 'builder'], art: 'conyard',
      desc: 'Deploys the base. Losing every Construction Yard (with no MCV) loses the game.'
    },
    {
      id: 'allied_power', name: 'Power Plant', faction: 'allied', tab: 'structures',
      cost: 300, buildTime: sec(12), power: 100, hp: 800, armor: 'concrete', sight: 6,
      w: 2, h: 2, prereq: [], tags: ['power', 'structure'], art: 'power',
      desc: 'Provides 100 units of power. Everything stops when the grid browns out.'
    },
    {
      id: 'soviet_power', name: 'Tesla Reactor', faction: 'soviet', tab: 'structures',
      cost: 600, buildTime: sec(16), power: 150, hp: 900, armor: 'concrete', sight: 6,
      w: 2, h: 2, prereq: [], tags: ['power', 'structure'], art: 'teslareactor',
      desc: 'Provides 150 units of power, but explodes violently when destroyed.'
    },
    {
      id: 'refinery', name: 'Ore Refinery', faction: 'any', tab: 'structures',
      cost: 2000, buildTime: sec(25), power: -30, hp: 1200, armor: 'concrete', sight: 7,
      w: 3, h: 2, prereq: ['power'], tags: ['refinery', 'structure'], produce: 'harvester',
      art: 'refinery',
      desc: 'Refines ore into credits. Ships with one free ore miner.'
    },
    {
      id: 'barracks', name: 'Barracks', faction: 'any', tab: 'structures',
      cost: 500, buildTime: sec(12), power: -20, hp: 900, armor: 'concrete', sight: 6,
      w: 2, h: 2, prereq: ['power'], tags: ['barracks', 'structure'], produce: 'infantry',
      art: 'barracks',
      desc: 'Trains infantry.'
    },
    {
      id: 'warfactory', name: 'War Factory', faction: 'any', tab: 'structures',
      cost: 2000, buildTime: sec(28), power: -50, hp: 1300, armor: 'concrete', sight: 6,
      w: 3, h: 2, prereq: ['refinery'], tags: ['factory', 'structure'], produce: 'vehicle',
      art: 'warfactory',
      desc: 'Builds vehicles and ore miners. Set a rally point with a right-click.'
    },
    {
      id: 'lab', name: 'Battle Lab', faction: 'any', tab: 'structures',
      cost: 2000, buildTime: sec(30), power: -75, hp: 1000, armor: 'concrete', sight: 6,
      w: 3, h: 2, prereq: ['factory', 'refinery'], tags: ['lab', 'structure'],
      art: 'lab',
      desc: 'Unlocks the advanced tier: heavy tanks and advanced defences.'
    },
    {
      id: 'allied_pillbox', name: 'Pillbox', faction: 'allied', tab: 'defenses',
      cost: 400, buildTime: sec(10), power: -20, hp: 500, armor: 'concrete', sight: 9,
      w: 1, h: 1, prereq: ['barracks'], tags: ['defense', 'defense1'], art: 'pillbox',
      weapon: {
        name: 'M60 MG', damage: 15, warhead: 'smallArms', rof: sec(0.7), range: 4.6,
        speed: 0, projectile: 'tracer', targets: 'ground'
      },
      desc: 'Cheap machine-gun bunker. Shreds infantry, ignores aircraft.'
    },
    {
      id: 'allied_patriot', name: 'Patriot Missile', faction: 'allied', tab: 'defenses',
      cost: 700, buildTime: sec(14), power: -30, hp: 500, armor: 'concrete', sight: 10,
      w: 1, h: 1, prereq: ['barracks'], tags: ['defense', 'defense1', 'aa'], art: 'patriot',
      weapon: {
        name: 'Patriot SAM', damage: 45, warhead: 'rocket', rof: sec(1.6), range: 6.0,
        speed: 9, projectile: 'rocket', targets: 'air'
      },
      desc: 'Anti-air missile battery. Rocketeers hate it.'
    },
    {
      id: 'allied_prism', name: 'Prism Tower', faction: 'allied', tab: 'defenses',
      cost: 1500, buildTime: sec(20), power: -50, hp: 600, armor: 'concrete', sight: 10,
      w: 1, h: 1, prereq: ['lab'], tags: ['defense', 'defense2'], art: 'prismtower',
      weapon: {
        name: 'Prism Beam', damage: 62, warhead: 'prism', rof: sec(2.2), range: 6.5,
        speed: 0, projectile: 'beam', targets: 'ground'
      },
      desc: 'Focused light beam. Melts tanks at long range.'
    },
    {
      id: 'soviet_sentry', name: 'Sentry Gun', faction: 'soviet', tab: 'defenses',
      cost: 700, buildTime: sec(12), power: -30, hp: 420, armor: 'concrete', sight: 9,
      w: 1, h: 1, prereq: ['barracks'], tags: ['defense', 'defense1'], art: 'sentry',
      weapon: {
        name: 'Sentry Cannon', damage: 24, warhead: 'ap', rof: sec(1.5), range: 5.4,
        speed: 16, projectile: 'shell', targets: 'ground'
      },
      desc: 'Automatic cannon that punches through light armour.'
    },
    {
      id: 'soviet_flak', name: 'Flak Cannon', faction: 'soviet', tab: 'defenses',
      cost: 750, buildTime: sec(14), power: -30, hp: 550, armor: 'concrete', sight: 10,
      w: 1, h: 1, prereq: ['barracks'], tags: ['defense', 'defense1', 'aa'], art: 'flakcannon',
      weapon: {
        name: 'Flak Burst', damage: 28, warhead: 'flak', rof: sec(1.1), range: 6.0,
        speed: 0, projectile: 'flak', targets: 'both'
      },
      desc: 'Flak battery: excellent against aircraft, useful against infantry.'
    },
    {
      id: 'soviet_tesla', name: 'Tesla Coil', faction: 'soviet', tab: 'defenses',
      cost: 1500, buildTime: sec(20), power: -50, hp: 600, armor: 'concrete', sight: 10,
      w: 1, h: 1, prereq: ['lab'], tags: ['defense', 'defense2'], art: 'teslacoil',
      weapon: {
        name: 'Tesla Bolt', damage: 100, warhead: 'tesla', rof: sec(3.0), range: 6.5,
        speed: 0, projectile: 'tesla', targets: 'ground'
      },
      desc: 'Lightning arc. Devastating, and it needs a lot of power.'
    }
  ];

  // ---------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------
  var UNITS = [
    {
      id: 'harvester', name: 'Ore Miner', faction: 'any', tab: 'vehicles',
      cost: 1400, buildTime: sec(18), hp: 600, armor: 'light', sight: 7,
      speed: 1.7, radius: 0.34, turnRate: 3.4, weapons: null, turret: false,
      capacity: 500, harvestInterval: sec(0.4), art: 'harvester',
      desc: 'Mines ore and returns it to a refinery. The backbone of your economy.'
    },
    {
      id: 'gi', name: 'G.I.', faction: 'allied', tab: 'infantry',
      cost: 200, buildTime: sec(5), hp: 100, armor: 'infantry', sight: 7,
      speed: 1.15, radius: 0.16, turnRate: 7, turret: false, art: 'gi',
      weapons: [{
        name: 'M16 Rifle', damage: 12, warhead: 'smallArms', rof: sec(0.6), range: 4.2,
        speed: 0, projectile: 'tracer', targets: 'both'
      }],
      desc: 'Cheap, reliable rifleman. Good against infantry, can plink aircraft.'
    },
    {
      id: 'guardian', name: 'Guardian G.I.', faction: 'allied', tab: 'infantry',
      cost: 400, buildTime: sec(8), hp: 110, armor: 'infantry', sight: 8,
      speed: 1.0, radius: 0.17, turnRate: 6, turret: false, art: 'guardian',
      weapons: [{
        name: 'Rocket Launcher', damage: 32, warhead: 'rocket', rof: sec(1.5), range: 5.0,
        speed: 7, projectile: 'rocket', targets: 'both'
      }],
      prereqExtra: ['lab'],
      desc: 'Anti-vehicle/anti-air missile infantry. Too slow to hold a line alone.'
    },
    {
      id: 'rocketeer', name: 'Rocketeer', faction: 'allied', tab: 'infantry',
      cost: 600, buildTime: sec(10), hp: 80, armor: 'air', sight: 9,
      speed: 2.2, radius: 0.18, turnRate: 5, turret: false, flying: true, altitude: 1.6,
      weapons: [{
        name: 'Rocket Pod', damage: 22, warhead: 'rocket', rof: sec(1.1), range: 4.6,
        speed: 8, projectile: 'rocket', targets: 'both'
      }],
      prereqExtra: ['lab'],
      desc: 'Jet-pack infantry. Flies over terrain; only flak and missiles can touch it.'
    },
    {
      id: 'engineer', name: 'Engineer', faction: 'any', tab: 'infantry',
      cost: 500, buildTime: sec(8), hp: 60, armor: 'infantry', sight: 6,
      speed: 1.3, radius: 0.15, turnRate: 8, turret: false, art: 'engineer',
      weapons: null, abilities: ['capture'],
      desc: 'Walks into an enemy structure to capture it (structure survives at 50% HP).'
    },
    {
      id: 'grizzly', name: 'Grizzly Battle Tank', faction: 'allied', tab: 'vehicles',
      cost: 700, buildTime: sec(10), hp: 300, armor: 'light', sight: 8,
      speed: 2.3, radius: 0.32, turnRate: 2.6, turret: true, turretRate: 2.2, art: 'grizzly',
      weapons: [{
        name: '105mm Cannon', damage: 42, warhead: 'ap', rof: sec(1.4), range: 4.75,
        speed: 16, projectile: 'shell', targets: 'ground'
      }],
      desc: 'Fast, cheap, all-purpose Allied tank.'
    },
    {
      id: 'prismtank', name: 'Prism Tank', faction: 'allied', tab: 'vehicles',
      cost: 1200, buildTime: sec(16), hp: 260, armor: 'light', sight: 8,
      speed: 2.1, radius: 0.32, turnRate: 2.4, turret: true, turretRate: 2.0, art: 'prismtank',
      weapons: [{
        name: 'Prism Beam', damage: 68, warhead: 'prism', rof: sec(2.0), range: 6.5,
        speed: 0, projectile: 'beam', targets: 'ground'
      }],
      prereqExtra: ['lab'],
      desc: 'Long-range beam tank. Glass cannon - escort it.'
    },
    {
      id: 'conscript', name: 'Conscript', faction: 'soviet', tab: 'infantry',
      cost: 100, buildTime: sec(4), hp: 100, armor: 'infantry', sight: 6,
      speed: 1.15, radius: 0.16, turnRate: 7, turret: false, art: 'conscript',
      weapons: [{
        name: 'AK-47', damage: 10, warhead: 'smallArms', rof: sec(0.65), range: 4.0,
        speed: 0, projectile: 'tracer', targets: 'both'
      }],
      desc: 'Dirt cheap, poorly trained, surprisingly numerous.'
    },
    {
      id: 'flak', name: 'Flak Trooper', faction: 'soviet', tab: 'infantry',
      cost: 300, buildTime: sec(6), hp: 100, armor: 'infantry', sight: 7,
      speed: 1.2, radius: 0.16, turnRate: 7, turret: false, art: 'flak',
      weapons: [{
        name: 'Flak Gun', damage: 16, warhead: 'flak', rof: sec(0.75), range: 4.2,
        speed: 0, projectile: 'flak', targets: 'both'
      }],
      desc: 'Mobile flak. The Soviet answer to Rocketeers.'
    },
    {
      id: 'rhino', name: 'Rhino Heavy Tank', faction: 'soviet', tab: 'vehicles',
      cost: 850, buildTime: sec(12), hp: 420, armor: 'heavy', sight: 8,
      speed: 2.1, radius: 0.34, turnRate: 2.2, turret: true, turretRate: 1.9, art: 'rhino',
      weapons: [{
        name: '120mm Cannon', damage: 58, warhead: 'ap', rof: sec(1.65), range: 4.75,
        speed: 16, projectile: 'shell', targets: 'ground'
      }],
      desc: 'Slower than a Grizzly, but it wins every straight fight.'
    },
    {
      id: 'apoc', name: 'Apocalypse Tank', faction: 'soviet', tab: 'vehicles',
      cost: 1750, buildTime: sec(20), hp: 850, armor: 'heavy', sight: 8,
      speed: 1.5, radius: 0.4, turnRate: 1.8, turret: true, turretRate: 1.5, art: 'apoc',
      weapons: [{
        name: 'Twin 125mm', damage: 100, warhead: 'ap', rof: sec(2.6), range: 5.5,
        speed: 16, projectile: 'shell', targets: 'ground'
      }],
      prereqExtra: ['lab'],
      desc: 'Mobile fortress. Slow, expensive, and terrifying.'
    }
  ];

  // ---------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------
  Rules.buildings = {};
  Rules.units = {};
  Rules.all = {};

  BUILDINGS.forEach(function (b) {
    b.kind = 'building';
    b.maxHp = b.hp;
    b.prereq = b.prereq || [];
    if (b.id !== 'conyard' && b.prereq.indexOf('builder') < 0) b.prereq.unshift('builder');
    Rules.buildings[b.id] = b;
    Rules.all[b.id] = b;
  });
  UNITS.forEach(function (u) {
    u.kind = 'unit';
    u.maxHp = u.hp;
    // Units need a construction yard plus the structure that trains them.
    var base = u.tab === 'infantry' ? ['barracks'] : ['factory'];
    var extra = u.prereqExtra || [];
    u.prereq = ['builder'].concat(base).concat(extra);
    Rules.units[u.id] = u;
    Rules.all[u.id] = u;
  });

  Rules.get = function (id) { return Rules.all[id] || null; };

  Rules.FACTION_INFO = {
    allied: { id: 'allied', name: 'Allied', blurb: 'Fast light tanks, laser defence, air power.', defaultColor: 'blue' },
    soviet: { id: 'soviet', name: 'Soviet', blurb: 'Heavy armour, tesla technology, cheap hordes.', defaultColor: 'red' }
  };

  var TAB_ORDER = ['structures', 'defenses', 'infantry', 'vehicles'];
  Rules.TAB_ORDER = TAB_ORDER;
  Rules.TAB_NAMES = { structures: 'Structures', defenses: 'Defences', infantry: 'Infantry', vehicles: 'Vehicles' };

  /** Buildable entries for one faction, grouped by sidebar tab. */
  Rules.roster = function (faction) {
    var out = { structures: [], defenses: [], infantry: [], vehicles: [] };
    TAB_ORDER.forEach(function (tab) {
      for (var id in Rules.all) {
        var d = Rules.all[id];
        if (d.tab !== tab) continue;
        if (d.faction !== 'any' && d.faction !== faction) continue;
        out[tab].push(d);
      }
    });
    return out;
  };

  Rules.prereqOf = function (def) {
    var base = (def.prereq || []).slice();
    if (def.prereqExtra) base = base.concat(def.prereqExtra);
    return base;
  };

  // ---------------------------------------------------------------------
  // Veterancy: kills earn XP, higher ranks shoot harder and see further.
  // ---------------------------------------------------------------------
  Rules.RANKS = [
    { name: 'Rookie',  dmg: 1.00, rofMul: 1.00, sightMul: 1.00, hpMul: 1.00, xp: 0,   regen: 0 },
    { name: 'Veteran', dmg: 1.20, rofMul: 0.85, sightMul: 1.15, hpMul: 1.25, xp: 260, regen: 0.6 },
    { name: 'Elite',   dmg: 1.45, rofMul: 0.70, sightMul: 1.30, hpMul: 1.60, xp: 750, regen: 1.4 }
  ];
  Rules.rankForXp = function (xp) {
    var r = 0;
    for (var i = 1; i < Rules.RANKS.length; i++) if (xp >= Rules.RANKS[i].xp) r = i;
    return r;
  };
  Rules.xpForKill = function (targetDef) {
    return Math.max(15, Math.round((targetDef && targetDef.cost ? targetDef.cost : 200) * 0.35));
  };

  // ---------------------------------------------------------------------
  // Economy / misc constants
  // ---------------------------------------------------------------------
  Rules.ORE_BAIL = 25;            // credits per harvested bail
  Rules.ORE_CELL_MAX = 300;       // credits a full ore cell holds
  Rules.GEM_MULTIPLIER = 2;       // gems are worth double
  Rules.ORE_REGROW_TICKS = 26;    // ticks per +1 credit of regrowth
  Rules.SELL_REFUND = 0.5;
  Rules.REPAIR_RATE = 0.6;        // hp per tick
  Rules.REPAIR_COST_PER_HP = 0.25;
  Rules.CAPTURE_HP_FRACTION = 0.5;

  // ---------------------------------------------------------------------
  // Skirmish defaults & difficulty
  // ---------------------------------------------------------------------
  Rules.DIFFICULTIES = {
    easy:   { id: 'easy',   name: 'Easy',   handicap: 0.80, buildMul: 0.85, waveMul: 0.70, reactionMul: 1.35, expansion: 0.6 },
    normal: { id: 'normal', name: 'Normal', handicap: 1.00, buildMul: 1.00, waveMul: 1.00, reactionMul: 1.00, expansion: 1.0 },
    hard:   { id: 'hard',   name: 'Hard',   handicap: 1.15, buildMul: 1.20, waveMul: 1.40, reactionMul: 0.75, expansion: 1.3 }
  };

  Rules.START_OPTIONS = ['mcv', 'standard', 'quick'];
  Rules.START_LABELS = {
    mcv: 'Minimal - Construction Yard only',
    standard: 'Standard - Construction Yard, 2 infantry, $10,000',
    quick: 'Quick Start - add Power Plant, Refinery and a miner'
  };

  RA.Rules = Rules;
})(globalThis.RA = globalThis.RA || {});
