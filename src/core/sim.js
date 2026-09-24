/*
 * Red Alert Web - the simulation.
 *
 * Deterministic, DOM-free game state: entities, orders, movement, combat,
 * economy, fog of war, production queues and victory conditions.
 * The presentation layer only reads from this module.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var T = RA.TERRAIN;
  var Pathfind = RA.Pathfind;
  var MapGen = RA.MapGen;
  var HZ = Rules.TICKS_PER_SEC;
  var CELL = 4;
  var UNIT_CAP = 400;

  var Sim = RA.Sim = {};

  // =====================================================================
  // Construction
  // =====================================================================
  function makePlayer(index, faction, colorId, isAI, diff) {
    var color = Rules.PLAYER_COLORS[colorId % Rules.PLAYER_COLORS.length];
    return {
      index: index,
      faction: faction,
      colorId: colorId % Rules.PLAYER_COLORS.length,
      color: color,
      isAI: !!isAI,
      difficulty: diff || 'normal',
      credits: 0,
      defeated: false,
      power: { produced: 0, consumed: 0, low: false },
      queues: { structures: [], defenses: [], infantry: [], vehicles: [] },
      placing: null,
      visibility: { visible: new Uint8Array(1), explored: new Uint8Array(1) },
      stats: {
        creditsEarned: 0, creditsSpent: 0, oreHarvested: 0, unitsBuilt: 0,
        buildingsBuilt: 0, kills: 0, losses: 0, structuresLost: 0, unitsLost: 0,
        peakArmy: 0
      },
      ai: null
    };
  }

  /**
   * createGame(options)
   *   seed, size ('small'|'medium'|'large'), playerCount,
   *   players: [{faction, color, isAI, difficulty}], startCredits, startOption,
   *   shortGame (bool), fog (bool)
   */
  Sim.createGame = function (options) {
    var opts = options || {};
    var state = {};
    state.opts = opts;
    state.seed = (opts.seed === undefined || opts.seed === null) ? ((Date.now() ^ 0x5f3759df) >>> 0) : (opts.seed >>> 0);
    state.rng = U.makeRng(state.seed ^ 0x9e3779b9);
    state.playerCount = U.clamp(opts.playerCount || (opts.players ? opts.players.length : 2), 2, 4);
    state.tick = 0;
    state.nextId = 1;
    state.units = [];
    state.buildings = [];
    state.projectiles = [];
    state.effects = [];
    state.decals = [];
    state.events = [];
    state.builtCounts = [];  // per player, by type id
    state.over = false;
    state.winner = -1;
    state.endTick = 0;
    state.fog = opts.fog !== false;
    state.shortGame = opts.shortGame !== false;
    state.difficulty = opts.difficulty || 'normal';
    state.suddenDeathAt = opts.suddenDeath === false ? 0
      : Math.round((opts.suddenDeathMinutes === undefined ? 25 : opts.suddenDeathMinutes) * 60 * Rules.TICKS_PER_SEC);

    state.map = MapGen.generate({
      size: opts.size || 'medium',
      playerCount: state.playerCount,
      seed: state.seed
    });

    var pc = state.playerCount;
    state.players = [];
    var defs = opts.players || [];
    for (var i = 0; i < pc; i++) {
      var d = defs[i] || {};
      var faction = d.faction === 'soviet' ? 'soviet' : 'allied';
      var color = (d.color === undefined) ? i : d.color;
      var p = makePlayer(i, faction, color, d.isAI !== false, d.difficulty || state.difficulty);
      p.visibility.visible = new Uint8Array(state.map.w * state.map.h);
      p.visibility.explored = new Uint8Array(state.map.w * state.map.h);
      p.credits = opts.startCredits === undefined ? 10000 : opts.startCredits;
      p.stats.creditsEarned = p.credits;
      if (opts.handicap && opts.handicap[i]) p.handicap = opts.handicap[i];
      state.players.push(p);
      state.builtCounts.push({});
    }

    // Starting bases
    var startOption = opts.startOption || 'standard';
    for (i = 0; i < pc; i++) {
      setupStartingBase(state, state.players[i], state.map.starts[i], startOption);
    }

    state.spatial = rebuildIndex(state);
    updateAllVisibility(state);
    updatePower(state);
    updatePower(state);

    return state;
  };

  function setupStartingBase(state, player, start, startOption) {
    var cx = start.x, cy = start.y;
    var cyardType = 'conyard';
    var tx = Math.round(cx - 1), ty = Math.round(cy - 1);
    var spot = findBuildSpot(state.map, cyardType, tx, ty, 6);
    if (!spot) spot = { x: Math.max(0, Math.min(state.map.w - 3, tx)), y: Math.max(0, Math.min(state.map.h - 3, ty)) };
    var yard = spawnBuilding(state, player.index, cyardType, spot.x, spot.y, { complete: true, instant: true });
    var ex = yard.x + yard.w / 2, ey = yard.y + yard.h + 1.4;

    if (startOption !== 'mcv') {
      var infType = player.faction === 'soviet' ? 'conscript' : 'gi';
      spawnUnit(state, player.index, infType, ex - 1.1, ey);
      spawnUnit(state, player.index, infType, ex + 1.1, ey);
    }
    if (startOption === 'quick') {
      var ptype = player.faction === 'soviet' ? 'soviet_power' : 'allied_power';
      var powerSpot = findBuildSpot(state.map, ptype, yard.x - 3, yard.y, 8, { state: state, owner: player.index });
      if (powerSpot) spawnBuilding(state, player.index, ptype, powerSpot.x, powerSpot.y, { complete: true, instant: true });
      var refSpot = findBuildSpot(state.map, 'refinery', yard.x + 3, yard.y + 1, 10, { state: state, owner: player.index });
      if (refSpot) {
        var ref = spawnBuilding(state, player.index, 'refinery', refSpot.x, refSpot.y, { complete: true, instant: true });
        spawnUnit(state, player.index, 'harvester', ref.dockX, ref.dockY + 0.9);
      }
    }
  }

  /**
   * Nearest valid top-left tile for `typeId` near (tx,ty).
   * Pass {state, owner} to also honour the "build next to your base" rule.
   */
  function findBuildSpot(map, typeId, tx, ty, radius, opts) {
    var def = Rules.get(typeId);
    if (!def) return null;
    radius = radius || 6;
    var requireAdjacent = !!(opts && opts.state && opts.owner !== undefined &&
      Sim.buildingCount(opts.state, opts.owner, null, false) > 0);
    var fallback = null, fallbackScore = 1e9;
    for (var r = 0; r <= radius; r++) {
      var best = null, bestScore = 1e9;
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (r > 0 && Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          var x = tx + ox, y = ty + oy;
          if (!footprintFree(map, def, x, y)) continue;
          var score = ox * ox + oy * oy;
          if (score < bestScore) { bestScore = score; best = { x: x, y: y }; }
        }
      }
      if (!best) continue;
      if (fallback === null || bestScore < fallbackScore) { fallback = best; fallbackScore = bestScore; }
      if (!requireAdjacent) return best;
      if (Sim.canPlace(opts.state, opts.owner, typeId, best.x, best.y).ok) return best;
    }
    return fallback;
  }

  function footprintFree(map, def, tx, ty) {
    if (tx < 0 || ty < 0 || tx + def.w > map.w || ty + def.h > map.h) return false;
    for (var y = 0; y < def.h; y++) {
      for (var x = 0; x < def.w; x++) {
        if (!map.isBuildableTile(tx + x, ty + y)) return false;
      }
    }
    return true;
  }

  // =====================================================================
  // Entity spawning / removal
  // =====================================================================
  function spawnUnit(state, owner, typeId, x, y, extra) {
    var def = Rules.units[typeId];
    if (!def) throw new Error('unknown unit type: ' + typeId);
    var rank = Rules.RANKS[0];
    var e = {
      id: state.nextId++,
      kind: 'unit',
      type: typeId,
      def: def,
      owner: owner,
      x: x, y: y,
      hp: def.maxHp,
      maxHp: def.maxHp,
      facing: Math.PI / 2,
      turret: Math.PI / 2,
      path: null,
      pathIdx: 0,
      order: { type: 'guard' },
      targetId: 0,
      cooldown: 0,
      cargo: 0,
      xp: 0,
      rank: 0,
      state: 'idle',
      dead: false,
      flash: 0,
      stuckTicks: 0,
      moveTicks: 0,
      lastX: x, lastY: y,
      repathCooldown: 0,
      harvestTimer: 0,
      unloadTimer: 0,
      dockRef: 0,
      dockSlot: 0,
      harvestSpot: null,
      homeX: x, homeY: y,
      cargoKind: 1,
      aiGroup: 0,
      vx: 0, vy: 0,
      lastOrderTick: state.tick,
      deathTick: 0
    };
    if (extra) for (var k in extra) e[k] = extra[k];
    e.speed = def.speed;
    e.sight = def.sight;
    state.units.push(e);
    if (state.players[owner]) state.players[owner].stats.unitsBuilt++;
    bumpBuilt(state, owner, typeId);
    return e;
  }

  function spawnBuilding(state, owner, typeId, tx, ty, extra) {
    var def = Rules.buildings[typeId];
    if (!def) throw new Error('unknown building type: ' + typeId);
    var e = {
      id: state.nextId++,
      kind: 'building',
      type: typeId,
      def: def,
      owner: owner,
      x: tx, y: ty,
      w: def.w, h: def.h,
      cx: tx + def.w / 2,
      cy: ty + def.h / 2,
      hp: def.maxHp,
      maxHp: def.maxHp,
      facing: Math.PI / 2,
      complete: true,
      buildTicks: 0,
      buildTotal: 1,
      dead: false,
      flash: 0,
      cooldown: 0,
      targetId: 0,
      rally: null,
      repairing: false,
      power: def.power || 0,
      dockX: tx + def.w / 2,
      dockY: ty + def.h + 0.6,
      dockBusy: 0,
      produceType: def.produce || null,
      lastHurtTick: -9999
    };
    if (extra) for (var k in extra) e[k] = extra[k];
    if (!e.complete) {
      e.buildTotal = e.buildTotal || Math.round(HZ * (1.2 + def.w * def.h * 0.18));
      e.buildTicks = e.buildTotal;
    }
    occupyBuilding(state.map, e, 1);
    if (e.def.tags && e.def.tags.indexOf('refinery') >= 0) {
      // Park the unloading bay on a tile the miners can actually reach.
      var front = Pathfind.nearestFreeTile(state.map, Math.floor(e.dockX), Math.floor(e.dockY), 6);
      if (front) { e.dockX = front.x + 0.5; e.dockY = front.y + 0.5; }
      e.dockTiles = reserveDock(state.map, e.dockX, e.dockY);
    }
    state.buildings.push(e);
    bumpBuilt(state, owner, typeId);
    if (e.complete && state.players[owner]) state.players[owner].stats.buildingsBuilt++;
    Pathfind.invalidate();
    return e;
  }

  function bumpBuilt(state, owner, typeId) {
    var m = state.builtCounts[owner];
    if (m) m[typeId] = (m[typeId] || 0) + 1;
  }
  function countBuilt(state, owner, typeId) {
    var m = state.builtCounts[owner];
    return m ? (m[typeId] || 0) : 0;
  }

  function occupyBuilding(map, b, value) {
    for (var y = 0; y < b.h; y++) {
      for (var x = 0; x < b.w; x++) {
        var tx = b.x + x, ty = b.y + y;
        if (!map.inside(tx, ty)) continue;
        map.occ[map.idx(tx, ty)] = value;
      }
    }
  }

  /**
   * Reserve the tiles a refinery needs for unloading so that nobody can
   * wall in the bay later on (that would starve the owner's economy).
   */
  function reserveDock(map, dx, dy) {
    var out = [];
    var cx = Math.floor(dx), cy = Math.floor(dy);
    if (map.inside(cx, cy)) {
      var i = map.idx(cx, cy);
      if (!map.occ[i]) { map.reserved[i] = 1; out.push(i); }
    }
    return out;
  }

  function releaseDock(map, tiles) {
    if (!tiles) return;
    for (var k = 0; k < tiles.length; k++) map.reserved[tiles[k]] = 0;
  }

  function removeEntity(state, e) {
    if (e.dead) return;
    e.dead = true;
    e.deathTick = state.tick;
    if (e.kind === 'building') {
      occupyBuilding(state.map, e, 0);
      releaseDock(state.map, e.dockTiles);
      e.dockTiles = null;
      Pathfind.invalidate();
      var owner = state.players[e.owner];
      if (owner) owner.stats.structuresLost++;
      spawnExplosion(state, e.cx, e.cy, Math.max(e.w, e.h) * 6.5, e.owner, true);
      addDecal(state, e.cx, e.cy, 'wreck', e.w, e.h, e.facing);
      if (e.def && e.def.id === 'soviet_power') {
        // Tesla reactors detonate: damage everything around them.
        splashDamage(state, e.cx, e.cy, 2.4, 160, 'he', -1);
      }
    } else {
      var p = state.players[e.owner];
      if (p) p.stats.unitsLost++;
      spawnExplosion(state, e.x, e.y, 3.2, e.owner, false);
      addDecal(state, e.x, e.y, 'scorch', 1, 1, 0);
    }
    // Units that were docking / targeting this entity lose their reference.
    var i;
    for (i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.targetId === e.id) u.targetId = 0;
      if (u.order && u.order.targetId === e.id) {
        if (u.order.type === 'attack' || u.order.type === 'capture') {
          u.order = { type: 'guard' };
          u.path = null;
        }
      }
      if (u.dockRef === e.id) { u.dockRef = 0; u.state = 'seek'; }
    }
  }

  Sim.spawnUnit = spawnUnit;
  Sim.spawnBuilding = spawnBuilding;
  Sim.findBuildSpot = findBuildSpot;
  Sim.footprintFree = footprintFree;

  // =====================================================================
  // Events / effects / decals
  // =====================================================================
  function addEvent(state, ev) {
    if (state.events.length < 200) state.events.push(ev);
  }
  function addEffect(state, type, x, y, life, data) {
    if (state.effects.length > 500) state.effects.shift();
    state.effects.push({ type: type, x: x, y: y, t: 0, life: life, data: data || null });
  }
  function addDecal(state, x, y, type, w, h, angle) {
    if (state.decals.length > 220) state.decals.shift();
    state.decals.push({ x: x, y: y, type: type, w: w || 1, h: h || 1, angle: angle || 0, t: 0 });
  }
  function spawnExplosion(state, x, y, size, owner, big) {
    addEffect(state, 'explosion', x, y, big ? 34 : 22, { size: size, owner: owner });
    addEvent(state, { type: 'explosion', x: x, y: y, size: size, big: !!big });
  }
  Sim.addEvent = addEvent;
  Sim.addEffect = addEffect;

  // =====================================================================
  // Spatial index, queries
  // =====================================================================
  function rebuildIndex(state) {
    var cols = Math.ceil(state.map.w / CELL);
    var rows = Math.ceil(state.map.h / CELL);
    var grid = new Array(cols * rows);
    var put = function (e, x, y) {
      var cx = U.clamp(Math.floor(x / CELL), 0, cols - 1);
      var cy = U.clamp(Math.floor(y / CELL), 0, rows - 1);
      var k = cy * cols + cx;
      if (!grid[k]) grid[k] = [];
      grid[k].push(e);
    };
    var i;
    for (i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (!u.dead) put(u, u.x, u.y);
    }
    for (i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (!b.dead) put(b, b.cx, b.cy);
    }
    return { cols: cols, rows: rows, cells: grid };
  }

  /** Every live entity within `radius` tiles of (x,y). */
  function queryNear(state, x, y, radius) {
    var out = [];
    var sp = state.spatial;
    if (!sp) {
      // Early in setup (before the first spatial index) fall back to a scan.
      var all = state.units.concat(state.buildings);
      for (var q = 0; q < all.length; q++) {
        var e0 = all[q];
        if (e0.dead) continue;
        var p0 = e0.kind === 'building' ? { x: e0.cx, y: e0.cy } : { x: e0.x, y: e0.y };
        if (U.dist2(p0.x, p0.y, x, y) <= radius * radius) out.push(e0);
      }
      return out;
    }
    var c0 = U.clamp(Math.floor((x - radius) / CELL), 0, sp.cols - 1);
    var c1 = U.clamp(Math.floor((x + radius) / CELL), 0, sp.cols - 1);
    var r0 = U.clamp(Math.floor((y - radius) / CELL), 0, sp.rows - 1);
    var r1 = U.clamp(Math.floor((y + radius) / CELL), 0, sp.rows - 1);
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var list = sp.cells[r * sp.cols + c];
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (e.dead) continue;
          var ex = e.kind === 'building' ? e.cx : e.x;
          var ey = e.kind === 'building' ? e.cy : e.y;
          if (U.dist2(ex, ey, x, y) <= radius * radius) out.push(e);
        }
      }
    }
    return out;
  }

  Sim.queryNear = queryNear;

  Sim.entity = function (state, id) {
    if (!id) return null;
    for (var i = 0; i < state.units.length; i++) if (state.units[i].id === id) return state.units[i].dead ? null : state.units[i];
    for (i = 0; i < state.buildings.length; i++) if (state.buildings[i].id === id) return state.buildings[i].dead ? null : state.buildings[i];
    return null;
  };
  // O(1) lookups are kept in a map rebuilt once per tick.
  function buildEntityMap(state) {
    var m = new Map();
    var i;
    for (i = 0; i < state.units.length; i++) if (!state.units[i].dead) m.set(state.units[i].id, state.units[i]);
    for (i = 0; i < state.buildings.length; i++) if (!state.buildings[i].dead) m.set(state.buildings[i].id, state.buildings[i]);
    state.byId = m;
    return m;
  }
  Sim.byId = function (state, id) {
    if (!id) return null;
    if (state.byId) {
      var e = state.byId.get(id);
      return (e && !e.dead) ? e : null;
    }
    return Sim.entity(state, id);
  };

  function entityRadius(e) {
    return e.kind === 'building' ? Math.max(e.w, e.h) * 0.45 : (e.def.radius || 0.25);
  }
  function entityPoint(e) {
    return e.kind === 'building' ? { x: e.cx, y: e.cy } : { x: e.x, y: e.y };
  }
  Sim.entityRadius = entityRadius;
  Sim.entityPoint = entityPoint;

  function primaryWeapon(e) {
    if (e.kind === 'building') return e.def.weapon || null;
    if (!e.def.weapons || !e.def.weapons.length) return null;
    return e.def.weapons[0];
  }
  Sim.primaryWeapon = primaryWeapon;

  function canTarget(weapon, target) {
    if (!weapon) return false;
    var isAir = !!target.def.flying;
    if (isAir) return weapon.targets === 'air' || weapon.targets === 'both';
    return weapon.targets === 'ground' || weapon.targets === 'both';
  }
  Sim.canTarget = canTarget;

  // =====================================================================
  // Visibility
  // =====================================================================
  function stampVisibility(state, player, x, y, range, value) {
    var grid = player.visibility.visible;
    var explored = player.visibility.explored;
    var w = state.map.w, h = state.map.h;
    var x0 = Math.max(0, Math.floor(x - range)), x1 = Math.min(w - 1, Math.ceil(x + range));
    var y0 = Math.max(0, Math.floor(y - range)), y1 = Math.min(h - 1, Math.ceil(y + range));
    var r2 = range * range;
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var dx = tx + 0.5 - x, dy = ty + 0.5 - y;
        if (dx * dx + dy * dy > r2) continue;
        var i = ty * w + tx;
        if (value) { grid[i] = 1; explored[i] = 1; }
        else grid[i] = 0;
      }
    }
  }

  function updateVisibility(state, player) {
    var v = player.visibility.visible;
    v.fill(0);
    var i, e;
    for (i = 0; i < state.units.length; i++) {
      e = state.units[i];
      if (e.dead || e.owner !== player.index) continue;
      stampVisibility(state, player, e.x, e.y, e.sight, 1);
    }
    for (i = 0; i < state.buildings.length; i++) {
      e = state.buildings[i];
      if (e.dead || e.owner !== player.index) continue;
      var range = e.def.sight * (e.complete ? 1 : 0.7);
      var steps = Math.max(1, Math.ceil((e.w + e.h) / 2));
      stampVisibility(state, player, e.cx, e.cy, range, 1);
      // reveal building corners so the shroud edge is not choppy
      stampVisibility(state, player, e.x + 0.5, e.y + 0.5, range * 0.9, 1);
      stampVisibility(state, player, e.x + e.w - 0.5, e.y + e.h - 0.5, range * 0.9, 1);
    }
  }

  function updateAllVisibility(state) {
    for (var i = 0; i < state.players.length; i++) updateVisibility(state, state.players[i]);
  }

  Sim.visibleAt = function (state, playerIdx, x, y) {
    if (!state.fog) return true;
    var tx = Math.floor(x), ty = Math.floor(y);
    if (!state.map.inside(tx, ty)) return false;
    return state.players[playerIdx].visibility.visible[state.map.idx(tx, ty)] === 1;
  };
  Sim.exploredAt = function (state, playerIdx, x, y) {
    if (!state.fog) return true;
    var tx = Math.floor(x), ty = Math.floor(y);
    if (!state.map.inside(tx, ty)) return false;
    return state.players[playerIdx].visibility.explored[state.map.idx(tx, ty)] === 1;
  };
  Sim.isEntityVisible = function (state, playerIdx, e) {
    if (!e) return false;
    if (e.owner === playerIdx) return true;
    if (!state.fog) return true;
    if (e.kind === 'building') {
      var p = Sim.entityPoint(e);
      return Sim.visibleAt(state, playerIdx, p.x, p.y);
    }
    return Sim.visibleAt(state, playerIdx, e.x, e.y);
  };
  /** Buildings stay "known" once spotted, so the AI can plan attacks. */
  Sim.isEntityKnown = function (state, playerIdx, e) {
    if (!e) return false;
    if (e.owner === playerIdx) return true;
    if (!state.fog) return true;
    var p = Sim.entityPoint(e);
    if (Sim.visibleAt(state, playerIdx, p.x, p.y)) return true;
    if (e.kind !== 'building') return false;
    return Sim.exploredAt(state, playerIdx, p.x, p.y);
  };

  // =====================================================================
  // Power & economy helpers
  // =====================================================================
  function updatePower(state) {
    for (var pi = 0; pi < state.players.length; pi++) {
      var p = state.players[pi];
      var produced = 0, consumed = 0;
      for (var i = 0; i < state.buildings.length; i++) {
        var b = state.buildings[i];
        if (b.dead || b.owner !== pi) continue;
        var pw = b.power;
        if (!b.complete) pw *= 0.35;
        if (pw >= 0) produced += pw; else consumed += -pw;
      }
      var wasLow = p.power.low;
      p.power.produced = produced;
      p.power.consumed = consumed;
      p.power.low = consumed > produced;
      if (p.power.low && !wasLow) addEvent(state, { type: 'lowPower', player: pi });
    }
  }

  Sim.spend = function (state, playerIdx, amount) {
    var p = state.players[playerIdx];
    if (!p || p.credits < amount) return false;
    p.credits -= amount;
    p.stats.creditsSpent += amount;
    return true;
  };
  Sim.earn = function (state, playerIdx, amount) {
    var p = state.players[playerIdx];
    if (!p) return;
    p.credits += amount;
    p.stats.creditsEarned += amount;
  };

  // =====================================================================
  // Build system
  // =====================================================================
  function ownedTypes(state, owner) {
    var set = {};
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead || b.owner !== owner) continue;
      var tags = b.def.tags || [];
      for (var t = 0; t < tags.length; t++) set[tags[t]] = true;
    }
    return set;
  }

  Sim.canBuild = function (state, playerIdx, typeId) {
    var def = Rules.get(typeId);
    var p = state.players[playerIdx];
    if (!def || !p) return { ok: false, reason: 'Unknown', reasonKey: 'invalid' };
    if (def.faction && def.faction !== 'any' && def.faction !== p.faction) {
      return { ok: false, reason: 'Wrong faction', reasonKey: 'wrongFaction' };
    }
    if (p.defeated || state.over) return { ok: false, reason: 'Unavailable', reasonKey: 'unavailable' };
    var owned = ownedTypes(state, playerIdx);
    var needs = Rules.prereqOf(def);
    for (var i = 0; i < needs.length; i++) {
      if (!owned[needs[i]]) {
        return {
          ok: false,
          reason: 'Requires ' + prereqName(needs[i]),
          reasonKey: 'needPrereq',
          needTag: needs[i]
        };
      }
    }
    if (p.credits < def.cost) {
      return { ok: false, reason: 'Not enough credits', reasonKey: 'needCredits', soft: true };
    }
    if (typeId === 'conyard') {
      // never rebuild the construction yard: you must protect the original
      if (countBuilt(state, playerIdx, 'conyard') > 0) {
        return { ok: false, reason: 'Already built', reasonKey: 'alreadyBuilt' };
      }
    }
    return { ok: true };
  };

  function prereqName(tag) {
    var names = {
      power: 'a Power Plant', refinery: 'an Ore Refinery', barracks: 'a Barracks',
      factory: 'a War Factory', lab: 'a Battle Lab', builder: 'a Construction Yard'
    };
    return names[tag] || tag;
  }
  Sim.prereqName = prereqName;

  Sim.queueBuild = function (state, playerIdx, typeId) {
    var p = state.players[playerIdx];
    var def = Rules.get(typeId);
    if (!p || !def) return false;
    var check = Sim.canBuild(state, playerIdx, typeId);
    if (!check.ok) { addEvent(state, { type: 'buildRefused', player: playerIdx, reason: check.reason }); return false; }
    var tab = def.tab;
    var q = p.queues[tab];
    if (q.length >= 9) return false;
    var queued = 0;
    for (var i = 0; i < q.length; i++) if (q[i].typeId === typeId) queued++;
    var limit = def.kind === 'building' ? 1 : 9;
    if (queued >= limit) return false;
    q.push({ typeId: typeId, progress: 0, paid: false, ready: false, tab: tab, type: def.kind });
    addEvent(state, { type: 'queueAdded', player: playerIdx, typeId: typeId });
    return true;
  };

  Sim.cancelBuild = function (state, playerIdx, typeId) {
    var p = state.players[playerIdx];
    if (!p) return false;
    var tabs = Rules.TAB_ORDER;
    for (var t = 0; t < tabs.length; t++) {
      var q = p.queues[tabs[t]];
      for (var i = q.length - 1; i >= 0; i--) {
        if (q[i].typeId !== typeId) continue;
        var item = q.splice(i, 1)[0];
        if (item.paid) Sim.earn(state, playerIdx, Rules.get(typeId).cost);
        if (p.placing && p.placing.typeId === typeId) p.placing = null;
        addEvent(state, { type: 'queueRemoved', player: playerIdx, typeId: typeId });
        return true;
      }
    }
    return false;
  };

  Sim.queueState = function (state, playerIdx, typeId) {
    var p = state.players[playerIdx];
    if (!p) return null;
    var tabs = Rules.TAB_ORDER;
    for (var t = 0; t < tabs.length; t++) {
      var q = p.queues[tabs[t]];
      for (var i = 0; i < q.length; i++) {
        if (q[i].typeId === typeId) return { index: i, item: q[i], queue: q };
      }
    }
    return null;
  };

  Sim.buildingCount = function (state, playerIdx, typeId, requireComplete) {
    var n = 0;
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead || b.owner !== playerIdx) continue;
      if (typeId && b.type !== typeId) continue;
      if (requireComplete && !b.complete) continue;
      n++;
    }
    return n;
  };
  Sim.unitCount = function (state, playerIdx, predicate) {
    var n = 0;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.dead || u.owner !== playerIdx) continue;
      if (predicate && !predicate(u)) continue;
      n++;
    }
    return n;
  };

  Sim.productionRate = function (state, playerIdx, tab) {
    var p = state.players[playerIdx];
    var n;
    if (tab === 'infantry' || tab === 'vehicles') {
      var want = tab === 'infantry' ? 'infantry' : 'vehicle';
      n = 0;
      for (var i = 0; i < state.buildings.length; i++) {
        var b = state.buildings[i];
        if (!b.dead && b.owner === playerIdx && b.complete && b.produceType === want) n++;
      }
    } else {
      n = Sim.buildingCount(state, playerIdx, 'conyard', true);
    }
    if (n <= 0) return 0;
    var rate = 1 + 0.5 * (Math.min(n, 3) - 1);
    if (p.power.low) rate *= 0.5;
    // Difficulty only changes how fast the computer opponent builds.
    if (p.isAI && Rules.DIFFICULTIES[p.difficulty]) rate *= Rules.DIFFICULTIES[p.difficulty].buildMul;
    return rate;
  };

  function updateQueues(state) {
    for (var pi = 0; pi < state.players.length; pi++) {
      var p = state.players[pi];
      if (p.defeated) continue;
      for (var t = 0; t < Rules.TAB_ORDER.length; t++) {
        var tab = Rules.TAB_ORDER[t];
        var q = p.queues[tab];
        if (!q.length) continue;
        var item = q[0];
        var def = Rules.get(item.typeId);
        if (!def) { q.shift(); continue; }
        if (item.ready) continue;
        if (!item.paid) {
          if (!Sim.spend(state, pi, def.cost)) continue;   // stall until affordable
          item.paid = true;
        }
        if (def.kind === 'building') {
          var conyards = Sim.buildingCount(state, pi, 'conyard', true);
          if (conyards <= 0) continue;
        } else {
          var rate = Sim.productionRate(state, pi, tab);
          if (rate <= 0) continue;
        }
        var speed = def.kind === 'building' ? Sim.productionRate(state, pi, 'structures') : Sim.productionRate(state, pi, tab);
        if (speed <= 0) continue;
        item.progress += speed;
        if (item.progress >= def.buildTime) {
          item.progress = def.buildTime;
          if (def.kind === 'building') {
            item.ready = true;
            addEvent(state, { type: 'structureReady', player: pi, typeId: item.typeId });
          } else {
            var place = findProductionExit(state, pi, def);
            if (!place) { /* no free exit this tick, retry next tick */ }
            else {
              var u = spawnUnit(state, pi, item.typeId, place.x, place.y);
              addEvent(state, { type: 'unitReady', player: pi, typeId: item.typeId, id: u.id });
              q.shift();
            }
          }
        }
      }
    }
  }

  function findProductionExit(state, playerIdx, def) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead || b.owner !== playerIdx || !b.complete) continue;
      if (def.tab === 'infantry' && b.produceType !== 'infantry') continue;
      if (def.tab === 'vehicles' && b.produceType !== 'vehicle') continue;
      var pts = exitPoints(state, b);
      for (var k = 0; k < pts.length; k++) {
        var pt = pts[k];
        if (!state.map.inside(Math.floor(pt.x), Math.floor(pt.y))) continue;
        var d = pts[k].cost + U.dist(pt.x, pt.y, b.cx, b.cy);
        // Prefer an empty pad, but never deadlock production because a unit
        // happens to be parked in front of the factory.
        d += crowding(state, pt.x, pt.y) * 3;
        if (d < bestD) { bestD = d; best = { x: pt.x, y: pt.y, building: b, k: k }; }
      }
    }
    return best;
  }

  function crowding(state, x, y) {
    var n = 0;
    var near = queryNear(state, x, y, 1.1);
    for (var i = 0; i < near.length; i++) if (near[i].kind === 'unit') n++;
    return n;
  }

  function exitPoints(state, b) {
    var pts = [];
    var cand = [
      { x: b.x + b.w / 2, y: b.y + b.h + 0.9 },
      { x: b.x + b.w / 2, y: b.y - 0.9 },
      { x: b.x + b.w + 0.9, y: b.y + b.h / 2 },
      { x: b.x - 0.9, y: b.y + b.h / 2 }
    ];
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      var blocked = !state.map.inside(Math.floor(c.x), Math.floor(c.y)) ||
        state.map.isBlockedTile(Math.floor(c.x), Math.floor(c.y));
      if (blocked) continue;
      pts.push({ x: c.x, y: c.y, cost: i * 0.6 });
    }
    if (!pts.length) pts.push({ x: b.cx, y: b.cy, cost: 2 });
    return pts;
  }
  Sim.exitPoints = exitPoints;

  function isSpawnClear(state, x, y, def) {
    if (!state.map.inside(Math.floor(x), Math.floor(y))) return false;
    if (def && def.flying) return true;
    if (state.map.isBlockedTile(Math.floor(x), Math.floor(y))) return false;
    var near = queryNear(state, x, y, 0.7);
    for (var i = 0; i < near.length; i++) {
      if (near[i].kind === 'unit') return false;
    }
    return true;
  }

  // =====================================================================
  // Placement (structures)
  // =====================================================================
  Sim.canPlace = function (state, playerIdx, typeId, tx, ty) {
    var def = Rules.get(typeId);
    if (!def || def.kind !== 'building') return { ok: false, reason: 'Invalid', reasonKey: 'invalid' };
    var map = state.map;
    if (tx < 0 || ty < 0 || tx + def.w > map.w || ty + def.h > map.h) {
      return { ok: false, reason: 'Outside the map', reasonKey: 'outsideMap' };
    }
    for (var y = 0; y < def.h; y++) {
      for (var x = 0; x < def.w; x++) {
        var ax = tx + x, ay = ty + y;
        if (!map.inside(ax, ay)) return { ok: false, reason: 'Outside the map', reasonKey: 'outsideMap' };
        var i = map.idx(ax, ay);
        if (map.occ[i]) return { ok: false, reason: 'Blocked', reasonKey: 'blocked' };
        var t = map.terrain[i];
        if (t === T.WATER) return { ok: false, reason: 'Cannot build on water', reasonKey: 'water' };
        if (t === T.CLIFF) return { ok: false, reason: 'Cannot build on cliffs', reasonKey: 'cliff' };
        if (t === T.TREE) return { ok: false, reason: 'Clear the trees first', reasonKey: 'trees' };
        if (map.ore[i] > 0) return { ok: false, reason: 'Cannot build on ore', reasonKey: 'ore' };
      }
    }
    // must touch (or be very close to) an existing friendly structure
    var touching = false;
    for (y = -1; y <= def.h && !touching; y++) {
      for (x = -1; x <= def.w; x++) {
        if (x >= 0 && x < def.w && y >= 0 && y < def.h) continue;
        var bx = tx + x, by = ty + y;
        if (!map.inside(bx, by)) continue;
        if (map.occ[map.idx(bx, by)]) {
          var owner = buildingOwnerAt(state, bx, by);
          if (owner === playerIdx) { touching = true; break; }
        }
      }
    }
    if (!touching) {
      return { ok: false, reason: 'Must be built next to your base', reasonKey: 'notAdjacent' };
    }
    // Never drop a building on top of units - that would trap them.
    var boxR = Math.max(def.w, def.h) * 0.75 + 1;
    var near = queryNear(state, tx + def.w / 2, ty + def.h / 2, boxR);
    for (var k = 0; k < near.length; k++) {
      var e2 = near[k];
      if (e2.kind !== 'unit' || e2.def.flying) continue;
      var px = Math.floor(e2.x), py = Math.floor(e2.y);
      if (px >= tx && px < tx + def.w && py >= ty && py < ty + def.h) {
        return { ok: false, reason: 'Something is in the way', reasonKey: 'unitsInWay' };
      }
    }
    return { ok: true };
  };

  function buildingOwnerAt(state, tx, ty) {
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead) continue;
      if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return b.owner;
    }
    return -1;
  }

  Sim.placeBuilding = function (state, playerIdx, typeId, tx, ty) {
    var check = Sim.canPlace(state, playerIdx, typeId, tx, ty);
    if (!check.ok) return check;
    var p = state.players[playerIdx];
    var qs = Sim.queueState(state, playerIdx, typeId);
    if (!qs || !qs.item.ready) return { ok: false, reason: 'Not ready yet' };
    var def = Rules.get(typeId);
    var b = spawnBuilding(state, playerIdx, typeId, tx, ty, {
      complete: false,
      buildTotal: Math.round(HZ * (1.0 + def.w * def.h * 0.12))
    });
    b.buildTicks = b.buildTotal;
    qs.queue.splice(qs.index, 1);
    if (p.placing && p.placing.typeId === typeId) p.placing = null;
    addEvent(state, { type: 'structurePlaced', player: playerIdx, typeId: typeId, x: tx, y: ty });
    return { ok: true, building: b };
  };

  Sim.beginPlacement = function (state, playerIdx, typeId) {
    var qs = Sim.queueState(state, playerIdx, typeId);
    if (!qs || !qs.item.ready) return false;
    state.players[playerIdx].placing = { typeId: typeId, tab: qs.item.tab };
    return true;
  };

  Sim.cancelPlacement = function (state, playerIdx) {
    state.players[playerIdx].placing = null;
  };

  Sim.sellBuilding = function (state, playerIdx, buildingId) {
    var b = Sim.byId(state, buildingId);
    if (!b || b.kind !== 'building' || b.owner !== playerIdx) return false;
    var refund = Math.round(b.def.cost * Rules.SELL_REFUND * (b.complete ? 1 : 0.5));
    Sim.earn(state, playerIdx, refund);
    addEvent(state, { type: 'sell', player: playerIdx, x: b.cx, y: b.cy, refund: refund });
    removeEntity(state, b);
    return true;
  };

  Sim.toggleRepair = function (state, playerIdx, buildingId) {
    var b = Sim.byId(state, buildingId);
    if (!b || b.kind !== 'building' || b.owner !== playerIdx) return false;
    b.repairing = !b.repairing;
    addEvent(state, { type: 'repair', player: playerIdx, on: b.repairing });
    return true;
  };

  // =====================================================================
  // Orders
  // =====================================================================
  function clearPath(e) { e.path = null; e.pathIdx = 0; e.stuckTicks = 0; e.moveTicks = 0; }

  Sim.orderStop = function (state, e) {
    e.order = { type: 'guard' };
    e.targetId = 0;
    clearPath(e);
    if (e.kind === 'unit' && e.state === 'harvesting') e.state = 'idle';
    if (e.kind === 'unit' && e.state === 'docking') { e.state = 'seek'; e.dockRef = 0; }
  };

  function issueMoveTo(state, e, x, y, attackMove) {
    clearPath(e);
    e.order = attackMove ? { type: 'attackMove', x: x, y: y } : { type: 'move', x: x, y: y };
    e.targetId = 0;
    computePath(state, e, x, y);
  }

  function computePath(state, e, x, y) {
    e.repathCooldown = 12 + Math.floor(state.rng() * 12);
    var res = Pathfind.find(state.map, { x: e.x, y: e.y }, { x: x, y: y }, {});
    if (!res || !res.points || !res.points.length) { e.path = null; return false; }
    e.path = res.points;
    e.pathIdx = 0;
    return true;
  }
  Sim.computePath = computePath;

  /**
   * issueOrder(state, playerIdx, ids, order)
   *   order.type: 'move' | 'attack' | 'attackMove' | 'stop' | 'guard' | 'harvest'
   *             | 'capture' | 'dock' | 'scatter'
   *   order.x/order.y for positional orders, order.targetId for entity orders.
   */
  Sim.issueOrder = function (state, playerIdx, ids, order) {
    if (!ids || !ids.length) return 0;
    var group = [];
    for (var i = 0; i < ids.length; i++) {
      var e = Sim.byId(state, ids[i]);
      if (!e || e.owner !== playerIdx) continue;
      group.push(e);
    }
    if (!group.length) return 0;

    if (order.type === 'stop') {
      for (i = 0; i < group.length; i++) Sim.orderStop(state, group[i]);
      return group.length;
    }
    if (order.type === 'guard') {
      for (i = 0; i < group.length; i++) {
        var g = group[i];
        if (g.kind !== 'unit') continue;
        clearPath(g);
        g.order = { type: 'guard', x: g.x, y: g.y };
        g.homeX = g.x; g.homeY = g.y;
      }
      return group.length;
    }
    if (order.type === 'scatter') {
      for (i = 0; i < group.length; i++) {
        var s = group[i];
        if (s.kind !== 'unit' || s.def.flying) continue;
        var ang = state.rng() * U.TAU;
        var dist = 1.6 + state.rng() * 2.2;
        issueMoveTo(state, s, s.x + Math.cos(ang) * dist, s.y + Math.sin(ang) * dist, false);
      }
      return group.length;
    }

    var target = order.targetId ? Sim.byId(state, order.targetId) : null;
    var formation = null;
    if (order.x !== undefined && group.length > 1) {
      formation = Pathfind.formationOffsets(group.length, 0.85);
      var cxp = 0, cyp = 0;
      for (i = 0; i < group.length; i++) { cxp += group[i].x; cyp += group[i].y; }
      cxp /= group.length; cyp /= group.length;
      var scored = group.map(function (g, idx) {
        return { g: g, idx: idx, d: U.dist2(g.x, g.y, order.x, order.y) + U.dist2(g.x, g.y, cxp, cyp) * 0.35 };
      }).sort(function (a, b) { return a.d - b.d; });
      var slots = Pathfind.formationOffsets(group.length, 0.85).slice();
      // assign nearest unit to the centre slot for a tighter formation
      for (i = 0; i < scored.length; i++) {
        scored[i].slot = slots[Math.min(i, slots.length - 1)];
      }
      formation = {};
      for (i = 0; i < scored.length; i++) formation[scored[i].g.id] = scored[i].slot;
    }

    for (i = 0; i < group.length; i++) {
      var u = group[i];
      if (u.kind !== 'unit') {
        if (order.type === 'attack' && target && u.kind === 'building') {
          u.targetId = target.id;   // defences can focus a target
        }
        if (order.type === 'move' && order.x !== undefined) {
          u.rally = { x: order.x, y: order.y };
        }
        continue;
      }
      if (order.type === 'attack') {
        if (!target) continue;
        clearPath(u);
        u.targetId = target.id;
        u.order = { type: 'attack', targetId: target.id };
        if (u.def.abilities && u.def.abilities.indexOf('capture') >= 0 && target.kind === 'building' && target.owner !== playerIdx) {
          u.order = { type: 'capture', targetId: target.id };
        }
        u.state = 'idle';
      } else if (order.type === 'capture') {
        if (!target) continue;
        clearPath(u);
        u.targetId = 0;
        u.order = { type: 'capture', targetId: target.id };
      } else if (order.type === 'move') {
        var tx = order.x, ty = order.y;
        if (formation && formation[u.id]) { tx += formation[u.id].x; ty += formation[u.id].y; }
        if (u.def.capacity) {   // miners always go back to work after moving near ore
          u.order = { type: 'move', x: tx, y: ty };
          u.nextAfterMove = 'harvest';
          computePath(state, u, tx, ty);
        } else if (u.def.abilities && u.def.abilities.indexOf('capture') >= 0) {
          issueMoveTo(state, u, tx, ty, false);
        } else {
          issueMoveTo(state, u, tx, ty, false);
        }
      } else if (order.type === 'attackMove') {
        tx = order.x; ty = order.y;
        if (formation && formation[u.id]) { tx += formation[u.id].x; ty += formation[u.id].y; }
        issueMoveTo(state, u, tx, ty, true);
      } else if (order.type === 'harvest') {
        if (!u.def.capacity) continue;
        u.targetId = 0;
        u.order = { type: 'harvest' };
        u.state = 'seek';
        if (order.x !== undefined) u.harvestSpot = { x: order.x, y: order.y };
        clearPath(u);
      } else if (order.type === 'dock') {
        if (!u.def.capacity || !target) continue;
        u.dockRef = target.id;
        u.state = 'return';
        u.order = { type: 'dock' };
        clearPath(u);
      }
    }
    addEvent(state, { type: 'order', player: playerIdx, orderType: order.type, count: group.length });
    return group.length;
  };

  /** Right-click semantics shared by the UI and the AI. */
  Sim.contextOrder = function (state, playerIdx, ids, worldX, worldY, targetId) {
    var target = targetId ? Sim.byId(state, targetId) : null;
    if (target && target.owner !== playerIdx) {
      return Sim.issueOrder(state, playerIdx, ids, { type: 'attack', targetId: target.id });
    }
    if (target && target.kind === 'building' && target.owner === playerIdx) {
      var hasEngineer = false;
      for (var i = 0; i < ids.length; i++) {
        var e = Sim.byId(state, ids[i]);
        if (e && e.def.abilities && e.def.abilities.indexOf('capture') >= 0) hasEngineer = true;
      }
      if (target.type === 'refinery' && !hasEngineer) {
        return Sim.issueOrder(state, playerIdx, ids, { type: 'dock', targetId: target.id });
      }
    }
    var tx = Math.floor(worldX), ty = Math.floor(worldY);
    if (state.map.inside(tx, ty) && state.map.ore[state.map.idx(tx, ty)] > 0) {
      return Sim.issueOrder(state, playerIdx, ids, { type: 'harvest', x: worldX, y: worldY });
    }
    return Sim.issueOrder(state, playerIdx, ids, { type: 'move', x: worldX, y: worldY });
  };

  // =====================================================================
  // Combat
  // =====================================================================
  function weaponRange(weapon, e) {
    return weapon.range;
  }
  Sim.weaponRange = weaponRange;

  function acquireTarget(state, e, weapon, range) {
    var p = entityPoint(e);
    var best = null, bestScore = 1e9;
    var near = queryNear(state, p.x, p.y, range + 1.5);
    for (var i = 0; i < near.length; i++) {
      var t = near[i];
      if (t.id === e.id || t.owner === e.owner) continue;
      if (!canTarget(weapon, t)) continue;
      if (!Sim.isEntityVisible(state, e.owner, t)) continue;
      var tp = entityPoint(t);
      var d = U.dist(p.x, p.y, tp.x, tp.y);
      if (d > range) continue;
      if (t.kind === 'building' && !t.complete) d += 0.5;
      if (!losTo(state, p.x, p.y, t)) continue;
      var score = d;
      if (t.kind === 'unit') score -= 0.9;
      if (t.targetId === e.id || (t.order && t.order.targetId === e.id)) score -= 1.6;
      if (t.def.flying) score -= 0.3;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  /**
   * Line of sight to an entity.  A structure's own footprint counts as clear
   * (otherwise nothing could ever shoot at a building), everything else blocks.
   */
  function losTo(state, x0, y0, target) {
    var tp = entityPoint(target);
    if (target.kind === 'building') {
      var bx = target.x, by = target.y, bw = target.w, bh = target.h;
      return Pathfind.clearLine(state.map, x0, y0, tp.x, tp.y, function (tx, ty) {
        if (tx >= bx && tx < bx + bw && ty >= by && ty < by + bh) return false;
        return state.map.isBlockedTile(tx, ty);
      });
    }
    return Pathfind.clearLine(state.map, x0, y0, tp.x, tp.y);
  }
  Sim.losTo = losTo;

  function tryFire(state, e, target, weapon, range) {
    if (e.cooldown > 0) return false;
    var rank = e.kind === 'unit' ? Rules.RANKS[e.rank] : Rules.RANKS[0];
    var from = entityPoint(e);
    var to = entityPoint(target);
    if (U.dist(from.x, from.y, to.x, to.y) > range) return false;
    if (e.kind === 'unit' && e.def.turret) {
      var want = Math.atan2(to.y - from.y, to.x - from.x);
      // Barrel has to be lined up before the gun can fire.
      if (Math.abs(U.angleDiff(e.turret, want)) > 0.30) return false;
    }
    e.cooldown = weapon.rof * rank.rofMul;
    var dmg = weapon.damage * rank.dmg;
    var muzzle;
    if (e.kind === 'unit' && e.def.turret) {
      var len = (e.def.turretLength || 0.55);
      muzzle = { x: from.x + Math.cos(e.turret) * len, y: from.y + Math.sin(e.turret) * len };
    } else {
      muzzle = { x: from.x, y: from.y };
    }

    var wtype = weapon.projectile;
    if (wtype === 'tracer' || wtype === 'beam' || wtype === 'tesla' || wtype === 'flak') {
      if (wtype === 'tracer') {
        addEffect(state, 'tracer', muzzle.x, muzzle.y, 5, { x2: to.x, y2: to.y, owner: e.owner });
      } else if (wtype === 'beam') {
        addEffect(state, 'beam', from.x, from.y, 7, { x2: to.x, y2: to.y, owner: e.owner });
      } else if (wtype === 'tesla') {
        addEffect(state, 'tesla', from.x, from.y, 10, { x2: to.x, y2: to.y, owner: e.owner, seed: Math.floor(state.rng() * 1000) });
      } else {
        addEffect(state, 'flakburst', to.x, to.y, 8, { owner: e.owner });
      }
      addEffect(state, 'muzzle', muzzle.x, muzzle.y, 4, { owner: e.owner, size: weapon.damage > 50 ? 1.3 : 0.8 });
      applyDamage(state, target, dmg, weapon.warhead, e, e.owner);
      if (weapon.splash) splashDamage(state, to.x, to.y, weapon.splash, dmg * 0.5, weapon.warhead, e.owner, target.id);
    } else {
      var speed = weapon.speed || 12;
      var proj = {
        id: state.nextId++,
        kind: 'projectile',
        owner: e.owner,
        x: muzzle.x, y: muzzle.y,
        damage: dmg,
        warhead: weapon.warhead,
        splash: weapon.splash || 0,
        speed: speed,
        type: wtype,
        targetId: target.id,
        sourceId: e.id,
        tx: to.x, ty: to.y,
        life: 0,
        maxLife: Math.round(HZ * 6),
        dead: false
      };
      state.projectiles.push(proj);
      addEffect(state, 'muzzle', muzzle.x, muzzle.y, 5, { owner: e.owner, size: weapon.damage > 50 ? 1.5 : 1 });
      addEvent(state, { type: 'shot', weapon: weapon.projectile, x: muzzle.x, y: muzzle.y, big: weapon.damage > 60 });
    }
    return true;
  }
  Sim.tryFire = tryFire;

  function applyDamage(state, target, amount, warhead, source, sourceOwner) {
    if (!target || target.dead) return 0;
    var mult = Rules.warheadMultiplier(warhead, target.def.armor);
    if (target.kind === 'building' && !target.complete) mult *= 1.25;
    var dmg = amount * mult;
    if (dmg <= 0) return 0;
    target.hp -= dmg;
    target.flash = Math.max(target.flash || 0, 4);
    if (target.kind === 'building') target.lastHurtTick = state.tick;
    var victim = state.players[target.owner];
    if (victim && sourceOwner !== target.owner) {
      if (!victim.lastHurtTick || state.tick - victim.lastHurtTick > 25 * HZ) {
        var hp = Sim.entityPoint(target);
        addEvent(state, { type: 'underAttack', player: target.owner, x: hp.x, y: hp.y });
      }
      victim.lastHurtTick = state.tick;
    }
    if (target.hp <= 0) {
      killEntity(state, target, source, sourceOwner);
    }
    return dmg;
  }
  Sim.applyDamage = applyDamage;

  function killEntity(state, target, source, sourceOwner) {
    if (target.dead) return;
    if (source && source.kind === 'unit' && sourceOwner !== undefined && sourceOwner !== target.owner) {
      addXp(state, source, target);
    } else if (source && source.kind === 'building' && sourceOwner !== undefined && sourceOwner !== target.owner) {
      // defences do not gain ranks
    }
    var victimOwner = state.players[target.owner];
    if (victimOwner && sourceOwner !== undefined && sourceOwner !== target.owner && sourceOwner >= 0) {
      var killer = state.players[sourceOwner];
      if (killer) killer.stats.kills++;
    }
    if (target.kind === 'unit') {
      if (victimOwner) victimOwner.stats.unitsLost++;
    }
    removeEntity(state, target);
  }

  function addXp(state, unit, victim) {
    if (!unit || unit.dead || unit.kind !== 'unit') return;
    unit.xp += Rules.xpForKill(victim.def);
    var newRank = Rules.rankForXp(unit.xp);
    if (newRank > unit.rank) {
      unit.rank = newRank;
      var rk = Rules.RANKS[newRank];
      var oldMax = unit.maxHp;
      unit.maxHp = unit.def.maxHp * rk.hpMul;
      unit.hp += unit.maxHp - oldMax;
      unit.sight = unit.def.sight * rk.sightMul;
      addEffect(state, 'promote', unit.x, unit.y, 26, { owner: unit.owner });
      addEvent(state, { type: 'promote', player: unit.owner, x: unit.x, y: unit.y, rank: newRank });
    }
  }

  function splashDamage(state, x, y, radius, amount, warhead, owner, excludeId) {
    var near = queryNear(state, x, y, radius);
    for (var i = 0; i < near.length; i++) {
      var t = near[i];
      if (t.dead || t.owner === owner) continue;
      if (excludeId && t.id === excludeId) continue;
      if (!Rules.canWarheadHit(warhead, t)) continue;
      var p = entityPoint(t);
      var d = U.dist(p.x, p.y, x, y);
      if (d > radius) continue;
      var falloff = 1 - 0.7 * U.clamp(d / radius, 0, 1);
      applyDamage(state, t, amount * falloff, warhead, null, owner);
    }
  }
  Sim.splashDamage = splashDamage;

  function updateProjectiles(state) {
    for (var i = 0; i < state.projectiles.length; i++) {
      var pr = state.projectiles[i];
      if (pr.dead) continue;
      pr.life++;
      var target = Sim.byId(state, pr.targetId);
      if (target) {
        var tp = entityPoint(target);
        pr.tx = tp.x; pr.ty = tp.y;
      }
      var dx = pr.tx - pr.x, dy = pr.ty - pr.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var step = pr.speed / HZ;
      if (d <= step + 0.05) {
        pr.x = pr.tx; pr.y = pr.ty;
        pr.dead = true;
        var hit = target && !target.dead && target.owner !== pr.owner ? target : null;
        if (hit) applyDamage(state, hit, pr.damage, pr.warhead, { id: pr.sourceId, kind: 'unit' }, pr.owner);
        var splashR = pr.splash || (pr.type === 'rocket' ? 0.55 : 0.35);
        splashDamage(state, pr.x, pr.y, splashR, pr.damage * 0.35, pr.warhead, pr.owner, hit ? hit.id : 0);
        addEffect(state, 'impact', pr.x, pr.y, pr.type === 'rocket' ? 14 : 9, { owner: pr.owner, size: pr.type === 'rocket' ? 1.2 : 0.7 });
        addEvent(state, { type: 'impact', x: pr.x, y: pr.y, size: pr.damage });
        continue;
      }
      pr.x += (dx / d) * step;
      pr.y += (dy / d) * step;
      if (pr.life > pr.maxLife) pr.dead = true;
    }
    if (state.projectiles.length > 1200) {
      state.projectiles = state.projectiles.filter(function (p) { return !p.dead; });
    }
  }

  // =====================================================================
  // Movement
  // =====================================================================
  function stepUnitMovement(state, u, dt) {
    if (!u.path || u.pathIdx >= u.path.length) {
      u.vx = 0; u.vy = 0;
      return false;
    }
    var wp = u.path[u.pathIdx];
    var dx = wp.x - u.x, dy = wp.y - u.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.16) {
      u.pathIdx++;
      if (u.pathIdx >= u.path.length) {
        u.path = null;
        u.vx = 0; u.vy = 0;
        onArrive(state, u);
        return false;
      }
      wp = u.path[u.pathIdx];
      dx = wp.x - u.x; dy = wp.y - u.y;
      d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    }
    var desired = Math.atan2(dy, dx);
    u.facing = U.turnToward(u.facing, desired, (u.def.turnRate || 4) / HZ);
    var diff = Math.abs(U.angleDiff(u.facing, desired));
    var speed = u.speed * (diff > 1.2 ? 0.25 : (diff > 0.6 ? 0.65 : 1));
    if (u.def.flying) speed = u.speed;
    var dist = speed / HZ;

    var nx = u.x + Math.cos(u.facing) * dist;
    var ny = u.y + Math.sin(u.facing) * dist;
    // If a unit somehow ends up inside a structure it must always be able to
    // walk back out, otherwise it would be stuck forever.
    var wedged = !u.def.flying && !canStep(state, u, u.x, u.y);
    if (u.def.flying || wedged || canStep(state, u, nx, ny)) {
      u.x = nx; u.y = ny;
    } else if (canStep(state, u, nx, u.y)) {
      u.x = nx;
    } else if (canStep(state, u, u.x, ny)) {
      u.y = ny;
    } else {
      // Wedged on a corner: slide sideways for a moment to break free.
      var slide = null;
      var escapes = [0.7, -0.7, 1.3, -1.3, 2.0, -2.0, 2.7, -2.7];
      for (var ei = 0; ei < escapes.length; ei++) {
        var ea = u.facing + escapes[ei];
        var ex = u.x + Math.cos(ea) * dist;
        var ey = u.y + Math.sin(ea) * dist;
        if (canStep(state, u, ex, ey)) { slide = { x: ex, y: ey }; break; }
      }
      if (slide) {
        u.x = slide.x; u.y = slide.y;
        u.stuckTicks += 1;
      } else {
        u.stuckTicks += 2;
      }
    }
    u.vx = Math.cos(u.facing) * speed;
    u.vy = Math.sin(u.facing) * speed;

    var moved = U.dist(u.x, u.y, u.lastX, u.lastY);
    u.moveTicks++;
    if (u.moveTicks >= 40) {
      if (moved < 0.22) u.stuckTicks += 30;
      u.moveTicks = 0;
      u.lastX = u.x; u.lastY = u.y;
    }
    if (u.stuckTicks > 26 && u.repathCooldown <= 0) {
      u.stuckTicks = 0;
      var goal = u.path[u.path.length - 1];
      if (!computePath(state, u, goal.x, goal.y)) {
        u.path = null;
        onArrive(state, u, true);
      }
    }
    if (u.stuckTicks > 40) {
      // Absolute last resort: nudge the unit out of a pocket it cannot walk
      // out of.  Without this a single bad corner could freeze a miner forever.
      var escapeTile = Pathfind.nearestFreeTile(state.map, Math.floor(u.x), Math.floor(u.y), 4);
      if (escapeTile) {
        u.x = escapeTile.x + 0.5;
        u.y = escapeTile.y + 0.5;
        u.path = null;
        u.stuckTicks = 0;
        onArrive(state, u, true);
      } else {
        u.stuckTicks = 0;
      }
    }
    return true;
  }

  function canStep(state, u, nx, ny) {
    var r = u.def.radius || 0.25;
    var pts = [[nx, ny], [nx + r * 0.7, ny], [nx - r * 0.7, ny], [nx, ny + r * 0.7], [nx, ny - r * 0.7]];
    for (var i = 0; i < pts.length; i++) {
      var tx = Math.floor(pts[i][0]), ty = Math.floor(pts[i][1]);
      if (state.map.isBlockedTile(tx, ty)) return false;
    }
    return true;
  }

  function onArrive(state, u, failed) {
    if (u.order) {
      if (u.order.type === 'move' || u.order.type === 'attackMove') {
        if (u.order.type === 'move' && u.nextAfterMove === 'harvest') {
          u.nextAfterMove = null;
          u.order = { type: 'harvest' };
          u.state = 'seek';
          return;
        }
        u.order = { type: 'guard', x: u.x, y: u.y };
        u.homeX = u.x; u.homeY = u.y;
      }
    }
    u.vx = 0; u.vy = 0;
  }

  function separateUnits(state) {
    // Cheap spatial separation so groups spread out instead of stacking.
    var sp = state.spatial;
    for (var ci = 0; ci < sp.cells.length; ci++) {
      var list = sp.cells[ci];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.dead || a.kind !== 'unit' || a.def.flying) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (b.dead || b.kind !== 'unit' || b.def.flying) continue;
          var ra = a.def.radius || 0.25, rb = b.def.radius || 0.25;
          var minD = (ra + rb) * 0.92;
          var dx = b.x - a.x, dy = b.y - a.y;
          var d2 = dx * dx + dy * dy;
          if (d2 > minD * minD || d2 < 1e-9) {
            if (d2 < 1e-9) { dx = 0.01; dy = 0.01; d2 = dx * dx + dy * dy; }
            else continue;
          }
          var d = Math.sqrt(d2);
          var push = (minD - d) * 0.5;
          var ux = dx / d, uy = dy / d;
          var aMoving = !!a.path, bMoving = !!b.path;
          var wa = bMoving && !aMoving ? 0.15 : 0.5;
          var wb = aMoving && !bMoving ? 0.15 : 0.5;
          if (canStep(state, a, a.x - ux * push * wa * 2, a.y - uy * push * wa * 2)) {
            a.x -= ux * push * wa * 2; a.y -= uy * push * wa * 2;
          }
          if (canStep(state, b, b.x + ux * push * wb * 2, b.y + uy * push * wb * 2)) {
            b.x += ux * push * wb * 2; b.y += uy * push * wb * 2;
          }
        }
      }
    }
  }

  // =====================================================================
  // Per-unit update
  // =====================================================================
  function updateUnit(state, u) {
    if (u.dead) return;
    if (u.cooldown > 0) u.cooldown--;
    if (u.repathCooldown > 0) u.repathCooldown--;
    if (u.flash > 0) u.flash--;
    if (u.rank > 0) {
      var regen = Rules.RANKS[u.rank].regen / HZ;
      if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + regen);
    }
    var weapon = primaryWeapon(u);

    // Miners run their own state machine.
    if (u.def.capacity) { updateHarvester(state, u); return; }

    // Engineers
    if (u.order && u.order.type === 'capture') {
      var b = Sim.byId(state, u.order.targetId);
      if (!b || b.owner === u.owner) { u.order = { type: 'guard', x: u.x, y: u.y }; clearPath(u); }
      else {
        var bp = entityPoint(b);
        var d = U.dist(u.x, u.y, bp.x, bp.y);
        if (d < Math.max(b.w, b.h) * 0.5 + 0.9) {
          captureBuilding(state, b, u);
          return;
        }
        if (!u.path || u.repathCooldown <= 0) computePath(state, u, bp.x, bp.y);
        stepUnitMovement(state, u, 1 / HZ);
        return;
      }
    }

    if (!weapon) {
      if (u.path) stepUnitMovement(state, u, 1 / HZ);
      return;
    }

    var range = weaponRange(weapon, u);
    var order = u.order || { type: 'guard' };
    var target = Sim.byId(state, u.targetId);
    if (target && (target.dead || target.owner === u.owner || !canTarget(weapon, target))) {
      target = null; u.targetId = 0;
      if (order.type === 'attack') { order = { type: 'guard', x: u.x, y: u.y }; u.order = order; }
    }

    if (order.type === 'attack') {
      target = Sim.byId(state, order.targetId) || null;
      if (!target) { u.order = { type: 'guard', x: u.x, y: u.y }; return; }
      u.targetId = target.id;
      var tp = entityPoint(target);
      var dist = U.dist(u.x, u.y, tp.x, tp.y);
      var reach = range + entityRadius(target) * 0.85;
      if (dist <= reach && losTo(state, u.x, u.y, target)) {
        u.path = null;
        turnTo(state, u, target);
        if (tryFire(state, u, target, weapon, reach)) { /* fired */ }
      } else {
        // On the way to the objective, return fire at anything in reach
        // instead of marching past a defence gun that is shooting us.
        var threat = acquireTarget(state, u, weapon, range);
        if (threat) {
          turnTo(state, u, threat);
          tryFire(state, u, threat, weapon, range);
        } else {
          turnTo(state, u, target);
        }
        if (!u.path || u.repathCooldown <= 0) {
          var approach = approachPoint(state, u, target, reach * 0.8);
          computePath(state, u, approach.x, approach.y);
        }
        stepUnitMovement(state, u, 1 / HZ);
      }
      return;
    }

    if (order.type === 'attackMove') {
      var auto = acquireTarget(state, u, weapon, range);
      if (auto) {
        turnTo(state, u, auto);
        if (!tryFire(state, u, auto, weapon, range)) {
          if (!u.path || u.repathCooldown <= 0) computePath(state, u, entityPoint(auto).x, entityPoint(auto).y);
        } else if (U.dist(u.x, u.y, entityPoint(auto).x, entityPoint(auto).y) > range) {
          // keep closing in
        }
        if (u.path) stepUnitMovement(state, u, 1 / HZ);
        return;
      }
      if (u.path) { stepUnitMovement(state, u, 1 / HZ); return; }
      // reached the destination (or unreachable): guard from here
      u.order = { type: 'guard', x: u.x, y: u.y };
      u.homeX = u.x; u.homeY = u.y;
      order = u.order;
    }

    // Guard / idle: hold position but shot at anything in range.
    var autoT = acquireTarget(state, u, weapon, range);
    if (autoT) {
      u.targetId = autoT.id;
      turnTo(state, u, autoT);
      tryFire(state, u, autoT, weapon, range);
      return;
    }
    u.targetId = 0;
    if (u.path) { stepUnitMovement(state, u, 1 / HZ); return; }
    // drift back home when idle after a long leash
    if (order.type === 'guard' && (U.dist(u.x, u.y, order.x, order.y) > 0.8) && u.def.tab === 'vehicles' && false) {
      // (leash kept simple: units stay where they were told to stand)
    }
  }

  function turnTo(state, u, target) {
    var tp = entityPoint(target);
    var want = Math.atan2(tp.y - u.y, tp.x - u.x);
    if (u.def.turret) {
      u.turret = U.turnToward(u.turret, want, (u.def.turretRate || 2) / HZ);
      // hull roughly follows the turret so the tank does not look broken
      if (!u.path) u.facing = U.turnToward(u.facing, want, (u.def.turnRate || 2) * 0.6 / HZ);
    } else {
      u.facing = U.turnToward(u.facing, want, (u.def.turnRate || 5) / HZ);
      if (u.def.turret) u.turret = u.facing;
    }
  }

  function approachPoint(state, u, target, stopDist) {
    var tp = entityPoint(target);
    var dx = u.x - tp.x, dy = u.y - tp.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    var tx = tp.x + (dx / d) * stopDist;
    var ty = tp.y + (dy / d) * stopDist;
    var free = Pathfind.nearestFreeTile(state.map, Math.floor(tx), Math.floor(ty), 3);
    if (free) return { x: free.x + 0.5, y: free.y + 0.5 };
    return { x: tx, y: ty };
  }

  function captureBuilding(state, b, engineer) {
    var oldOwner = b.owner;
    b.owner = engineer.owner;
    b.hp = Math.max(1, b.maxHp * Rules.CAPTURE_HP_FRACTION);
    b.targetId = 0;
    b.repairing = false;
    engineer.dead = true;
    engineer.deathTick = state.tick;
    bumpBuilt(state, engineer.owner, b.type);
    addEffect(state, 'capture', b.cx, b.cy, 30, { owner: engineer.owner });
    addEvent(state, { type: 'capture', player: engineer.owner, from: oldOwner, x: b.cx, y: b.cy, typeId: b.type });
    Pathfind.invalidate();
    updatePower(state);
  }
  Sim.captureBuilding = captureBuilding;

  // =====================================================================
  // Harvesting
  // =====================================================================
  function updateHarvester(state, u) {
    if (u.order && u.order.type === 'move' && u.path) {
      stepUnitMovement(state, u, 1 / HZ);
      if (u.path) return;
    }
    if (u.cooldown > 0) u.cooldown--;

    if (u.state === 'seek') {
      if (u.cargo >= u.def.capacity) { u.state = 'return'; return; }
      var tx = Math.floor(u.x), ty = Math.floor(u.y);
      var onOre = state.map.inside(tx, ty) && state.map.ore[state.map.idx(tx, ty)] > 0;
      if (onOre) {
        u.state = 'harvesting'; u.harvestTimer = 0; u.harvestSpot = null;
        u.seekTarget = null; u.badSpots = null;
        return;
      }
      if (u.harvestSpot) {
        var hsx = Math.floor(u.harvestSpot.x), hsy = Math.floor(u.harvestSpot.y);
        if (!state.map.inside(hsx, hsy) || state.map.ore[state.map.idx(hsx, hsy)] <= 0) u.harvestSpot = null;
      }
      // Only pick a new target when the current run is finished: re-targeting
      // every few ticks makes miners run back and forth forever.
      if (!u.path) {
        var spot = u.harvestSpot
          ? { x: Math.floor(u.harvestSpot.x), y: Math.floor(u.harvestSpot.y) }
          : findOreSpot(state, u);
        if (!spot) {
          u.state = 'idle';
          u.order = { type: 'guard', x: u.x, y: u.y };
          if (!u.lastNoOreEvent || state.tick - u.lastNoOreEvent > 20 * HZ) {
            addEvent(state, { type: 'noOre', player: u.owner });
            u.lastNoOreEvent = state.tick;
          }
          return;
        }
        u.seekTarget = spot;
        computePath(state, u, spot.x + 0.5, spot.y + 0.5);
        if (!u.path) markBadSpot(state, u, spot);
      }
      if (!stepUnitMovement(state, u, 1 / HZ)) {
        // Arrived, or the route collapsed: blacklist that tile for a while so
        // the miner does not pick it again and again.
        var st = u.seekTarget;
        if (st) markBadSpot(state, u, st);
        u.seekTarget = null;
        u.state = 'seek';
      }
      return;
    }

    if (u.state === 'harvesting') {
      var hx = Math.floor(u.x), hy = Math.floor(u.y);
      if (!state.map.inside(hx, hy) || state.map.ore[state.map.idx(hx, hy)] <= 0) {
        u.state = u.cargo >= u.def.capacity ? 'return' : 'seek';
        return;
      }
      u.harvestTimer++;
      if (u.harvestTimer >= u.def.harvestInterval) {
        u.harvestTimer = 0;
        var i = state.map.idx(hx, hy);
        var take = Math.min(Rules.ORE_BAIL, state.map.ore[i]);
        var kind = state.map.oreKind[i] || 1;
        state.map.ore[i] -= take;
        var value = take * (kind === MapGen.ORE_GEM ? Rules.GEM_MULTIPLIER : 1);
        var room = u.def.capacity - u.cargo;
        var gained = Math.min(room, value);
        u.cargo += gained;
        u.cargoKind = kind;
        var owner = state.players[u.owner];
        if (owner) {
          owner.stats.oreHarvested += gained;
        }
        addEffect(state, 'harvest', u.x, u.y, 12, { owner: u.owner, kind: kind });
        if (u.cargo >= u.def.capacity) u.state = 'return';
      }
      return;
    }

    if (u.state === 'return' || u.state === 'docking') {
      var ref = u.dockRef ? Sim.byId(state, u.dockRef) : null;
      if (!ref || ref.dead || ref.owner !== u.owner || ref.type !== 'refinery' || !ref.complete) {
        ref = findRefinery(state, u);
        u.dockRef = ref ? ref.id : 0;
        if (ref) u.dockSlot = nextDockSlot(state, ref, u);
      }
      if (!ref) {
        // No refinery: wait where we are (the player gets a warning).
        u.state = 'return';
        u.path = null;
        if (state.tick % (30 * HZ) === 0) addEvent(state, { type: 'noRefinery', player: u.owner });
        return;
      }
      if (u.cargo <= 0) { u.state = 'seek'; u.dockRef = 0; return; }
      var dock = { x: ref.dockX + u.dockSlot * 0.9, y: ref.dockY + 0.2 };
      var d = U.dist(u.x, u.y, dock.x, dock.y);
      var arrived = !u.path;
      var dRef = U.dist(u.x, u.y, ref.cx, ref.cy);
      u.returnTicks = (u.returnTicks || 0) + 1;
      // Normal docking, plus two fail-safes so a miner can never get stuck
      // waiting for a bay that somebody built over.
      var closeEnough = d < 1.2 ||
        (arrived && (d < 2.6 || dRef < Math.max(ref.w, ref.h) * 0.5 + 2.6)) ||
        (u.returnTicks > 6 * HZ && dRef < 14);
      if (closeEnough || u.state === 'docking') {
        u.returnTicks = 0;
        u.state = 'docking';
        u.unloadTimer++;
        u.path = null;
        if (u.unloadTimer >= 45) {
          Sim.earn(state, u.owner, u.cargo);
          addEvent(state, { type: 'unload', player: u.owner, amount: u.cargo, x: ref.cx, y: ref.cy });
          u.cargo = 0;
          u.unloadTimer = 0;
          u.state = 'seek';
          u.dockRef = 0;
          u.path = null;
          u.returnTicks = 0;
        }
        return;
      }
      if (u.state !== 'docking') u.returnTicks = U.clamp(u.returnTicks, 0, 6 * HZ + 30);
      if (!u.path || u.repathCooldown <= 0) computePath(state, u, dock.x, dock.y);
      stepUnitMovement(state, u, 1 / HZ);
      return;
    }

    if (u.state === 'idle' || u.state === 'unloading') {
      u.state = u.cargo >= u.def.capacity ? 'return' : 'seek';
    }
  }

  function findOreSpot(state, u) {
    // Prefer a *rich* tile close by rather than the nearest nearly-empty one.
    var map = state.map;
    var bad = activeBadSpots(state, u);
    var spot = bestOreTileNearFiltered(map, u.x, u.y, 17, bad);
    if (spot) return spot;
    spot = bestOreTileNearFiltered(map, u.homeX, u.homeY, 30, bad);
    if (spot) return spot;
    spot = bestOreTileNearFiltered(map, map.w / 2, map.h / 2, Math.max(map.w, map.h), bad);
    if (spot) return spot;
    return MapGen.findOre(map, u.x, u.y, Math.max(map.w, map.h));
  }

  function bestOreTileNear(map, x, y, radius) {
    return bestOreTileNearFiltered(map, x, y, radius, null);
  }

  function bestOreTileNearFiltered(map, x, y, radius, bad) {
    var best = null, bestScore = -1e9;
    var x0 = Math.max(0, Math.floor(x - radius)), x1 = Math.min(map.w - 1, Math.ceil(x + radius));
    var y0 = Math.max(0, Math.floor(y - radius)), y1 = Math.min(map.h - 1, Math.ceil(y + radius));
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var i = map.idx(tx, ty);
        var amount = map.ore[i];
        if (amount <= 0) continue;
        if (bad && isBadSpot(bad, tx, ty)) continue;
        var d = U.dist(tx + 0.5, ty + 0.5, x, y);
        var score = amount * 0.8 - d * 4.5;
        if (score > bestScore) { bestScore = score; best = { x: tx, y: ty }; }
      }
    }
    return best;
  }

  function isBadSpot(bad, tx, ty) {
    for (var i = 0; i < bad.length; i++) {
      if (bad[i].x === tx && bad[i].y === ty) return true;
    }
    return false;
  }

  /** Remember ore tiles a miner could not reach, for a short while. */
  function markBadSpot(state, u, spot) {
    if (!u.badSpots) u.badSpots = [];
    for (var i = 0; i < u.badSpots.length; i++) {
      if (u.badSpots[i].x === spot.x && u.badSpots[i].y === spot.y) {
        u.badSpots[i].t = state.tick;
        return;
      }
    }
    u.badSpots.push({ x: spot.x, y: spot.y, t: state.tick });
    while (u.badSpots.length > 5) u.badSpots.shift();
  }

  function activeBadSpots(state, u) {
    if (!u.badSpots || !u.badSpots.length) return null;
    var out = [];
    for (var i = 0; i < u.badSpots.length; i++) {
      if (state.tick - u.badSpots[i].t < 20 * HZ) out.push(u.badSpots[i]);
    }
    return out.length ? out : null;
  }

  function findRefinery(state, u) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead || b.owner !== u.owner || b.type !== 'refinery' || !b.complete) continue;
      var d = U.dist2(u.x, u.y, b.cx, b.cy);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Refineries have two unloading bays so miners do not stack up. */
  function nextDockSlot(state, ref, self) {
    var used = 0;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.dead || u === self || u.dockRef !== ref.id) continue;
      if (u.state === 'docking' || (u.state === 'return' && u.path && u.path.length <= 1)) used++;
    }
    return used % 2;
  }

  // =====================================================================
  // Buildings
  // =====================================================================
  function updateBuilding(state, b) {
    if (b.dead) return;
    if (b.flash > 0) b.flash--;
    if (!b.complete) {
      var rate = Math.max(1, Sim.productionRate(state, b.owner, 'structures'));
      b.buildTicks -= rate;
      var frac = 1 - U.clamp(b.buildTicks / b.buildTotal, 0, 1);
      b.hp = Math.max(1, b.maxHp * U.lerp(0.08, 1, frac));
      if (b.buildTicks <= 0) {
        b.complete = true;
        b.hp = b.maxHp;
        state.players[b.owner].stats.buildingsBuilt++;
        updatePower(state);
        addEvent(state, { type: 'buildingComplete', player: b.owner, typeId: b.type, x: b.cx, y: b.cy });
        if (b.type === 'refinery') {
          // free ore miner with the first refinery
          var miners = Sim.unitCount(state, b.owner, function (u) { return !!u.def.capacity; });
          if (miners === 0) {
            var spot = Sim.exitPoints(state, b)[0];
            var m = spawnUnit(state, b.owner, 'harvester', spot.x, spot.y);
            addEvent(state, { type: 'unitReady', player: b.owner, typeId: 'harvester', id: m.id, free: true });
          }
        }
      }
    } else if (b.repairing) {
      if (b.hp < b.maxHp) {
        var heal = Math.min(Rules.REPAIR_RATE, b.maxHp - b.hp);
        var cost = heal * Rules.REPAIR_COST_PER_HP;
        if (Sim.spend(state, b.owner, cost)) b.hp += heal;
        else b.repairing = false;
      } else {
        b.repairing = false;
      }
    }
    var weapon = primaryWeapon(b);
    if (!weapon) {
      if (b.hp <= 0) removeEntity(state, b);
      return;
    }
    if (b.cooldown > 0) b.cooldown--;
    var p = state.players[b.owner];
    if (p.power.low) return;                      // defences go offline
    if (!b.complete) return;
    var range = weapon.range;
    var target = b.targetId ? Sim.byId(state, b.targetId) : null;
    if (target && (target.dead || target.owner === b.owner || !canTarget(weapon, target))) {
      target = null; b.targetId = 0;
    }
    if (!target) {
      target = acquireTarget(state, b, weapon, range);
      b.targetId = target ? target.id : 0;
    }
    if (!target) { b.targetId = 0; return; }
    var tp = entityPoint(target);
    if (U.dist(b.cx, b.cy, tp.x, tp.y) > range) { b.targetId = 0; return; }
    var w = primaryWeapon(b);
    tryFire(state, b, target, weapon, range);
  }

  // =====================================================================
  // Effects
  // =====================================================================
  function updateEffects(state) {
    for (var i = state.effects.length - 1; i >= 0; i--) {
      var e = state.effects[i];
      e.t++;
      if (e.t >= e.life) state.effects.splice(i, 1);
    }
    for (i = state.decals.length - 1; i >= 0; i--) {
      state.decals[i].t++;
    }
    // projectiles cleanup
    for (i = state.projectiles.length - 1; i >= 0; i--) {
      if (state.projectiles[i].dead) state.projectiles.splice(i, 1);
    }
  }

  // =====================================================================
  // Ore regrowth
  // =====================================================================
  function updateOre(state) {
    state.oreTick = (state.oreTick || 0) + 1;
    if (state.oreTick % Rules.ORE_REGROW_TICKS !== 0) return;
    var map = state.map;
    var idx = state.oreTick / Rules.ORE_REGROW_TICKS;
    for (var i = idx % 2; i < map.ore.length; i += 2) {
      if (map.oreKind[i] !== MapGen.ORE_ORE) continue;
      if (map.ore[i] < map.oreMax[i]) map.ore[i] += 1;
    }
  }

  // =====================================================================
  // Victory
  // =====================================================================
  function checkVictory(state) {
    if (state.over) return;
    var alive = 0, lastAlive = -1;
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.defeated) continue;
      var buildings = Sim.buildingCount(state, i, null, false);
      if (buildings === 0) {
        p.defeated = true;
        p.defeatedTick = state.tick;
        addEvent(state, { type: 'defeated', player: i });
        continue;
      }
      alive++;
      lastAlive = i;
    }
    if (alive <= 1) {
      state.over = true;
      state.winner = lastAlive;
      state.endTick = state.tick;
      addEvent(state, { type: 'gameOver', winner: lastAlive });
    }
  }

  // =====================================================================
  // Main step
  // =====================================================================
  Sim.step = function (state) {
    if (state.over) return;
    state.tick++;
    state.byId = buildEntityMap(state);
    state.spatial = rebuildIndex(state);

    updateQueues(state);

    var i, e;
    for (i = 0; i < state.units.length; i++) {
      e = state.units[i];
      if (!e.dead) updateUnit(state, e);
    }
    for (i = 0; i < state.buildings.length; i++) {
      e = state.buildings[i];
      if (!e.dead) updateBuilding(state, e);
    }
    separateUnits(state);
    updateProjectiles(state);
    updateOre(state);
    updateEffects(state);
    updatePower(state);

    if (state.tick % 4 === 0) updateAllVisibility(state);

    // Sudden death: the satellite net comes online, the shroud lifts and the
    // match is guaranteed to converge instead of dragging on forever.
    if (state.suddenDeathAt && state.tick === state.suddenDeathAt && state.fog) {
      state.fog = false;
      for (i = 0; i < state.players.length; i++) {
        state.players[i].visibility.explored.fill(1);
        state.players[i].visibility.visible.fill(1);
      }
      addEvent(state, { type: 'suddenDeath' });
    }

    if (state.players.some(function (p) { return p.isAI && !p.defeated; })) {
      RA.AI.update(state);
    }

    // Bookkeeping
    for (i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (p.defeated) continue;
      var army = Sim.unitCount(state, i, function (u) { return !!Sim.primaryWeapon(u) && !u.def.flying; });
      if (army > p.stats.peakArmy) p.stats.peakArmy = army;
    }

    if (state.tick % 15 === 0) checkVictory(state);

    // Compact arrays
    if (state.tick % 10 === 0) {
      state.units = state.units.filter(function (u) { return !u.dead; });
      state.buildings = state.buildings.filter(function (b) { return !b.dead; });
      state.byId = buildEntityMap(state);
    }
  };

  Sim.buildEntityMap = buildEntityMap;
  Sim.checkVictory = checkVictory;

  /** Convenience used by tests and the AI: how much army does a player have? */
  Sim.armyValue = function (state, playerIdx) {
    var v = 0;
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.dead || u.owner !== playerIdx) continue;
      if (!Sim.primaryWeapon(u)) continue;
      v += u.def.cost * (u.hp / u.maxHp);
    }
    return v;
  };

  RA.Sim = Sim;
  RA.Game = { create: Sim.createGame, step: Sim.step };
})(globalThis.RA = globalThis.RA || {});
