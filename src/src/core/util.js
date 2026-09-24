/*
 * Red Alert Web - core utilities.
 * Pure logic, no DOM access: this file is loaded both by the browser and by
 * the head-less test harness (see tools/load-core.mjs).
 */
(function (RA) {
  'use strict';

  var U = {};

  U.TAU = Math.PI * 2;

  U.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };

  U.dist2 = function (ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  U.dist = function (ax, ay, bx, by) { return Math.sqrt(U.dist2(ax, ay, bx, by)); };
  U.dist2Sq = function (dx, dy) { return dx * dx + dy * dy; };

  U.angleTo = function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); };

  /** Shortest signed difference between two angles, in (-PI, PI]. */
  U.angleDiff = function (from, to) {
    var d = (to - from) % U.TAU;
    if (d > Math.PI) d -= U.TAU;
    if (d <= -Math.PI) d += U.TAU;
    return d;
  };

  /** Rotate `from` towards `to` by at most `maxStep` radians. */
  U.turnToward = function (from, to, maxStep) {
    var d = U.angleDiff(from, to);
    if (Math.abs(d) <= maxStep) return to;
    return from + U.sign(d) * maxStep;
  };

  U.normalizeAngle = function (a) {
    a = a % U.TAU;
    if (a < 0) a += U.TAU;
    return a;
  };

  /** Deterministic PRNG (mulberry32) - the simulation never uses Math.random. */
  U.makeRng = function (seed) {
    var a = (seed >>> 0) || 1;
    var f = function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.int = function (n) { return Math.floor(f() * n); };
    f.range = function (lo, hi) { return lo + f() * (hi - lo); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; };
    f.chance = function (p) { return f() < p; };
    return f;
  };

  U.hashSeed = function (str) {
    var h = 2166136261 >>> 0;
    str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  U.parseInt = function (v, fallback) {
    var n = parseInt(v, 10);
    return isFinite(n) ? n : fallback;
  };

  /**
   * Binary min-heap. `cmp(a, b)` returns negative when `a` should pop first.
   */
  U.Heap = function (cmp) {
    this.items = [];
    this.cmp = cmp || function (a, b) { return a - b; };
  };
  U.Heap.prototype.size = function () { return this.items.length; };
  U.Heap.prototype.clear = function () { this.items.length = 0; };
  U.Heap.prototype.push = function (v) {
    var it = this.items, cmp = this.cmp;
    it.push(v);
    var i = it.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (cmp(it[i], it[p]) < 0) { var t = it[i]; it[i] = it[p]; it[p] = t; i = p; }
      else break;
    }
  };
  U.Heap.prototype.pop = function () {
    var it = this.items, cmp = this.cmp;
    if (it.length === 0) return undefined;
    var top = it[0], last = it.pop();
    if (it.length === 0) return top;
    it[0] = last;
    var i = 0, n = it.length;
    for (;;) {
      var l = i * 2 + 1, r = l + 1, best = i;
      if (l < n && cmp(it[l], it[best]) < 0) best = l;
      if (r < n && cmp(it[r], it[best]) < 0) best = r;
      if (best === i) break;
      var t = it[i]; it[i] = it[best]; it[best] = t;
      i = best;
    }
    return top;
  };

  /** Small bounded LRU cache (used by the path cache). */
  U.LruCache = function (limit) {
    this.limit = limit || 256;
    this.map = new Map();
  };
  U.LruCache.prototype.get = function (k) {
    if (!this.map.has(k)) return undefined;
    var v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  };
  U.LruCache.prototype.set = function (k, v) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.limit) {
      var first = this.map.keys().next().value;
      this.map.delete(first);
    }
  };
  U.LruCache.prototype.clear = function () { this.map.clear(); };

  U.formatMoney = function (n) {
    n = Math.max(0, Math.round(n));
    var s = String(n);
    var out = '';
    while (s.length > 3) {
      out = ',' + s.slice(-3) + out;
      s = s.slice(0, -3);
    }
    return '$' + s + out;
  };

  U.formatTime = function (ticks, hz) {
    var total = Math.max(0, Math.floor(ticks / hz));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  RA.Util = U;
  RA.SIM_HZ = 30;
})(globalThis.RA = globalThis.RA || {});
