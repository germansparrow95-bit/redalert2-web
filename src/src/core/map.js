/*
 * Red Alert Web - procedural, fully deterministic skirmish map generation.
 *
 * A map is a tile grid plus an ore layer.  Ore fields, start positions and
 * terrain tricks are placed symmetrically so every player gets the same
 * opening, and the generator validates reachability before returning.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;

  var T = {
    WATER: 0,
    GRASS: 1,
    ROUGH: 2,
    SAND: 3,
    CLIFF: 4,
    TREE: 5
  };
  RA.TERRAIN = T;

  var ORE_NONE = 0, ORE_ORE = 1, ORE_GEM = 2;
  var MAP_ID = 0;

  function valueNoise(rng, scale) {
    var gw = 96, gh = 96;
    var grid = new Float32Array(gw * gh);
    for (var i = 0; i < grid.length; i++) grid[i] = rng();
    var smooth = function (t) { return t * t * (3 - 2 * t); };
    return {
      at: function (x, y) {
        var fx = x / scale, fy = y / scale;
        var x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = smooth(fx - x0), ty = smooth(fy - y0);
        var x1 = x0 + 1, y1 = y0 + 1;
        var wx0 = ((x0 % gw) + gw) % gw, wy0 = ((y0 % gh) + gh) % gh;
        var wx1 = ((x1 % gw) + gw) % gw, wy1 = ((y1 % gh) + gh) % gh;
        var a = grid[wy0 * gw + wx0], b = grid[wy0 * gw + wx1];
        var c = grid[wy1 * gw + wx0], d = grid[wy1 * gw + wx1];
        return U.lerp(U.lerp(a, b, tx), U.lerp(c, d, tx), ty);
      }
    };
  }

  function MapGrid(w, h, seed, playerCount) {
    this.tag = ++MAP_ID;          // unique per map: keeps caches from leaking
    this.w = w;
    this.h = h;
    this.seed = seed >>> 0;
    this.playerCount = playerCount;
    this.terrain = new Uint8Array(w * h);
    this.decal = new Uint8Array(w * h);     // purely cosmetic scatter
    this.ore = new Uint16Array(w * h);      // credits left in the cell
    this.oreMax = new Uint16Array(w * h);
    this.oreKind = new Uint8Array(w * h);
    this.occ = new Uint8Array(w * h);       // building footprint occupancy
    this.reserved = new Uint8Array(w * h);  // unloading bays / reserved tiles
    this.terrainBlocked = new Uint8Array(w * h);
    this.terrainBlockedForBuilding = new Uint8Array(w * h);
    this.symOrder = (w === h && playerCount === 4) ? 4 : 2;
    this.starts = [];
    this.gemFields = [];
  }

  MapGrid.prototype.idx = function (x, y) { return y * this.w + x; };
  MapGrid.prototype.inside = function (x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  };
  MapGrid.prototype.terrainAt = function (x, y) {
    return this.inside(x, y) ? this.terrain[this.idx(x, y)] : T.CLIFF;
  };
  MapGrid.prototype.oreAt = function (x, y) {
    return this.inside(x, y) ? this.ore[this.idx(x, y)] : 0;
  };
  MapGrid.prototype.isBlockedTile = function (tx, ty) {
    if (!this.inside(tx, ty)) return true;
    var i = this.idx(tx, ty);
    return this.terrainBlocked[i] === 1 || this.occ[i] === 1;
  };
  MapGrid.prototype.isBlockedForBuilding = function (tx, ty) {
    if (!this.inside(tx, ty)) return true;
    var i = this.idx(tx, ty);
    return this.terrainBlockedForBuilding[i] === 1 || this.occ[i] === 1;
  };
  /** Ground a structure may be dropped on (flat land, no ore, no water). */
  MapGrid.prototype.isBuildableTile = function (tx, ty) {
    if (!this.inside(tx, ty)) return false;
    var i = this.idx(tx, ty);
    if (this.occ[i]) return false;
    if (this.reserved[i]) return false;
    if (this.ore[i] > 0) return false;
    var t = this.terrain[i];
    return t === T.GRASS || t === T.ROUGH || t === T.SAND;
  };

  /** Recompute the static blocked bitmaps (terrain + buildings). */
  MapGrid.prototype.refreshBlocked = function () {
    var n = this.w * this.h;
    for (var i = 0; i < n; i++) {
      var t = this.terrain[i];
      var blocksGround = (t === T.WATER || t === T.CLIFF || t === T.TREE) ? 1 : 0;
      this.terrainBlocked[i] = blocksGround;
      var blocksBuild = (t === T.GRASS || t === T.ROUGH || t === T.SAND) ? 0 : 1;
      this.terrainBlockedForBuilding[i] = blocksBuild;
    }
  };

  // -----------------------------------------------------------------------
  // Symmetry helpers: rotate tile coordinates around the map centre.
  // -----------------------------------------------------------------------
  MapGrid.prototype.rotatePoint = function (x, y, k) {
    if (this.symOrder !== 4 || k === 0) {
      if (k % 2 === 0) return { x: x, y: y };
      return { x: this.w - 1 - x, y: this.h - 1 - y };
    }
    var cx = (this.w - 1) / 2, cy = (this.h - 1) / 2;
    var dx = x - cx, dy = y - cy;
    switch (k & 3) {
      case 1: return { x: Math.round(cx - dy), y: Math.round(cy + dx) };
      case 2: return { x: Math.round(cx - dx), y: Math.round(cy - dy) };
      default: return { x: Math.round(cx + dy), y: Math.round(cy - dx) };
    }
  };

  MapGrid.prototype.canonicalIndex = function (x, y) {
    var best = this.idx(x, y);
    for (var k = 1; k < this.symOrder; k++) {
      var p = this.rotatePoint(x, y, k);
      if (!this.inside(p.x, p.y)) continue;
      var i = this.idx(p.x, p.y);
      if (i < best) best = i;
    }
    return best;
  };

  // -----------------------------------------------------------------------
  // Feature stamping
  // -----------------------------------------------------------------------

  /** Rotate (x,y) around the map centre by `angle` radians; returns float tile coords. */
  function rotateFloat(map, x, y, angle) {
    var cx = (map.w - 1) / 2, cy = (map.h - 1) / 2;
    var dx = x - cx, dy = y - cy;
    var ca = Math.cos(angle), sa = Math.sin(angle);
    return { x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca };
  }

  function stampOre(map, cx, cy, radius, kind, rng, richness) {
    var i0 = Math.max(0, Math.floor(cx - radius - 1));
    var i1 = Math.min(map.w - 1, Math.ceil(cx + radius + 1));
    var j0 = Math.max(0, Math.floor(cy - radius - 1));
    var j1 = Math.min(map.h - 1, Math.ceil(cy + radius + 1));
    var noise = valueNoise(rng, 1.6);
    var max = Rules.ORE_CELL_MAX * (richness || 1);
    for (var y = j0; y <= j1; y++) {
      for (var x = i0; x <= i1; x++) {
        var i = map.idx(x, y);
        if (map.terrain[i] === T.WATER || map.terrain[i] === T.CLIFF) continue;
        var d = Math.sqrt(U.dist2(x + 0.5, y + 0.5, cx, cy));
        var wobble = (noise.at(x, y) - 0.5) * 1.15;
        var eff = radius * (0.78 + wobble * 0.28);
        if (d > eff) continue;
        var falloff = 1 - Math.pow(U.clamp(d / eff, 0, 1), 1.5);
        // Keep the rim of a field worth mining: no tile below 60 credits.
        var amount = Math.max(60, Math.round(max * falloff));
        if (map.ore[i] < amount) {
          map.ore[i] = amount;
          map.oreMax[i] = Math.max(map.oreMax[i], amount);
          map.oreKind[i] = kind;
        }
      }
    }
  }

  function flattenArea(map, cx, cy, radius, keepOre) {
    var i0 = Math.max(0, Math.floor(cx - radius));
    var i1 = Math.min(map.w - 1, Math.ceil(cx + radius));
    var j0 = Math.max(0, Math.floor(cy - radius));
    var j1 = Math.min(map.h - 1, Math.ceil(cy + radius));
    for (var y = j0; y <= j1; y++) {
      for (var x = i0; x <= i1; x++) {
        if (U.dist(x + 0.5, y + 0.5, cx, cy) > radius) continue;
        var i = map.idx(x, y);
        var t = map.terrain[i];
        if (t === T.WATER || t === T.CLIFF || t === T.TREE) map.terrain[i] = T.GRASS;
        if (!keepOre) { map.ore[i] = 0; map.oreMax[i] = 0; map.oreKind[i] = ORE_NONE; }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Generator
  // -----------------------------------------------------------------------

  /**
   * generate({ size, playerCount, seed }) -> MapGrid
   * size: 'small' | 'medium' | 'large' (tiles per side)
   */
  function generate(opts) {
    opts = opts || {};
    var playerCount = U.clamp(opts.playerCount || 2, 2, 4);
    var sizes = { small: 64, medium: 80, large: 96 };
    var w = opts.w || sizes[opts.size] || sizes.medium;
    var h = opts.h || w;
    if (w % 2 !== 0) w++;
    if (h % 2 !== 0) h++;
    var baseSeed = (opts.seed === undefined || opts.seed === null) ? (Date.now() & 0xffffffff) : (opts.seed >>> 0);

    var attempt = 0;
    for (;;) {
      var map = buildOnce(w, h, (baseSeed + attempt * 7919) >>> 0, playerCount, attempt);
      var report = validate(map);
      if (report.ok) {
        map.validation = report;
        return map;
      }
      attempt++;
      if (attempt > 30) {
        // Give up on perfection but never hand back a broken map: carve
        // corridors between the starts so the match is always playable.
        carveCorridors(map);
        map.validation = validate(map);
        return map;
      }
    }
  }

  function buildOnce(w, h, seed, playerCount, attempt) {
    var map = new MapGrid(w, h, seed, playerCount);
    var rng = U.makeRng(seed);
    var terrainNoise = valueNoise(rng, 9.5);
    var roughNoise = valueNoise(rng, 4.5);
    var waterNoise = valueNoise(rng, 7);
    var treeNoise = valueNoise(rng, 3.2);
    var cliffNoise = valueNoise(rng, 5.5);
    var decalNoise = valueNoise(rng, 2.1);
    var cx = (w - 1) / 2, cy = (h - 1) / 2;

    // --- start positions: evenly spaced on a ring -------------------------
    var ringR = Math.min(w, h) * (playerCount === 2 ? 0.36 : 0.34);
    var baseAngle = (Math.PI / 4) + (rng() * 0.16 - 0.08);
    for (var p = 0; p < playerCount; p++) {
      var a = baseAngle + (p * Math.PI * 2) / playerCount;
      map.starts.push({
        x: Math.round(cx + Math.cos(a) * ringR),
        y: Math.round(cy + Math.sin(a) * ringR),
        angle: a,
        index: p
      });
    }

    // --- terrain base layer (symmetric) -----------------------------------
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = map.idx(x, y);
        if (map.canonicalIndex(x, y) !== i) continue;
        var n = terrainNoise.at(x, y);
        var t = T.GRASS;
        if (n > 0.60) t = T.ROUGH;
        if (n > 0.80) t = T.SAND;
        map.terrain[i] = t;
        map.decal[i] = decalNoise.at(x, y) > 0.72 ? (1 + ((x * 7 + y * 13) % 3)) : 0;
      }
    }
    // mirror the canonical wedge to every symmetric tile
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = map.idx(x, y);
        var ci = map.canonicalIndex(x, y);
        if (ci !== i) { map.terrain[i] = map.terrain[ci]; map.decal[i] = map.decal[ci]; }
      }
    }

    // --- water: only a central lake and/or outer border, never on a start --
    var lakeCount = 1 + Math.floor(rng() * 2);
    for (var lk = 0; lk < lakeCount; lk++) {
      var lakeCentral = lk === 0 || rng() < 0.4;
      var lr, lx, ly;
      if (lakeCentral) {
        lr = Math.min(w, h) * (0.06 + rng() * 0.05);
        lx = cx + (rng() - 0.5) * Math.min(w, h) * 0.14;
        ly = cy + (rng() - 0.5) * Math.min(w, h) * 0.14;
      } else {
        lr = Math.min(w, h) * (0.09 + rng() * 0.07);
        var la = rng() * Math.PI * 2;
        lx = cx + Math.cos(la) * Math.min(w, h) * 0.46;
        ly = cy + Math.sin(la) * Math.min(w, h) * 0.46;
      }
      for (y = Math.max(0, Math.floor(ly - lr - 2)); y <= Math.min(h - 1, Math.ceil(ly + lr + 2)); y++) {
        for (x = Math.max(0, Math.floor(lx - lr - 2)); x <= Math.min(w - 1, Math.ceil(lx + lr + 2)); x++) {
          var d = U.dist(x + 0.5, y + 0.5, lx, ly);
          var edge = lr * (0.7 + (waterNoise.at(x, y) - 0.5) * 0.9);
          if (d <= edge) {
            var ok = true;
            for (var s = 0; s < map.starts.length; s++) {
              if (U.dist(x, y, map.starts[s].x, map.starts[s].y) < 9) { ok = false; break; }
            }
            if (ok) map.terrain[map.idx(x, y)] = T.WATER;
          }
        }
      }
    }

    // --- cliffs & trees (never inside a start clearing) --------------------
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = map.idx(x, y);
        var nearStart = false;
        for (s = 0; s < map.starts.length; s++) {
          if (U.dist(x, y, map.starts[s].x, map.starts[s].y) < 7) { nearStart = true; break; }
        }
        if (nearStart) continue;
        if (map.terrain[i] === T.WATER) continue;
        var dc = cliffNoise.at(x, y);
        var dt = treeNoise.at(x, y);
        if (dc > 0.87) map.terrain[i] = T.CLIFF;
        else if (dt > 0.845 && map.terrain[i] !== T.SAND) map.terrain[i] = T.TREE;
      }
    }
    // trees/cliffs on a tile must mirror to their symmetric partners
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = map.idx(x, y);
        var canon = map.canonicalIndex(x, y);
        if (canon !== i) {
          map.terrain[i] = map.terrain[canon];
          map.decal[i] = map.decal[canon];
        }
      }
    }

    // --- clear each start clearing ----------------------------------------
    for (s = 0; s < map.starts.length; s++) {
      flattenArea(map, map.starts[s].x, map.starts[s].y, 6.0, false);
    }

    // --- ore fields: identical pattern rotated for every player ------------
    var pattern = [
      { dist: 8.0, side: 0.55, radius: 3.3, richness: 0.95 },
      { dist: 17.0, side: -0.75, radius: 3.7, richness: 1.0 },
      { dist: 24.0, side: 1.15, radius: 3.0, richness: 0.85 }
    ];
    for (s = 0; s < map.starts.length; s++) {
      var st = map.starts[s];
      for (var f = 0; f < pattern.length; f++) {
        var fdef = pattern[f];
        var fa = st.angle + Math.PI + fdef.side;      // towards the centre-ish
        var fx = st.x + Math.cos(fa) * fdef.dist;
        var fy = st.y + Math.sin(fa) * fdef.dist;
        if (fx < 3 || fy < 3 || fx > w - 4 || fy > h - 4) continue;
        stampOre(map, fx, fy, fdef.radius, ORE_ORE, rng, fdef.richness);
      }
    }

    // --- a contested gem field in the middle ------------------------------
    var gemCount = playerCount >= 4 ? 2 : 1;
    for (var g = 0; g < gemCount; g++) {
      var ga = (g * Math.PI * 2) / gemCount + baseAngle * 0.5;
      var gd = gemCount === 1 ? 0 : Math.min(w, h) * 0.14;
      var gx = cx + Math.cos(ga) * gd, gy = cy + Math.sin(ga) * gd;
      map.gemFields.push({ x: gx, y: gy });
      flattenArea(map, gx, gy, 3.0, true);
      stampOre(map, gx, gy, 2.7, ORE_GEM, rng, 1.0);
    }

    // --- never allow ore on water/cliff ------------------------------------
    for (i = 0; i < w * h; i++) {
      var tt = map.terrain[i];
      if (tt === T.WATER || tt === T.CLIFF || tt === T.TREE) {
        map.ore[i] = 0; map.oreMax[i] = 0; map.oreKind[i] = ORE_NONE;
      }
    }

    // --- make sure each start clearing is clean of ore too ------------------
    for (s = 0; s < map.starts.length; s++) {
      flattenArea(map, map.starts[s].x, map.starts[s].y, 5.0, false);
    }

    map.refreshBlocked();
    return map;
  }

  // -----------------------------------------------------------------------
  // Validation - guarantee that the match is actually playable
  // -----------------------------------------------------------------------
  function floodFrom(map, sx, sy) {
    var seen = new Uint8Array(map.w * map.h);
    var stack = [map.idx(sx, sy)];
    seen[stack[0]] = 1;
    while (stack.length) {
      var i = stack.pop();
      var x = i % map.w, y = (i - x) / map.w;
      var nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (var k = 0; k < 4; k++) {
        var nx = nb[k][0], ny = nb[k][1];
        if (!map.inside(nx, ny)) continue;
        var ni = map.idx(nx, ny);
        if (seen[ni]) continue;
        if (map.isBlockedTile(nx, ny)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    return seen;
  }

  function validate(map) {
    var issues = [];
    var reach = floodFrom(map, map.starts[0].x, map.starts[0].y);
    for (var s = 1; s < map.starts.length; s++) {
      var st = map.starts[s];
      if (!reach[map.idx(st.x, st.y)]) issues.push('start ' + s + ' unreachable');
    }
    for (s = 0; s < map.starts.length; s++) {
      st = map.starts[s];
      var buildable = 0, oreCells = 0, oreCredits = 0;
      for (var y = -9; y <= 9; y++) {
        for (var x = -9; x <= 9; x++) {
          var tx = st.x + x, ty = st.y + y;
          if (!map.inside(tx, ty)) continue;
          var i = map.idx(tx, ty);
          if (map.isBuildableTile(tx, ty)) buildable++;
          if (map.ore[i] > 0) { oreCells++; oreCredits += map.ore[i]; }
        }
      }
      if (buildable < 90) issues.push('start ' + s + ' cramped (' + buildable + ' buildable tiles)');
      if (oreCells < 8) issues.push('start ' + s + ' has no ore nearby');
      if (oreCredits < 1500) issues.push('start ' + s + ' has too little ore');
    }
    return { ok: issues.length === 0, issues: issues };
  }

  /** Last-resort repair: bulldoze straight lanes from start 0 to every other start. */
  function carveCorridors(map) {
    for (var s = 1; s < map.starts.length; s++) {
      var a = map.starts[0], b = map.starts[s];
      var steps = Math.ceil(U.dist(a.x, a.y, b.x, b.y));
      for (var k = 0; k <= steps; k++) {
        var t = steps === 0 ? 0 : k / steps;
        var x = Math.round(U.lerp(a.x, b.x, t));
        var y = Math.round(U.lerp(a.y, b.y, t));
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var tx = x + ox, ty = y + oy;
            if (!map.inside(tx, ty)) continue;
            var i = map.idx(tx, ty);
            if (map.terrain[i] === T.WATER || map.terrain[i] === T.CLIFF || map.terrain[i] === T.TREE) {
              map.terrain[i] = T.GRASS;
            }
          }
        }
      }
    }
    map.refreshBlocked();
  }

  /** Nearest tile with ore to (x,y) - used by the AI and by harvest orders. */
  function findOre(map, x, y, maxRadius) {
    maxRadius = maxRadius || 40;
    var bx = -1, by = -1, best = maxRadius * maxRadius;
    var r0 = Math.max(1, Math.ceil(maxRadius));
    var tx0 = Math.max(0, Math.floor(x) - r0), tx1 = Math.min(map.w - 1, Math.ceil(x) + r0);
    var ty0 = Math.max(0, Math.floor(y) - r0), ty1 = Math.min(map.h - 1, Math.ceil(y) + r0);
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var i = map.idx(tx, ty);
        if (map.ore[i] <= 0) continue;
        var d = U.dist2(tx + 0.5, ty + 0.5, x, y);
        if (d < best) { best = d; bx = tx; by = ty; }
      }
    }
    return bx < 0 ? null : { x: bx, y: by };
  }

  RA.MapGen = {
    generate: generate,
    findOre: findOre,
    ORE_NONE: ORE_NONE,
    ORE_ORE: ORE_ORE,
    ORE_GEM: ORE_GEM,
    SIZES: { small: 64, medium: 80, large: 96 }
  };
})(globalThis.RA = globalThis.RA || {});
