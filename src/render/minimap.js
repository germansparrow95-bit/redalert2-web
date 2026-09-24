/*
 * Classic diamond radar/minimap.
 *   - terrain + ore layer is baked into an off-screen canvas and refreshed
 *     occasionally (ore gets mined out)
 *   - the fog layer is refreshed every few ticks
 *   - units and structures are drawn as coloured blips each frame
 *   - clicking or dragging moves the main camera
 */
(function (RA) {
  'use strict';

  var U = RA.Util;
  var Rules = RA.Rules;
  var T = RA.TERRAIN;
  var Minimap = RA.Minimap = {};

  var TERRAIN_COLORS = {
    0: '#1d4a70',
    1: '#3f6b36',
    2: '#5d6540',
    3: '#a2926a',
    4: '#6d6a5e',
    5: '#2f5a2c'
  };

  Minimap.create = function (canvas, state, playerIdx) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var map = state.map;
    var s = Math.min((W - 10) / (map.w + map.h), (H - 10) / ((map.w + map.h) / 2));
    var origin = { x: W / 2, y: H / 2 - ((map.w + map.h) * s) / 4 + (map.h - map.w) * 0 };
    var base = RA.Art.canvas(W, H);
    var fogC = RA.Art.canvas(W, H);
    var lastBaseTick = -9999;
    var lastFogTick = -9999;

    function toMap(tx, ty) {
      return {
        x: origin.x + (tx - ty) * s * 0.5,
        y: origin.y + (tx + ty) * s * 0.25
      };
    }
    function toTile(mx, my) {
      var a = (mx - origin.x) / (s * 0.5);
      var b = (my - origin.y) / (s * 0.25);
      return { x: (b + a) / 2, y: (b - a) / 2 };
    }
    function clampOrigin() {
      origin.y = H / 2 - ((map.w + map.h) * s) / 4;
    }
    clampOrigin();

    function rebuildBase() {
      var g = base.getContext('2d');
      g.clearRect(0, 0, W, H);
      for (var y = 0; y < map.h; y++) {
        for (var x = 0; x < map.w; x++) {
          var p = toMap(x, y);
          var i = map.idx(x, y);
          g.fillStyle = TERRAIN_COLORS[map.terrain[i]] || '#3f6b36';
          g.fillRect(p.x - s * 0.5, p.y - s * 0.25, s, s * 0.5);
          if (map.ore[i] > 0) {
            g.fillStyle = map.oreKind[i] === 2 ? '#e8d24a' : '#c8a63a';
            g.fillRect(p.x - s * 0.25, p.y - s * 0.15, s * 0.5, s * 0.3);
          }
        }
      }
      lastBaseTick = state.tick;
    }

    function rebuildFog() {
      var g = fogC.getContext('2d');
      var player = state.players[playerIdx];
      g.clearRect(0, 0, W, H);
      if (!state.fog) return;
      for (var y = 0; y < map.h; y++) {
        for (var x = 0; x < map.w; x++) {
          var i = map.idx(x, y);
          if (player.visibility.visible[i]) continue;
          var p = toMap(x, y);
          g.fillStyle = player.visibility.explored[i] ? 'rgba(4,8,14,0.55)' : 'rgba(3,5,8,0.96)';
          g.fillRect(p.x - s * 0.5, p.y - s * 0.25, s + 0.5, s * 0.5 + 0.5);
        }
      }
      lastFogTick = state.tick;
    }

    function draw(state, view) {
      if (state.tick - lastBaseTick > 60) rebuildBase();
      if (state.tick - lastFogTick > 4) rebuildFog();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0f16';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0);
      var player = state.players[playerIdx];
      var i, e, p;
      // structures
      for (i = 0; i < state.buildings.length; i++) {
        e = state.buildings[i];
        if (e.dead) continue;
        if (state.fog && e.owner !== playerIdx && !RA.Sim.exploredAt(state, playerIdx, e.cx, e.cy)) continue;
        p = toMap(e.cx, e.cy);
        ctx.fillStyle = state.players[e.owner].color.hex;
        var sz = Math.max(2.5, (e.w + e.h) * s * 0.3);
        ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      }
      // units
      for (i = 0; i < state.units.length; i++) {
        e = state.units[i];
        if (e.dead) continue;
        if (state.fog && e.owner !== playerIdx && !RA.Sim.visibleAt(state, playerIdx, e.x, e.y)) continue;
        p = toMap(e.x, e.y);
        ctx.fillStyle = state.players[e.owner].color.light;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      ctx.drawImage(fogC, 0, 0);
      // camera rectangle
      if (view && view.renderer) {
        var cam = view.renderer.camera;
        var tl = view.renderer.screenToWorld(0, 0);
        var br = view.renderer.screenToWorld(view.renderer.canvas.width, view.renderer.canvas.height);
        var a = RA.Iso.toTile(tl.x, tl.y);
        var b = RA.Iso.toTile(br.x, br.y);
        var p1 = toMap(a.x, a.y);
        var p2 = toMap(b.x, b.y);
        var p3 = toMap(b.x, a.y);
        var p4 = toMap(a.x, b.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.stroke();
      }
      void player;
    }

    return {
      canvas: canvas,
      draw: draw,
      toTile: toTile,
      toMap: toMap,
      /** Convert a click on the minimap into tile coordinates. */
      clickToTile: function (mx, my) {
        var t = toTile(mx, my);
        return { x: U.clamp(Math.floor(t.x), 0, map.w - 1), y: U.clamp(Math.floor(t.y), 0, map.h - 1) };
      },
      rebuild: function () { rebuildBase(); rebuildFog(); }
    };
  };
})(globalThis.RA = globalThis.RA || {});
