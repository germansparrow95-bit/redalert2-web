/*
 * Isometric projection helpers shared by the renderer and the input layer.
 * Tile space (x,y) -> screen space, with the camera applied separately by the
 * canvas transform.
 */
(function (RA) {
  'use strict';

  var TW = RA.Art ? RA.Art.TILE_W : 64;
  var TH = RA.Art ? RA.Art.TILE_H : 32;

  var Iso = RA.Iso = {
    TILE_W: TW,
    TILE_H: TH
  };

  Iso.refresh = function () {
    TW = Iso.TILE_W = RA.Art.TILE_W;
    TH = Iso.TILE_H = RA.Art.TILE_H;
  };

  /** Tile-space point (floats) to iso screen pixels (camera not applied). */
  Iso.toScreen = function (x, y) {
    return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
  };
  Iso.sx = function (x, y) { return (x - y) * (TW / 2); };
  Iso.sy = function (x, y) { return (x + y) * (TH / 2); };

  /** Iso screen pixels back to tile-space floats. */
  Iso.toTile = function (sx, sy) {
    var a = sx / (TW / 2);
    var b = sy / (TH / 2);
    return { x: (b + a) / 2, y: (b - a) / 2 };
  };

  /** Screen pixel (already camera-relative) to the tile under it. */
  Iso.tileAt = function (sx, sy) {
    var t = Iso.toTile(sx, sy);
    return { x: Math.floor(t.x), y: Math.floor(t.y), fx: t.x, fy: t.y };
  };

  /** Bounding box of the whole map in iso screen pixels. */
  Iso.mapBounds = function (map) {
    return {
      minX: -(map.h) * (TW / 2),
      minY: 0,
      maxX: (map.w) * (TW / 2),
      maxY: (map.w + map.h) * (TH / 2)
    };
  };
})(globalThis.RA = globalThis.RA || {});
