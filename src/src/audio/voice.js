/*
 * Voice-over.
 *
 * Every callout is spoken in Chinese through the browser's built-in speech
 * engine (`speechSynthesis`, lang "zh-CN"): unit acknowledgements, base
 * alerts, build reports and the mission result.  Nothing is downloaded and no
 * audio file ships with the project.
 *
 * If the browser has no Chinese voice installed the module degrades to a
 * short radio blip (synthesised by sfx.js) so the game still feels alive -
 * it never falls back to English speech.
 */
(function (RA) {
  'use strict';

  var Voice = RA.Voice = {};

  var enabled = true;
  var volume = 0.9;
  var lang = 'zh';
  var unlocked = false;
  var available = null;          // true/false once probed
  var zhVoice = null;
  var lastSpokeAt = -1e9;
  var recent = {};
  var pending = 0;
  var lastLineKey = '';
  var spokenCount = 0;
  var lastSpoken = '';

  Voice.MIN_GAP_MS = 240;        // never machine-gun the announcer
  Voice.REPEAT_MS = 2600;        // the same line will not repeat immediately

  // ---------------------------------------------------------------------
  // Lines.  Chinese is the default; English is kept for the language option.
  // ---------------------------------------------------------------------
  var LINES = {
    zh: {
      ackInfantry: ['是，长官！', '明白。', '正在前进。', '收到命令。'],
      ackVehicle: ['收到，坦克连出发。', '明白，前进。', '坦克就位。', '引擎已启动。'],
      ackAir: ['飞行兵起飞。', '空中单位明白。', '高度拉升。'],
      ackHarvester: ['前往矿区。', '去采矿。', '明白，矿车出发。'],
      ackEngineer: ['工程师就位。', '明白，准备渗透。'],
      ackAttack: ['锁定目标，开火！', '开火！', '消灭他们！', '全体攻击！'],
      ackStop: ['停止前进。', '全体停下。'],
      ackGuard: ['原地警戒。', '保持阵地。'],
      ackScatter: ['散开！', '快散开！'],
      select: [],
      underAttack: ['指挥官，基地遭到攻击！', '警报！我们正被攻击！', '敌人打进来了！'],
      lowPower: ['电力不足！防御系统离线！', '电力告急，请立刻补充发电！'],
      unitReady: ['单位就绪。', '新单位已下线。'],
      structureReady: ['建筑完成，请选择建造位置。', '建造已就绪，等待部署。'],
      buildingComplete: ['建造完成。', '新建筑已上线。'],
      noFunds: ['资金不足。', '我们没有那么多资金。'],
      noRefinery: ['没有精炼厂，矿石无法卸载。', '请先建造精炼厂。'],
      noOre: ['附近没有可开采的矿石了。', '矿区已经枯竭。'],
      promote: ['单位获得晋升。', '我们的部队更强了。'],
      capture: ['建筑已占领！', '目标建筑到手！'],
      defeat: ['所有建筑已被摧毁……', '基地失守了，指挥官。'],
      victory: ['任务完成，指挥官！', '敌人已被彻底击溃！'],
      suddenDeath: ['卫星上线，全图视野已开启。'],
      place: ['建造开始。', '工程车开始施工。'],
      sell: ['建筑已出售。', '设施已拆除。'],
      oreUnload: ['矿石卸载完成。'],
      deny: ['无法执行。', '这里不行。']
    },
    en: {
      ackInfantry: ['Yes sir!', 'Moving out.', 'Understood.'],
      ackVehicle: ['Tank company moving.', 'Rolling out.', 'Engine started.'],
      ackAir: ['Rocketeer airborne.'],
      ackHarvester: ['Heading for the ore.'],
      ackEngineer: ['Engineer ready.'],
      ackAttack: ['Target locked, fire!', 'Open fire!'],
      ackStop: ['Holding position.'],
      ackGuard: ['Guarding.'],
      ackScatter: ['Scatter!'],
      select: [],
      underAttack: ['Commander, our base is under attack!'],
      lowPower: ['Low power! Defences offline!'],
      unitReady: ['Unit ready.'],
      structureReady: ['Structure ready, choose a location.'],
      buildingComplete: ['Construction complete.'],
      noFunds: ['Insufficient funds.'],
      noRefinery: ['No refinery to unload at.'],
      noOre: ['No ore left in reach.'],
      promote: ['Unit promoted.'],
      capture: ['Structure captured!'],
      defeat: ['All our structures are gone...'],
      victory: ['Mission accomplished, commander!'],
      suddenDeath: ['Satellite uplink online - the shroud is lifted.'],
      place: ['Construction started.'],
      sell: ['Structure sold.'],
      oreUnload: ['Ore unloaded.'],
      deny: ['Cannot do that.']
    }
  };

  // ---------------------------------------------------------------------
  function speech() {
    if (typeof window === 'undefined') return null;
    return window.speechSynthesis || null;
  }

  function probe() {
    if (available !== null) return available;
    var synth = speech();
    if (!synth || typeof synth.speak !== 'function') {
      available = false;
      return available;
    }
    try {
      var voices = synth.getVoices ? synth.getVoices() : [];
      zhVoice = null;                       // re-detect: the list may have changed
      for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v && v.lang && v.lang.toLowerCase().indexOf('zh') === 0) { zhVoice = v; break; }
      }
      if (!zhVoice) {
        for (i = 0; i < voices.length; i++) {
          var n = (voices[i].name || '').toLowerCase();
          if (n.indexOf('chinese') >= 0 || n.indexOf('mandarin') >= 0 || n.indexOf('中文') >= 0) {
            zhVoice = voices[i];
            break;
          }
        }
      }
      // Some browsers report an empty list until the voiceschanged event fires.
      if (!voices.length) { available = null; return false; }
      available = true;
      return available;
    } catch (e) {
      available = false;
      return false;
    }
  }

  Voice.available = function () { return probe() === true; };
  Voice.hasChineseVoice = function () { probe(); return !!zhVoice; };
  Voice.voiceName = function () { probe(); return zhVoice ? (zhVoice.name || '') : ''; };

  Voice.init = function (opts) {
    opts = opts || {};
    if (opts.enabled !== undefined) enabled = opts.enabled;
    if (opts.volume !== undefined) volume = opts.volume;
    if (opts.lang) lang = opts.lang;
    available = null;              // force a fresh voice-list probe
    zhVoice = null;
    probe();
    var synth = speech();
    if (synth) {
      try {
        if (typeof synth.onvoiceschanged !== 'undefined') {
          synth.onvoiceschanged = function () { available = null; probe(); };
        }
        if (synth.addEventListener) {
          synth.addEventListener('voiceschanged', function () { available = null; probe(); });
        }
      } catch (e) { /* ignore */ }
    }
  };

  Voice.setEnabled = function (v) { enabled = !!v; if (!v) Voice.stop(); };
  Voice.setVolume = function (v) { volume = Math.max(0, Math.min(1, v)); };
  Voice.setLang = function (l) { lang = (l === 'en') ? 'en' : 'zh'; };
  Voice.isEnabled = function () { return enabled; };
  Voice.getLang = function () { return lang; };

  /** Called from the first user gesture: mobiles need this before speaking. */
  Voice.unlock = function () {
    var synth = speech();
    if (!synth) return;
    try {
      if (synth.resume) synth.resume();
      if (!unlocked) {
        var u = new window.SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.lang = lang === 'en' ? 'en-US' : 'zh-CN';
        synth.speak(u);
        unlocked = true;
      }
    } catch (e) { /* ignore */ }
  };

  Voice.stop = function () {
    var synth = speech();
    if (!synth) return;
    try { synth.cancel(); } catch (e) { /* ignore */ }
    pending = 0;
  };

  /** Pick a line for a key (rotating, never repeating the same one twice). */
  Voice.pick = function (key) {
    var table = LINES[lang] || LINES.zh;
    var list = table[key] || LINES.zh[key];
    if (!list || !list.length) return '';
    if (list.length === 1) return list[0];
    var index;
    for (var tries = 0; tries < 6; tries++) {
      index = Math.floor(Math.random() * list.length);
      if (list[index] !== lastLineKey) break;
    }
    lastLineKey = list[index];
    return lastLineKey;
  };

  function now() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function rateLimit(key) {
    var t = now();
    if (t - lastSpokeAt < Voice.MIN_GAP_MS) return false;
    if (recent[key] && t - recent[key] < Voice.REPEAT_MS) return false;
    return true;
  }

  /**
   * Speak `text`; when the speech engine is unavailable or muted, fall back to
   * a short radio blip so the player still gets audible feedback.
   */
  Voice.say = function (text, key, opts) {
    if (!text) return false;
    opts = opts || {};
    key = key || text;
    if (!opts.force && !rateLimit(key)) return false;
    lastSpokeAt = now();
    recent[key] = lastSpokeAt;
    if (!enabled || volume <= 0) {
      if (RA.Sfx && RA.Sfx.play && !opts.silentFallback) RA.Sfx.play('radio');
      return false;
    }
    lastSpoken = text;
    var synth = speech();
    var canSpeak = synth && probe() !== false && (lang === 'en' ? true : Voice.hasChineseVoice());
    if (!canSpeak) {
      // No Chinese voice: keep it in-language by using a radio blip instead.
      if (RA.Sfx && RA.Sfx.play && !opts.silentFallback) RA.Sfx.play('radio');
      return false;
    }
    if (pending > 1) return false;                 // do not build a backlog
    try {
      var u = new window.SpeechSynthesisUtterance(text);
      u.lang = lang === 'en' ? 'en-US' : 'zh-CN';
      u.volume = volume;
      u.rate = opts.rate || (lang === 'en' ? 1.05 : 1.12);
      u.pitch = opts.pitch || 1;
      if (zhVoice && lang !== 'en') u.voice = zhVoice;
      pending++;
      spokenCount++;
      u.onend = function () { pending = Math.max(0, pending - 1); };
      u.onerror = function () { pending = Math.max(0, pending - 1); };
      synth.speak(u);
      return true;
    } catch (e) {
      pending = Math.max(0, pending - 1);
      return false;
    }
  };

  /** Speak a named line, e.g. Voice.speak('underAttack'). */
  Voice.speak = function (key, opts) {
    var text = Voice.pick(key);
    if (!text) return false;
    return Voice.say(text, key, opts);
  };

  /** Unit acknowledgement, chosen by the kind of unit that was ordered. */
  Voice.unitReply = function (state, ids, command) {
    if (!enabled || !ids || !ids.length) return false;
    var key = 'ackInfantry';
    var sawVehicle = false, sawAir = false, sawHarvester = false, sawEngineer = false, sawInfantry = false;
    for (var i = 0; i < ids.length; i++) {
      var e = RA.Sim.byId(state, ids[i]);
      if (!e || e.kind !== 'unit') continue;
      if (e.def.flying) sawAir = true;
      else if (e.def.capacity) sawHarvester = true;
      else if (e.def.abilities && e.def.abilities.indexOf('capture') >= 0) sawEngineer = true;
      else if (e.def.tab === 'vehicles') sawVehicle = true;
      else sawInfantry = true;
    }
    if (command === 'attack') key = 'ackAttack';
    else if (command === 'stop') key = 'ackStop';
    else if (command === 'guard') key = 'ackGuard';
    else if (command === 'scatter') key = 'ackScatter';
    else if (sawAir) key = 'ackAir';
    else if (sawVehicle) key = 'ackVehicle';
    else if (sawHarvester && !sawInfantry) key = 'ackHarvester';
    else if (sawEngineer && !sawInfantry) key = 'ackEngineer';
    return Voice.speak(key);
  };

  Voice.debug = {
    spokenCount: function () { return spokenCount; },
    lastSpoken: function () { return lastSpoken; },
    reset: function () {
      spokenCount = 0; lastSpoken = ''; pending = 0;
      lastSpokeAt = -1e9; recent = {}; lastLineKey = '';
    },
    lines: function (key) { return (LINES[lang] || LINES.zh)[key] || []; }
  };

  RA.Voice = Voice;
})(globalThis.RA = globalThis.RA || {});
