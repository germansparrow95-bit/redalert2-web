/*
 * Red Alert Web - the computer opponent.
 *
 * The AI plays through exactly the same API as the human player: it queues
 * builds, places structures, trains units and issues attack-move orders.  It
 * respects its own fog of war, so it only reacts to what it has actually seen.
 *
 * Difficulty changes behaviour (thinking speed, production speed, wave size)
 * instead of giving it free money.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var Sim = RA.Sim;
  var MapGen = RA.MapGen;

  var AI = RA.AI = {};

  function createBrain(p) {
    return {
      thinkInterval: p.difficulty === 'hard' ? 9 : (p.difficulty === 'easy' ? 20 : 14),
      armyTarget: 0,
      waveSize: 0,
      wave: null,
      lastWaveTick: 0,
      lastScoutTick: 0,
      lastExpandTick: 0,
      baseX: 0, baseY: 0,
      lastDefenseTick: 0,
      panic: 0,
      defenderIds: [],
      attackTargets: [],
      stuckTicks: 0
    };
  }

  AI.update = function (state) {
    for (var i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      if (!p.isAI || p.defeated) continue;
      if (!p.ai) p.ai = createBrain(p);
      if ((state.tick + p.index * 5) % p.ai.thinkInterval !== 0) continue;
      try {
        think(state, p);
      } catch (err) {
        // An AI error must never take the match down: log it and carry on.
        if (typeof console !== 'undefined' && console.warn) console.warn('AI error', err);
        Sim.addEvent(state, { type: 'aiError', player: p.index, message: String(err && err.message || err) });
      }
    }
  };

  // ---------------------------------------------------------------------
  // Information gathering
  // ---------------------------------------------------------------------
  function ownUnits(state, idx) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (!u.dead && u.owner === idx) out.push(u);
    }
    return out;
  }

  function baseCenter(state, p, units, buildings) {
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].type === 'conyard') return { x: buildings[i].cx, y: buildings[i].cy };
    }
    if (buildings.length) return { x: buildings[0].cx, y: buildings[0].cy };
    if (units.length) return { x: units[0].x, y: units[0].y };
    var st = state.map.starts[p.index] || { x: state.map.w / 2, y: state.map.h / 2 };
    return { x: st.x, y: st.y };
  }

  function knownEnemyBuildings(state, p) {
    var out = [];
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (b.dead || b.owner === p.index) continue;
      if (!Sim.isEntityKnown(state, p.index, b)) continue;
      out.push(b);
    }
    return out;
  }

  function visibleEnemies(state, p) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.dead || u.owner === p.index) continue;
      if (!Sim.isEntityVisible(state, p.index, u)) continue;
      out.push(u);
    }
    return out;
  }

  function threatsNear(state, p, x, y, radius) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.dead || u.owner === p.index) continue;
      if (!Sim.isEntityVisible(state, p.index, u)) continue;
      if (U.dist(u.x, u.y, x, y) > radius) continue;
      if (!Sim.primaryWeapon(u)) continue;
      out.push(u);
    }
    return out;
  }

  /**
   * Flood fill of the tiles the AI's army can actually walk to.  Attacking a
   * building that sits behind a sealed wall would stall a wave forever, so the
   * AI always picks an objective it can reach (the wall itself, for example).
   */
  function reachableTiles(state, p, base) {
    var brain = p.ai;
    if (brain.reach && state.tick - (brain.reachTick || -1e9) < 60) return brain.reach;
    brain.reachTick = state.tick;
    var map = state.map;
    var seen = brain.reach || new Uint8Array(map.w * map.h);
    seen.fill(0);
    var start = RA.Pathfind.nearestFreeTile(map, Math.floor(base.x), Math.floor(base.y), 12);
    if (!start) return seen;
    var stack = [start.y * map.w + start.x];
    seen[stack[0]] = 1;
    while (stack.length) {
      var i = stack.pop();
      var x = i % map.w, y = (i - x) / map.w;
      var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var k = 0; k < 4; k++) {
        var nx = nb[k][0], ny = nb[k][1];
        if (!map.inside(nx, ny)) continue;
        var ni = ny * map.w + nx;
        if (seen[ni]) continue;
        if (map.isBlockedTile(nx, ny)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    brain.reach = seen;
    return seen;
  }

  /** True when at least one tile next to the building can be walked to. */
  function structureReachable(state, seen, b) {
    var map = state.map;
    for (var y = -1; y <= b.h; y++) {
      for (var x = -1; x <= b.w; x++) {
        var insideX = x >= 0 && x < b.w, insideY = y >= 0 && y < b.h;
        if (insideX && insideY) continue;
        var tx = b.x + x, ty = b.y + y;
        if (!map.inside(tx, ty)) continue;
        if (seen[ty * map.w + tx]) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------
  /**
   * Try to place `typeId` for `playerIdx`.  Scores candidate tiles by distance
   * to a hint position plus bonuses for hugging the existing base, then tells
   * the simulation to drop the building there.
   */
  function tryPlace(state, p, typeId, hintX, hintY, radius, weight) {
    var def = Rules.get(typeId);
    if (!def) return false;
    weight = weight || {};
    var best = null, bestScore = 1e9;
    var r0 = Math.max(1, Math.floor(radius || 9));
    var cx = Math.floor(hintX), cy = Math.floor(hintY);
    for (var r = 0; r <= r0; r++) {
      for (var oy = -r; oy <= r; oy++) {
        for (var ox = -r; ox <= r; ox++) {
          if (r > 1 && Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          var tx = cx + ox, ty = cy + oy;
          if (!Sim.canPlace(state, p.index, typeId, tx, ty).ok) continue;
          var mx = tx + def.w / 2, my = ty + def.h / 2;
          var score = 0;
          score += U.dist(mx, my, hintX, hintY) * (weight.hintWeight === undefined ? 1 : weight.hintWeight);
          if (weight.oreWeight) {
            var ore = MapGen.findOre(state.map, mx, my, 24);
            score += ore ? U.dist(mx, my, ore.x, ore.y) * weight.oreWeight : 60 * weight.oreWeight;
          }
          if (weight.centerWeight) {
            score += U.dist(mx, my, state.map.w / 2, state.map.h / 2) * weight.centerWeight;
          }
          if (weight.spreadWeight) {
            for (var k = 0; k < state.buildings.length; k++) {
              var b = state.buildings[k];
              if (b.dead || b.owner !== p.index) continue;
              if (b.type === typeId) score += Math.max(0, 6 - U.dist(mx, my, b.cx, b.cy)) * weight.spreadWeight;
            }
          }
          if (score < bestScore) { bestScore = score; best = { x: tx, y: ty }; }
        }
      }
      if (best && r >= 1) break;
    }
    if (!best) return false;
    var res = Sim.placeBuilding(state, p.index, typeId, best.x, best.y);
    return !!res.ok;
  }

  function handleReadyStructures(state, p, base) {
    for (var t = 0; t < Rules.TAB_ORDER.length; t++) {
      var tab = Rules.TAB_ORDER[t];
      var q = p.queues[tab];
      if (!q.length || !q[0].ready) continue;
      var typeId = q[0].typeId;
      var def = Rules.get(typeId);
      var hint = { x: base.x, y: base.y };
      var weight = { hintWeight: 1 };
      if (typeId === 'refinery') {
        var ore = nearestRichOre(state, base);
        if (ore) {
          var ang = Math.atan2(ore.y - base.y, ore.x - base.x);
          hint = { x: base.x + Math.cos(ang) * 5, y: base.y + Math.sin(ang) * 5 };
        }
        weight = { hintWeight: 0.6, oreWeight: 1.4 };
      } else if (tab === 'defenses') {
        var toward = threatDirection(state, p, base);
        hint = { x: base.x + Math.cos(toward) * 5.5, y: base.y + Math.sin(toward) * 5.5 };
        weight = { hintWeight: 1.0, spreadWeight: 1.2 };
      } else if (typeId === 'barracks' || typeId === 'warfactory' || typeId === 'lab') {
        hint = { x: base.x + state.rng() * 6 - 3, y: base.y + state.rng() * 6 - 3 };
        weight = { hintWeight: 1.0, spreadWeight: 0.8 };
      } else if (typeId === 'allied_power' || typeId === 'soviet_power') {
        hint = { x: base.x - 4 + state.rng() * 2, y: base.y - 4 + state.rng() * 2 };
        weight = { hintWeight: 1.0, spreadWeight: 0.6 };
      }
      if (!tryPlace(state, p, typeId, hint.x, hint.y, 11, weight)) {
        // Fall back to a wider search around the base.
        tryPlace(state, p, typeId, base.x, base.y, 16, { hintWeight: 1 });
      }
      break;   // one structure per think tick
    }
  }

  function nearestRichOre(state, base) {
    var best = null, bestScore = -1e9;
    var step = 4;
    for (var y = 2; y < state.map.h - 2; y += step) {
      for (var x = 2; x < state.map.w - 2; x += step) {
        var i = state.map.idx(x, y);
        if (state.map.ore[i] <= 0) continue;
        var d = U.dist(x, y, base.x, base.y);
        if (d > 34) continue;
        var score = state.map.ore[i] - d * 5;
        if (score > bestScore) { bestScore = score; best = { x: x, y: y, amount: state.map.ore[i] }; }
      }
    }
    return best;
  }

  /** Rough direction (radians) the AI should point its defences at. */
  function threatDirection(state, p, base) {
    var enemies = knownEnemyBuildings(state, p);
    var bx = 0, by = 0, n = 0;
    for (var i = 0; i < enemies.length; i++) {
      bx += enemies[i].cx; by += enemies[i].cy; n++;
    }
    if (n) return Math.atan2(by / n - base.y, bx / n - base.x);
    var st = state.map.starts[p.index];
    if (st) return Math.atan2(state.map.h / 2 - base.y, state.map.w / 2 - base.x);
    return 0;
  }

  // ---------------------------------------------------------------------
  // Build decisions
  // ---------------------------------------------------------------------
  function buildingCount(state, p, typeId) {
    return Sim.buildingCount(state, p.index, typeId, false);
  }
  function producerCount(state, p, kind) {
    var n = 0;
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (!b.dead && b.owner === p.index && b.produceType === kind) n++;
    }
    return n;
  }
  function queuedCount(state, p, typeId) {
    var n = 0;
    for (var t = 0; t < Rules.TAB_ORDER.length; t++) {
      var q = p.queues[Rules.TAB_ORDER[t]];
      for (var i = 0; i < q.length; i++) if (q[i].typeId === typeId) n++;
    }
    return n;
  }
  function hasReadyOrQueued(state, p, typeId) {
    return queuedCount(state, p, typeId) > 0;
  }

  function queue(state, p, typeId) {
    if (hasReadyOrQueued(state, p, typeId)) return false;
    var check = Sim.canBuild(state, p.index, typeId);
    if (!check.ok) return false;
    return Sim.queueBuild(state, p.index, typeId);
  }

  function powerPlantType(p) { return p.faction === 'soviet' ? 'soviet_power' : 'allied_power'; }

  function powerPressure(state, p, buildings) {
    var produced = p.power.produced, consumed = p.power.consumed;
    return consumed + 40 - produced;     // 40 = roughly one more structure
  }

  function decideConstruction(state, p, buildings, units, base) {
    var diff = Rules.DIFFICULTIES[p.difficulty];
    var refineries = buildingCount(state, p, 'refinery');
    var factories = buildingCount(state, p, 'warfactory');
    var barracks = buildingCount(state, p, 'barracks');
    var labs = buildingCount(state, p, 'lab');
    var defenses = buildingCount(state, p, 'allied_pillbox') + buildingCount(state, p, 'allied_patriot') +
      buildingCount(state, p, 'soviet_sentry') + buildingCount(state, p, 'soviet_flak') +
      buildingCount(state, p, 'allied_prism') + buildingCount(state, p, 'soviet_tesla');
    var ptype = powerPlantType(p);
    var miners = 0;
    for (var i = 0; i < units.length; i++) if (units[i].def.capacity) miners++;

    // keep the grid up first
    if ((p.power.low || powerPressure(state, p, buildings) > 0) && queue(state, p, ptype)) return;
    if (refineries < 1 && queue(state, p, 'refinery')) return;
    if (barracks < 1 && queue(state, p, 'barracks')) return;
    if (factories < 1 && queue(state, p, 'warfactory')) return;

    var wantMiners = (p.difficulty === 'easy' ? 2 : (p.difficulty === 'hard' ? 5 : 3)) + Math.max(0, refineries - 1);
    if (miners < wantMiners && factories > 0 && queue(state, p, 'harvester')) return;

    if (diff.waveMul >= 1 && defenses < 2 && queue(state, p, defenseType(p, false))) return;

    if (refineries < 2 && p.credits > 3200 && queue(state, p, 'refinery')) return;
    if (factories < 2 && p.credits > 4000 && queue(state, p, 'warfactory')) return;
    if (labs < 1 && p.credits > 3000 && queue(state, p, 'lab')) return;
    if (defenses < 4 && p.credits > 2200 && queue(state, p, defenseType(p, labs > 0))) return;
    if (refineries < 3 && p.credits > 6000 && queue(state, p, 'refinery')) return;
    if (barracks < 2 && p.credits > 2500 && queue(state, p, 'barracks')) return;
    if (p.power.consumed + 60 > p.power.produced && queue(state, p, ptype)) return;
  }

  function defenseType(p, advanced) {
    if (advanced) return p.faction === 'soviet' ? 'soviet_tesla' : 'allied_prism';
    return p.faction === 'soviet' ? 'soviet_sentry' : 'allied_pillbox';
  }

  function decideProduction(state, p, buildings, units, base) {
    var lab = buildingCount(state, p, 'lab') > 0;
    var army = 0, miners = 0;
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.def.capacity) { miners++; continue; }
      if (Sim.primaryWeapon(u)) army++;
    }
    var diff = Rules.DIFFICULTIES[p.difficulty];
    var target = Math.round((6 + state.tick / (HZ2() * 45)) * diff.waveMul);
    target = U.clamp(target, 4, p.difficulty === 'hard' ? 40 : (p.difficulty === 'easy' ? 16 : 30));
    p.ai.armyTarget = target;

    if (producerCount(state, p, 'infantry') > 0 && army < target) {
      var infType = pickInfantry(p, lab, state);
      if (queue(state, p, infType)) return;
    }
    if (producerCount(state, p, 'vehicle') > 0 && army < target) {
      var vehType = pickVehicle(state, p, lab, army);
      if (queue(state, p, vehType)) return;
    }
  }

  function HZ2() { return Rules.TICKS_PER_SEC; }

  function pickInfantry(p, lab, state) {
    var r = state.rng();
    if (p.faction === 'soviet') {
      if (r < 0.35) return 'conscript';
      return 'flak';
    }
    if (lab && r < 0.3) return 'guardian';
    if (lab && r < 0.42) return 'rocketeer';
    return 'gi';
  }

  function pickVehicle(state, p, lab, army) {
    var r = state.rng();
    if (p.faction === 'soviet') {
      if (lab && r < 0.28) return 'apoc';
      return 'rhino';
    }
    if (lab && r < 0.3) return 'prismtank';
    return 'grizzly';
  }

  // ---------------------------------------------------------------------
  // Military
  // ---------------------------------------------------------------------
  function isCombatUnit(u) {
    return !!Sim.primaryWeapon(u) || (u.def.abilities && u.def.abilities.indexOf('capture') >= 0);
  }

  function decideMilitary(state, p, units, base) {
    var diff = Rules.DIFFICULTIES[p.difficulty];
    var army = [];
    var i;
    for (i = 0; i < units.length; i++) {
      var u = units[i];
      if (u.def.capacity) {
        if (!u.dead && (!u.order || (u.order.type !== 'harvest' && u.order.type !== 'dock' && u.order.type !== 'move')) &&
          u.state !== 'harvesting' && u.state !== 'return' && u.state !== 'docking') {
          Sim.issueOrder(state, p.index, [u.id], { type: 'harvest' });
        }
        continue;
      }
      if (isCombatUnit(u)) army.push(u);
    }

    var brain = p.ai;
    var waveSet = new Set(brain.wave && brain.wave.members ? brain.wave.members : []);

    // --- defence ------------------------------------------------------
    // Raiders are dealt with by a slice of the army; the rest keeps pressing.
    var threats = threatsNear(state, p, base.x, base.y, 16);
    var defSet = new Set();
    if (threats.length) {
      var tx = 0, ty = 0, threatValue = 0;
      for (i = 0; i < threats.length; i++) {
        tx += threats[i].x; ty += threats[i].y;
        threatValue += threats[i].def.cost || 200;
      }
      tx /= threats.length; ty /= threats.length;
      var cap = Math.max(2, Math.ceil(army.length * (threatValue > 1500 ? 0.6 : 0.4)));
      var cands = [];
      for (i = 0; i < army.length; i++) {
        var a = army[i];
        if (waveSet.has(a.id)) continue;
        if (U.dist(a.x, a.y, base.x, base.y) > 26) continue;
        cands.push(a);
      }
      cands.sort(function (x, y) { return U.dist2(x.x, x.y, tx, ty) - U.dist2(y.x, y.y, tx, ty); });
      var defIds = [];
      for (i = 0; i < cands.length && defIds.length < cap; i++) {
        defIds.push(cands[i].id);
        defSet.add(cands[i].id);
      }
      if (defIds.length) Sim.issueOrder(state, p.index, defIds, { type: 'attackMove', x: tx, y: ty });
    }

    // --- offensive waves ---------------------------------------------
    var field = [];
    for (i = 0; i < army.length; i++) {
      if (!defSet.has(army[i].id)) field.push(army[i]);
    }
    // Bigger waves when the enemy has turtled up, and escalate after losses.
    var enemyDefenses = 0;
    var knownB = knownEnemyBuildings(state, p);
    for (i = 0; i < knownB.length; i++) {
      if (knownB[i].def.tags && knownB[i].def.tags.indexOf('defense') >= 0) enemyDefenses++;
    }
    var waveSize = Math.round((5 + state.tick / (HZ2() * 60)) * diff.waveMul);
    waveSize = U.clamp(waveSize, 3, p.difficulty === 'hard' ? 18 : 12);
    waveSize += (brain.waveBoost || 0) * 1.6 + Math.min(8, enemyDefenses * 1.2);
    waveSize = Math.min(30, Math.round(waveSize));
    var ready = field.length >= waveSize;
    var cooldown = (p.difficulty === 'hard' ? 12 : (p.difficulty === 'easy' ? 40 : 22)) * HZ2();
    var canAttack = state.tick - brain.lastWaveTick > cooldown;
    // Grace period: the human gets a few minutes to find their feet before the
    // first assault rolls in.
    var grace = (p.difficulty === 'hard' ? 2 : (p.difficulty === 'easy' ? 5 : 3)) * 60 * HZ2();
    if (state.tick < grace) canAttack = false;
    // Never sit on a big army forever just because the target keeps growing.
    if (!ready && field.length >= 4 && state.tick - brain.lastWaveTick > 4 * 60 * HZ2()) {
      ready = true;
      waveSize = field.length;
    }

    if (brain.wave) {
      if (brain.wave.sweep) {
        // Recon in force: walk the army onto an enemy start position.
        var arrived = false;
        for (i = 0; i < field.length; i++) {
          if (U.dist(field[i].x, field[i].y, brain.wave.x, brain.wave.y) < 9) { arrived = true; break; }
        }
        var spotted = pickAttackTarget(state, p, base);
        var stale = state.tick - brain.lastWaveTick > 60 * HZ2();
        if (arrived || stale || spotted) {
          brain.wave = spotted
            ? { targetId: spotted.id, x: spotted.kind === 'building' ? spotted.cx : spotted.x, y: spotted.kind === 'building' ? spotted.cy : spotted.y }
            : null;
          brain.lastWaveTick = state.tick;
        }
      } else {
        var keep = [];
        var aliveAttackers = 0;
        var memberIds = brain.wave.members || [];
        for (i = 0; i < memberIds.length; i++) {
          var mu = Sim.byId(state, memberIds[i]);
          if (mu && !mu.dead) { keep.push(memberIds[i]); aliveAttackers++; }
        }
        brain.wave.members = keep;
        var targetEnt = Sim.byId(state, brain.wave.targetId);
        if (!targetEnt || targetEnt.dead) {
          brain.waveBoost = Math.max(0, (brain.waveBoost || 0) - 1);
          brain.wave = null;
          brain.lastWaveTick = state.tick;
        } else if (aliveAttackers < Math.max(2, Math.ceil(memberIds.length * 0.35))) {
          // The assault was wiped out: come back with more next time.
          brain.waveBoost = Math.min(10, (brain.waveBoost || 0) + 1);
          brain.wave = null;
          brain.lastWaveTick = state.tick;
        } else if (state.tick - (brain.wave.startedAt || 0) > 75 * HZ2()) {
          // The wave is going nowhere (blocked route, unbreakable defence):
          // shelve that objective for a while and hit something else.
          if (!brain.badTargets) brain.badTargets = {};
          brain.badTargets[brain.wave.targetId] = state.tick;
          brain.waveBoost = Math.min(10, (brain.waveBoost || 0) + 1);
          brain.wave = null;
          brain.lastWaveTick = state.tick;
        }
      }
    }

    if (!brain.wave && ready && canAttack) {
      var target = pickAttackTarget(state, p, base);
      if (target) {
        brain.wave = {
          targetId: target.id,
          x: target.kind === 'building' ? target.cx : target.x,
          y: target.kind === 'building' ? target.cy : target.y,
          members: chooseWaveMembers(field, base, waveSize, state),
          startedAt: state.tick
        };
        brain.lastWaveTick = state.tick;
      } else {
        // Nothing is known yet: sweep the enemy start positions until we find them.
        var sweeps = Math.max(1, state.playerCount - 1);
        var idx = (brain.sweepIndex || 0) % sweeps;
        brain.sweepIndex = idx + 1;
        var st = state.map.starts[(p.index + 1 + idx) % state.playerCount] || state.map.starts[0];
        brain.wave = {
          targetId: 0, x: st.x, y: st.y, sweep: true,
          members: chooseWaveMembers(field, base, waveSize, state), startedAt: state.tick
        };
        brain.lastWaveTick = state.tick;
      }
    }

    if (brain.wave) {
      var wt = Sim.byId(state, brain.wave.targetId);
      if (wt && !wt.dead) {
        brain.wave.x = wt.kind === 'building' ? wt.cx : wt.x;
        brain.wave.y = wt.kind === 'building' ? wt.cy : wt.y;
      }
      var ids = [];
      var members = brain.wave.members || [];
      for (i = 0; i < members.length; i++) {
        var cu = Sim.byId(state, members[i]);
        if (!cu || cu.dead) continue;
        var o = cu.order || {};
        if (!brain.wave.sweep && o.type === 'attack' && o.targetId === brain.wave.targetId) continue;
        if (o.type === 'attackMove' && U.dist(o.x, o.y, brain.wave.x, brain.wave.y) < 5) continue;
        ids.push(cu.id);
      }
      if (ids.length) {
        Sim.issueOrder(state, p.index, ids, {
          type: 'attackMove', x: brain.wave.x, y: brain.wave.y
        });
      }
      var wtp = Sim.byId(state, brain.wave.targetId);
      if (wtp && !wtp.dead) {
        var inRange = [];
        for (i = 0; i < members.length; i++) {
          var fu = Sim.byId(state, members[i]);
          if (fu && !fu.dead && U.dist(fu.x, fu.y, brain.wave.x, brain.wave.y) < 8) inRange.push(fu.id);
        }
        if (inRange.length) Sim.issueOrder(state, p.index, inRange, { type: 'attack', targetId: brain.wave.targetId });
      }
    }

    // --- scouting -----------------------------------------------------
    if (state.tick - brain.lastScoutTick > 25 * HZ2()) {
      brain.lastScoutTick = state.tick;
      var scout = null;
      for (i = 0; i < units.length; i++) {
        var s = units[i];
        if (s.def.capacity || !isCombatUnit(s)) continue;
        if (s.def.cost > 400) continue;
        if (s.order && (s.order.type === 'attackMove' || s.order.type === 'attack')) continue;
        scout = s; break;
      }
      if (scout) {
        var st = state.map.starts[(p.index + 1 + state.rng.int(state.playerCount - 1)) % state.playerCount];
        Sim.issueOrder(state, p.index, [scout.id], { type: 'attackMove', x: st.x, y: st.y });
      }
    }

    // Idle units gather near the base so the army stays together.
    var idle = [];
    for (i = 0; i < field.length; i++) {
      var q = field[i];
      if (q.path) continue;
      if (q.order && (q.order.type === 'attackMove' || q.order.type === 'move' || q.order.type === 'attack')) continue;
      if (U.dist(q.x, q.y, base.x, base.y) > 12) idle.push(q.id);
    }
    if (idle.length > 4) {
      var gatherAngle = state.rng() * U.TAU;
      Sim.issueOrder(state, p.index, idle, {
        type: 'move',
        x: base.x + Math.cos(gatherAngle) * 6,
        y: base.y + Math.sin(gatherAngle) * 6
      });
    }
  }

  function idOf(u) { return u.id; }

  /**
   * Who marches out in this wave?  The bulk of the army, leaving a small
   * garrison behind - and the members are frozen so reinforcements pile up at
   * home instead of feeding themselves into the grinder one by one.
   */
  function chooseWaveMembers(field, base, waveSize, state) {
    var sorted = field.slice().sort(function (a, b) {
      return U.dist(a.x, a.y, base.x, base.y) - U.dist(b.x, b.y, base.x, base.y);
    });
    var garrison = Math.max(1, Math.floor(sorted.length * 0.2));
    var take = Math.max(waveSize, Math.floor(sorted.length * 0.75));
    take = Math.min(take, Math.max(1, sorted.length - garrison));
    return sorted.slice(0, take).map(idOf);
  }

  function pickAttackTarget(state, p, base) {
    var best = null, bestScore = 1e9;
    var i;
    var eb = knownEnemyBuildings(state, p);
    var seen = reachableTiles(state, p, base);
    var brain = p.ai;
    var now = state.tick;
    for (i = 0; i < eb.length; i++) {
      var b = eb[i];
      if (!structureReachable(state, seen, b)) continue;
      var ban = brain.badTargets && brain.badTargets[b.id];
      if (ban && now - ban < 120 * HZ2()) continue;
      var d = U.dist(b.cx, b.cy, base.x, base.y);
      var score = d;
      if (b.type === 'refinery') score -= 6;
      if (b.type === 'warfactory') score -= 4;
      if (b.type === 'conyard') score -= 3;
      if (b.type === 'conyard' && state.shortGame) score -= 14;
      if (b.type.indexOf('power') >= 0) score -= 5;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (best) return best;
    var ev = visibleEnemies(state, p);
    best = null; bestScore = 1e9;
    for (i = 0; i < ev.length; i++) {
      if (seen[Math.floor(ev[i].y) * state.map.w + Math.floor(ev[i].x)] === 0) continue;
      var d2 = U.dist(ev[i].x, ev[i].y, base.x, base.y);
      if (d2 < bestScore) { bestScore = d2; best = ev[i]; }
    }
    if (best) return best;
    // Everything behind walls: smash the nearest known structure, reachable or not.
    for (i = 0; i < eb.length; i++) {
      var b2 = eb[i];
      var ban2 = brain.badTargets && brain.badTargets[b2.id];
      if (ban2 && now - ban2 < 120 * HZ2()) continue;
      var d3 = U.dist(b2.cx, b2.cy, base.x, base.y);
      if (d3 < bestScore) { bestScore = d3; best = b2; }
    }
    return best;
  }

  // ---------------------------------------------------------------------
  function think(state, p) {
    var units = ownUnits(state, p.index);
    var buildings = [];
    for (var i = 0; i < state.buildings.length; i++) {
      var b = state.buildings[i];
      if (!b.dead && b.owner === p.index) buildings.push(b);
    }
    var base = baseCenter(state, p, units, buildings);
    p.ai.baseX = base.x; p.ai.baseY = base.y;

    handleReadyStructures(state, p, base);
    decideConstruction(state, p, buildings, units, base);
    decideProduction(state, p, buildings, units, base);
    decideMilitary(state, p, units, base);

    // Expansion: if the local ore is gone, open a second mining operation.
    if (state.tick - p.ai.lastExpandTick > 30 * Rules.TICKS_PER_SEC) {
      p.ai.lastExpandTick = state.tick;
      var miners = 0, idleMiners = 0;
      for (i = 0; i < units.length; i++) {
        if (!units[i].def.capacity) continue;
        miners++;
        if (units[i].state === 'idle') idleMiners++;
      }
      var near = nearestRichOre(state, base);
      if (miners > 0 && idleMiners >= Math.ceil(miners / 2)) {
        if (p.credits > 3000 && !hasReadyOrQueued(state, p, 'refinery')) queue(state, p, 'refinery');
      } else if (near && U.dist(near.x, near.y, base.x, base.y) > 22 && p.credits > 4000 && !hasReadyOrQueued(state, p, 'refinery')) {
        queue(state, p, 'refinery');
      }
    }
  }

  AI.createBrain = createBrain;
  AI.tryPlace = tryPlace;
  RA.AI = AI;
})(globalThis.RA = globalThis.RA || {});
