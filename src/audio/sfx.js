/*
 * All sound effects are synthesised with the Web Audio API - the project ships
 * no audio files at all.  Short envelopes on oscillators and filtered noise
 * give the classic RTS "radio chatter + explosions" feel.
 */
(function (RA) {
  'use strict';

  var Sfx = RA.Sfx = {};
  var ctx = null;
  var master = null;
  var enabled = true;
  var volume = 0.6;
  var lastPlay = {};

  function ensure() {
    if (ctx) return ctx;
    var Ctor = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return ctx;
  }

  Sfx.init = function (opts) {
    opts = opts || {};
    if (opts.volume !== undefined) volume = opts.volume;
    if (opts.enabled !== undefined) enabled = opts.enabled;
    if (master) master.gain.value = volume;
  };
  Sfx.setVolume = function (v) {
    volume = v;
    if (master) master.gain.value = v;
  };
  Sfx.setEnabled = function (v) { enabled = v; };
  Sfx.resume = function () {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  };

  function now() { return ctx.currentTime; }

  function tone(freq, dur, type, gain, delay, sweepTo) {
    if (!ctx) return;
    var t0 = now() + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  var noiseBuf = null;
  function noiseBuffer() {
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noise(dur, filterFrom, filterTo, gain, delay, type) {
    if (!ctx) return;
    var t0 = now() + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    var filt = ctx.createBiquadFilter();
    filt.type = type || 'lowpass';
    filt.frequency.setValueAtTime(filterFrom, t0);
    filt.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  var BANK = {
    radio: function () {
      // short radio blip used when no Chinese voice is available
      noise(0.05, 2600, 900, 0.05, 0, 'bandpass');
      tone(1180, 0.04, 'square', 0.05);
      tone(760, 0.05, 'square', 0.045, 0.04);
    },
    click: function () { tone(880, 0.05, 'square', 0.10); },
    select: function () { tone(1320, 0.05, 'triangle', 0.07); },
    ack: function () {
      tone(520, 0.06, 'square', 0.10);
      tone(700, 0.05, 'square', 0.08, 0.06);
      noise(0.12, 2600, 700, 0.05, 0, 'bandpass');
    },
    ackAttack: function () {
      tone(400, 0.09, 'sawtooth', 0.11);
      tone(300, 0.1, 'sawtooth', 0.09, 0.08);
    },
    deny: function () { tone(180, 0.18, 'square', 0.12, 0, 120); },
    nofunds: function () {
      tone(240, 0.12, 'square', 0.10);
      tone(180, 0.14, 'square', 0.10, 0.12);
    },
    place: function () { noise(0.18, 900, 200, 0.25); tone(90, 0.14, 'sine', 0.12); },
    cancel: function () { tone(420, 0.07, 'triangle', 0.09, 0, 240); },
    unitReady: function () {
      tone(660, 0.09, 'triangle', 0.10);
      tone(880, 0.12, 'triangle', 0.09, 0.09);
    },
    buildingComplete: function () {
      tone(520, 0.1, 'triangle', 0.11);
      tone(660, 0.1, 'triangle', 0.10, 0.1);
      tone(780, 0.18, 'triangle', 0.09, 0.2);
    },
    shot: function () { noise(0.07, 3200, 700, 0.12, 0, 'bandpass'); },
    bigShot: function () { noise(0.16, 1600, 200, 0.3); tone(120, 0.12, 'sawtooth', 0.10, 0, 60); },
    explosion: function (size) {
      var s = size || 1;
      noise(0.35 * s, 1400, 120, 0.35, 0, 'lowpass');
      tone(90, 0.3 * s, 'sine', 0.16, 0, 40);
    },
    bigExplosion: function () {
      noise(0.7, 1800, 80, 0.45);
      tone(70, 0.6, 'sine', 0.22, 0, 30);
      noise(0.4, 600, 100, 0.25, 0.12);
    },
    promote: function () {
      tone(660, 0.08, 'triangle', 0.10);
      tone(880, 0.08, 'triangle', 0.10, 0.07);
      tone(1100, 0.14, 'triangle', 0.10, 0.14);
    },
    capture: function () {
      tone(300, 0.5, 'sawtooth', 0.12, 0, 1200);
      tone(600, 0.4, 'square', 0.06, 0.1, 1800);
    },
    sell: function () {
      tone(1200, 0.07, 'square', 0.10);
      tone(900, 0.07, 'square', 0.10, 0.07);
      tone(1400, 0.1, 'square', 0.10, 0.14);
    },
    unload: function () {
      tone(1500, 0.05, 'triangle', 0.07);
      tone(1800, 0.05, 'triangle', 0.06, 0.05);
    },
    lowPower: function () {
      tone(300, 0.3, 'square', 0.12, 0, 160);
      tone(240, 0.3, 'square', 0.10, 0.3, 130);
    },
    underAttack: function () {
      tone(950, 0.16, 'square', 0.13);
      tone(700, 0.2, 'square', 0.12, 0.16);
    },
    victory: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(f, 0.28, 'triangle', 0.12, i * 0.16);
      });
    },
    defeat: function () {
      [400, 330, 260, 180].forEach(function (f, i) {
        tone(f, 0.35, 'sawtooth', 0.11, i * 0.2);
      });
    }
  };

  /** Minimum gap between repeats of the same sound (anti audio spam). */
  var THROTTLE = {
    radio: 0.12,
    shot: 0.035,
    bigShot: 0.06,
    explosion: 0.05,
    underAttack: 6,
    unitReady: 0.12,
    buildingComplete: 0.2,
    promote: 0.2
  };

  Sfx.play = function (name, arg) {
    if (!enabled) return;
    if (!ensure()) return;
    var fn = BANK[name];
    if (!fn) return;
    var gap = THROTTLE[name] || 0;
    if (gap) {
      var t = now();
      if (lastPlay[name] && t - lastPlay[name] < gap) return;
      lastPlay[name] = t;
    }
    try { fn(arg); } catch (e) { /* never let audio break the game */ }
  };

  Sfx.names = Object.keys(BANK);
})(globalThis.RA = globalThis.RA || {});
