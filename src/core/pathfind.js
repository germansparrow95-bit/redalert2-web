/*
 * Red Alert Web - grid A* path finding with line-of-sight smoothing and a
 * shared cache.  Calls are budgeted by the simulation so that a large battle
 * never stalls the frame.
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var T = RA.TERRAIN;

  var Pathfind = RA.Pathfind = {};

  var scratch = null;
  var cacheVersion = 1;
  var cache = new U.LruCache(400);

  Pathfind.invalidate = function () { cacheVersion++; };

  function ensureScratch(n) {
    if (!scratch || scratch.n !== n) {
      scratch = {
        n: n,
        g: new Float32Array(n),
        f: new Float32Array(n),
        from: new Int32Array(n),
        stamp: new Int32Array(n),
        closed: new Uint8Array(n),
        gen: 0
      };
    }
    return scratch;
  }

  function terrainCost(map, tx, ty) {
    var t = map.terrainAt(tx, ty);
    if (t === T.ROUGH) return 1.18;
    if (t === T.SAND) return 1.08;
    return 1;
  }

  var DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]
  ];
  var BIG = 1e9;

  function octile(ax, ay, bx, by) {
    var dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
  }

  /**
   * Core A*.  Returns an array of tile indices from start (exclusive) to goal
   * (inclusive), or null when no route exists.
   */
  function search(map, sx, sy, gx, gy, blockedFn, maxNodes) {
    var n = map.w * map.h;
    var s = ensureScratch(n);
    s.gen++;
    var gen = s.gen;
    var w = map.w;
    var start = sy * w + sx;
    var goal = gy * w + gx;
    var open = new U.Heap(function (a, b) { return s.f[a] - s.f[b]; });

    s.g[start] = 0;
    s.f[start] = octile(sx, sy, gx, gy);
    s.from[start] = -1;
    s.stamp[start] = gen;
    s.closed[start] = 0;
    open.push(start);

    var expanded = 0;
    var bestNode = start;
    var bestH = octile(sx, sy, gx, gy);

    while (open.size() > 0) {
      var cur = open.pop();
      if (s.closed[cur] === 1 && s.stamp[cur] === gen) continue;
      s.closed[cur] = 1;
      if (cur === goal) return rebuild(s, cur, gen);

      var cx = cur % w, cy = (cur - cx) / w;
      var h = octile(cx, cy, gx, gy);
      if (h < bestH) { bestH = h; bestNode = cur; }

      for (var d = 0; d < 8; d++) {
        var nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        if (!map.inside(nx, ny)) continue;
        if (blockedFn(nx, ny)) continue;
        if (DIRS[d][2] > 1) {
          // no cutting corners between two blocked tiles
          if (blockedFn(cx + DIRS[d][0], cy) || blockedFn(cx, cy + DIRS[d][1])) continue;
        }
        var ni = ny * w + nx;
        if (s.stamp[ni] === gen && s.closed[ni] === 1) continue;
        var step = DIRS[d][2] * terrainCost(map, nx, ny);
        var ng = s.g[cur] + step;
        if (s.stamp[ni] !== gen) {
          s.stamp[ni] = gen;
          s.closed[ni] = 0;
          s.g[ni] = BIG;
          s.from[ni] = -1;
        }
        if (ng < s.g[ni]) {
          s.g[ni] = ng;
          s.from[ni] = cur;
          s.f[ni] = ng + octile(nx, ny, gx, gy) * 1.06;
          open.push(ni);
        }
      }
      expanded++;
      if (expanded > (maxNodes || 9000)) {
        // Partial result: walk as close as we managed to get.
        return bestNode === start ? null : rebuild(s, bestNode, gen);
      }
    }
    return bestNode === start ? null : rebuild(s, bestNode, gen);
  }

  function rebuild(s, node, gen) {
    var out = [];
    var guard = 0;
    while (node !== -1 && guard++ < 20000) {
      out.push(node);
      if (s.stamp[node] !== gen) break;
      node = s.from[node];
    }
    out.reverse();
    return out;
  }

  /**
   * True when a straight line between two tile-space points stays clear.
   * The line is "thick" (PAD) so that it cannot slip through the hairline
   * seam where four tiles meet - units are not points and would jam there.
   */
  var PAD = 0.3;
  Pathfind.clearLine = function (map, x0, y0, x1, y1, blockedFn, thin) {
    blockedFn = blockedFn || function (tx, ty) { return map.isBlockedTile(tx, ty); };
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) return !blockedFn(Math.floor(x0), Math.floor(y0));
    var steps = Math.ceil(dist * 2.5);
    var prevX = -9999, prevY = -9999;
    var pad = thin ? 0 : PAD;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var px = x0 + dx * t, py = y0 + dy * t;
      var tx = Math.floor(px), ty = Math.floor(py);
      if (tx === prevX && ty === prevY) continue;
      prevX = tx; prevY = ty;
      if (blockedFn(tx, ty)) return false;
      if (pad) {
        if (blockedFn(Math.floor(px + pad), Math.floor(py + pad))) return false;
        if (blockedFn(Math.floor(px + pad), Math.floor(py - pad))) return false;
        if (blockedFn(Math.floor(px - pad), Math.floor(py + pad))) return false;
        if (blockedFn(Math.floor(px - pad), Math.floor(py - pad))) return false;
      }
    }
    return true;
  };

  /** Nearest passable tile to (tx,ty), spiralling outwards. */
  Pathfind.nearestFreeTile = function (map, tx, ty, maxRadius, blockedFn) {
    blockedFn = blockedFn || function (x, y) { return map.isBlockedTile(x, y); };
    if (!blockedFn(tx, ty)) return { x: tx, y: ty };
    for (var r = 1; r <= maxRadius; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var x = tx + dx, y = ty + dy;
          if (!map.inside(x, y)) continue;
          if (!blockedFn(x, y)) return { x: x, y: y };
        }
      }
    }
    return null;
  };

  /**
   * Public entry point.
   *  find(map, from{x,y}, to{x,y}, opts) -> { points:[{x,y}], complete:bool } | null
   *  Coordinates are in tile space (floats); returned points are tile centres.
   *  opts.blockedFn  custom blocked test
   *  opts.cache      set false to bypass the shared cache (moving enemies)
   */
  Pathfind.find = function (map, from, to, opts) {
    opts = opts || {};
    var blockedFn = opts.blockedFn || function (tx, ty) { return map.isBlockedTile(tx, ty); };
    var sx = U.clamp(Math.floor(from.x), 0, map.w - 1);
    var sy = U.clamp(Math.floor(from.y), 0, map.h - 1);
    var gx = U.clamp(Math.floor(to.x), 0, map.w - 1);
    var gy = U.clamp(Math.floor(to.y), 0, map.h - 1);

    var goal = Pathfind.nearestFreeTile(map, gx, gy, 4, blockedFn);
    if (!goal) return null;
    gx = goal.x; gy = goal.y;

    var useCache = opts.cache !== false && !opts.blockedFn;
    var key = cacheVersion + '|' + map.tag + ':' + sx + ',' + sy + ':' + gx + ',' + gy;
    var tiles = useCache ? cache.get(key) : undefined;
    if (tiles === undefined) {
      tiles = search(map, sx, sy, gx, gy, blockedFn, opts.maxNodes);
      if (useCache && tiles) cache.set(key, tiles);
    }
    if (!tiles || tiles.length === 0) {
      // Already standing on the goal tile.
      return { points: [{ x: to.x, y: to.y }], complete: true };
    }

    var pts = [];
    for (var i = 0; i < tiles.length; i++) {
      var ti = tiles[i];
      var tx = ti % map.w, ty = (ti - tx) / map.w;
      pts.push({ x: tx + 0.5, y: ty + 0.5 });
    }
    if (pts.length) pts[pts.length - 1] = { x: to.x, y: to.y };

    // String-pulling: drop waypoints we can skip with a clear straight line.
    // Scans forward (not from the end) so the whole pass stays linear.
    var smooth = [];
    var curX = from.x, curY = from.y;
    var idx = 0;
    while (idx < pts.length) {
      var far = idx;
      while (far + 1 < pts.length && Pathfind.clearLine(map, curX, curY, pts[far + 1].x, pts[far + 1].y, blockedFn)) {
        far++;
      }
      smooth.push(pts[far]);
      curX = pts[far].x; curY = pts[far].y;
      idx = far + 1;
    }
    if (smooth.length === 0) smooth.push({ x: to.x, y: to.y });

    var last = smooth[smooth.length - 1];
    var complete = U.dist(last.x, last.y, gx + 0.5, gy + 0.5) < 1.6;
    return { points: smooth, complete: complete };
  };

  /**
   * Destination offsets for a group order so that units do not all pile onto
   * one tile.  Returns `count` offsets in a ring/grid pattern.
   */
  Pathfind.formationOffsets = function (count, spacing) {
    spacing = spacing || 0.85;
    if (count <= 1) return [{ x: 0, y: 0 }];
    var out = [{ x: 0, y: 0 }];
    var ring = 1;
    while (out.length < count) {
      var perRing = Math.max(6, Math.floor(ring * 6.4));
      for (var i = 0; i < perRing && out.length < count; i++) {
        var a = (i / perRing) * U.TAU;
        out.push({ x: Math.cos(a) * ring * spacing, y: Math.sin(a) * ring * spacing });
      }
      ring++;
    }
    return out;
  };

  RA.Pathfind = Pathfind;
})(globalThis.RA = globalThis.RA || {});
