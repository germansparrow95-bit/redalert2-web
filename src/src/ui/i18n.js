/*
 * Localisation.  Chinese is the default language; English is kept complete so
 * the interface can be switched at runtime.  Everything the player reads or
 * hears goes through this table, so text and voice always match.
 */
(function (RA) {
  'use strict';

  var Rules = RA.Rules;
  var I18n = RA.I18n = {};

  I18n.LANGS = ['zh', 'en'];
  I18n.lang = 'zh';

  var STRINGS = {
    zh: {
      'menu.subtitle': '经典等距视角即时战略 · 网页版遭遇战',
      'menu.footer': '全部代码与美术均为原创，不含任何商业游戏素材。',
      'menu.skirmish': '遭遇战',
      'menu.help': '玩法说明',
      'menu.options': '设置',
      'menu.about': '关于',

      'common.back': '返回',
      'common.start': '开始战斗',
      'common.resume': '继续战斗',
      'common.restart': '重新开始',
      'common.quit': '退出到主菜单',
      'common.menu': '主菜单',
      'common.rematch': '再战一局',
      'common.on': '开',
      'common.off': '关',
      'common.paused': '已暂停',
      'common.win': '任务完成',
      'common.lose': '任务失败',
      'common.random': '随机',

      'skirmish.title': '遭遇战设置',
      'skirmish.yourFaction': '你的阵营',
      'skirmish.color': '颜色',
      'skirmish.opponents': '电脑对手',
      'skirmish.difficulty': '难度',
      'skirmish.theirFaction': '对手阵营',
      'skirmish.battlefield': '战场规模',
      'skirmish.startBase': '初始基地',
      'skirmish.startCredits': '初始资金',
      'skirmish.rules': '规则',
      'skirmish.shortGame': '速战规则',
      'skirmish.fog': '战争迷雾',
      'skirmish.seed': '地图种子',
      'skirmish.randomise': '重新随机',
      'skirmish.opponentsN': '{n} 个电脑',
      'hint.difficulty': '难度只影响电脑的思考频率与生产速度，它不会凭空得到资源。',
      'hint.rules': '速战规则：摧毁对方全部建造厂立即获胜；关闭后必须推平整个基地。',
      'hint.seed': '相同的种子（以及相同的设置）会生成完全一样的战场，可以写进作业报告里分享。',
      'hint.enemyFaction': '让电脑使用盟军、苏军，或者两者混合。',

      'options.title': '设置',
      'options.language': '界面语言',
      'options.sound': '音效音量',
      'options.soundOn': '音效',
      'options.voice': '中文语音',
      'options.voiceVolume': '语音音量',
      'options.voiceTest': '试听语音',
      'options.voiceMissing': '当前浏览器没有找到中文语音包，将改用无线电提示音。',
      'options.edge': '屏幕边缘滚动',
      'options.health': '显示敌方血条',
      'options.shake': '爆炸画面震动',
      'options.scroll': '滚动速度',

      'help.title': '玩法说明',
      'help.controls': '操作',
      'help.economy': '经济与基地',
      'help.units': '单位与建筑',
      'help.rows': [
        ['左键单击', '选中单位或建筑'],
        ['左键框选', '框选自己的部队'],
        ['左键双击', '选中屏幕上所有同类型单位'],
        ['右键', '移动 / 攻击 / 采矿 / 占领'],
        ['Shift + 点击', '追加选择'],
        ['Ctrl + 1..9', '记录编队；数字键召回（Alt+数字 跳到该编队）'],
        ['Q / E', '切换建造分类'],
        ['A 再点击', '攻击移动（边推进边交火）'],
        ['S / G / X', '停止 / 原地警戒 / 散开'],
        ['R / Delete', '修理 / 出售选中的建筑'],
        ['H', '视角跳回建造厂'],
        ['空格', '视角跳到最近一次警报'],
        ['鼠标滚轮', '缩放视野'],
        ['中键拖动 / 方向键 / 屏幕边缘', '移动视角'],
        ['Esc', '取消放置 / 暂停菜单'],
        ['右键点建造按钮', '取消该项生产']
      ],
      'help.economyRows': [
        ['矿车', '自动前往矿区装满矿石，再回精炼厂卸货换钱。'],
        ['矿石精炼厂', '第一座精炼厂会附赠一辆矿车；靠近新矿脉再造一座能显著提高收入。'],
        ['电力', '用电超过发电时，防御建筑停机、建造速度减半。'],
        ['建造厂', '负责建造建筑，放置时必须紧贴已有建筑。'],
        ['工程师', '走进敌方建筑即可占领（保留 50% 生命值）。'],
        ['经验晋升', '击杀敌人可让单位晋升为老兵 / 精英，火力更强并会自我修复。']
      ],

      'about.rows': [
        '<p>《Red Alert Web》是一个课程项目：用纯网页技术实现的经典等距视角即时战略遭遇战。</p>',
        '<p>你看到和听到的一切都由代码生成——地形、单位、建筑、音效与中文语音，',
        '项目不包含任何第三方美术、音频或引擎文件，也没有使用任何商业游戏的素材。</p>',
        '<p>模拟层是确定性的：一局战斗完全由地图种子决定，因此带 <code>?seed=...</code> 的链接',
        '可以还原出一模一样的战场。</p>',
        '<h3>功能</h3>',
        '<ul>',
        '<li>等距视角战场、战争迷雾与经典雷达小地图</li>',
        '<li>矿石经济、电力系统、科技树与生产队列</li>',
        '<li>装甲/弹头克制模型、溅射伤害、经验晋升与空军</li>',
        '<li>会建造、扩张、防守并成波进攻的电脑对手</li>',
        '<li>全中文语音播报（浏览器中文合成音）与中英双语界面</li>',
        '<li>确定性模拟 + 自动化无头测试套件</li>',
        '</ul>'
      ],

      'results.title': '战后统计',
      'results.time': '战斗时长',
      'results.unitsBuilt': '生产单位',
      'results.unitsLost': '损失单位',
      'results.kills': '击杀敌人',
      'results.buildingsBuilt': '建造建筑',
      'results.structuresLost': '损失建筑',
      'results.ore': '开采矿石',
      'results.credits': '累计收入',
      'results.peak': '最大兵力',
      'results.share': '这一局的分享链接：',

      'hud.credits': '资金',
      'hud.power': '电力',
      'hud.repair': '修理',
      'hud.sell': '出售',
      'hud.noSelection': '未选择任何目标',
      'hud.hp': '生命值',
      'hud.oreLoad': '载矿',
      'hud.selectedUnits': '{n} 个单位已选中',
      'hud.damage': '伤害',
      'hud.range': '射程',
      'hud.tiles': '格',
      'hud.requires': '需要',
      'hud.repairing': '修理中',
      'hud.menu': '菜单',
      'hud.hint': '左键选择 · 右键下令 · Q/E 切换分类 · Esc 暂停',
      'sw.ready': '就绪 · 点击瞄准',
      'hud.radarOffline': '雷达离线',
      'sw.chronosphere': '超时空传送仪',
      'sw.weather': '天气控制器',
      'sw.ironcurtain': '铁幕装置',
      'sw.nuke': '核弹发射井',
      'alert.radarOnline': '雷达已上线。',
      'alert.radarOffline': '雷达离线：建造雷达站后小地图才能使用。',
      'alert.superReady': '{name} 充能完毕！',
      'alert.superFired': '{name} 已发射！',
      'alert.coilCharged': '磁暴线圈已被充能！',
      'alert.coilUncharged': '磁暴线圈失去充能。',
      'alert.infiltrate': '间谍潜入成功！',
      'alert.infiltrated': '警报：敌方间谍渗透了我们的{name}！',
      'alert.chronoJump': '超时空矿车已传送回精炼厂。',
      'alert.aimSource': '请点击我方部队所在位置',
      'alert.aimTarget': '请点击传送目的地',
      'alert.superAim': '请点击目标位置',
      'alert.superCharging': '{name} 还在充能中',

      'alert.underAttack': '指挥官，基地遭到攻击！',
      'alert.lowPower': '电力不足：防御停机、建造减速！',
      'alert.unitReady': '{name} 就绪。',
      'alert.structureReady': '{name} 完成，点击图标选择建造位置。',
      'alert.buildingComplete': '{name} 已上线。',
      'alert.insufficientFunds': '资金不足。',
      'alert.noRefinery': '矿车等待中：需要一座精炼厂。',
      'alert.noOre': '附近已经没有可开采的矿石了。',
      'alert.promote': '单位晋升为{rank}。',
      'alert.capture': '建筑已占领！',
      'alert.capturedByEnemy': '敌人占领了你的{name}！',
      'alert.sell': '建筑已出售，返还 {refund}。',
      'alert.suddenDeath': '卫星上线：全图视野开启。',
      'alert.allStructuresLost': '我们失去了所有建筑……',
      'alert.groupSet': '编队 {n} 已记录（{count} 个单位）。',
      'alert.orderReceived': '收到命令。',
      'alert.cannotBuild': '无法在此建造。',
      'alert.selectOwn': '请先选中自己的建筑。',
      'alert.placed': '开始建造。',

      'reason.needPrereq': '需要{name}',
      'reason.needCredits': '资金不足',
      'reason.wrongFaction': '阵营不符',
      'reason.unavailable': '当前不可用',
      'reason.alreadyBuilt': '已经建造过',
      'reason.outsideMap': '超出地图范围',
      'reason.blocked': '该位置已被占用',
      'reason.water': '不能建造在水面上',
      'reason.cliff': '不能建造在悬崖上',
      'reason.trees': '需要先清理树木',
      'reason.ore': '不能建造在矿脉上',
      'reason.notAdjacent': '必须紧贴自己的基地建造',
      'reason.unitsInWay': '有单位挡住了位置',
      'reason.invalid': '无效的位置'
    },

    en: {
      'menu.subtitle': 'A browser skirmish in the classic isometric style',
      'menu.footer': 'Original code & procedural art. No commercial game assets included.',
      'menu.skirmish': 'Skirmish',
      'menu.help': 'How to play',
      'menu.options': 'Options',
      'menu.about': 'About',

      'common.back': 'Back',
      'common.start': 'Start battle',
      'common.resume': 'Resume',
      'common.restart': 'Restart battle',
      'common.quit': 'Quit to menu',
      'common.menu': 'Menu',
      'common.rematch': 'Rematch',
      'common.on': 'ON',
      'common.off': 'OFF',
      'common.paused': 'Paused',
      'common.win': 'Mission accomplished',
      'common.lose': 'Mission failed',
      'common.random': 'random',

      'skirmish.title': 'Skirmish setup',
      'skirmish.yourFaction': 'Your faction',
      'skirmish.color': 'Colour',
      'skirmish.opponents': 'Opponents',
      'skirmish.difficulty': 'Difficulty',
      'skirmish.theirFaction': 'Their faction',
      'skirmish.battlefield': 'Battlefield',
      'skirmish.startBase': 'Starting base',
      'skirmish.startCredits': 'Starting credits',
      'skirmish.rules': 'Rules',
      'skirmish.shortGame': 'Short game',
      'skirmish.fog': 'Fog of war',
      'skirmish.seed': 'Map seed',
      'skirmish.randomise': 'Randomise',
      'skirmish.opponentsN': '{n} computer(s)',
      'hint.difficulty': 'Difficulty only changes how fast the computer thinks and builds. It gets no free money.',
      'hint.rules': 'Short game: destroying every Construction Yard wins immediately. With it off you must level the whole base.',
      'hint.seed': 'The same seed and settings always generate the same battlefield, so you can share it.',
      'hint.enemyFaction': 'Choose the computer faction, or let them mix.',

      'options.title': 'Options',
      'options.language': 'Language',
      'options.sound': 'Sound volume',
      'options.soundOn': 'Sound effects',
      'options.voice': 'Chinese voice',
      'options.voiceVolume': 'Voice volume',
      'options.voiceTest': 'Test voice',
      'options.voiceMissing': 'No Chinese voice found in this browser; radio blips will be used instead.',
      'options.edge': 'Edge scrolling',
      'options.health': 'Show enemy health bars',
      'options.shake': 'Explosion screen shake',
      'options.scroll': 'Scroll speed',

      'help.title': 'How to play',
      'help.controls': 'Controls',
      'help.economy': 'Economy & base',
      'help.units': 'Units & structures',
      'help.rows': [
        ['Left click', 'Select a unit or structure'],
        ['Drag', 'Box-select your units'],
        ['Double click', 'Select all units of that type on screen'],
        ['Right click', 'Move / attack / harvest / capture'],
        ['Shift + click', 'Add to the current selection'],
        ['Ctrl + 1..9', 'Store a control group (Alt+number jumps to it)'],
        ['Q / E', 'Switch build tabs'],
        ['A then click', 'Attack-move'],
        ['S / G / X', 'Stop / Guard / Scatter'],
        ['R / Delete', 'Repair / sell the selected structure'],
        ['H', 'Jump to your Construction Yard'],
        ['Space', 'Jump to the last alert'],
        ['Mouse wheel', 'Zoom'],
        ['Middle drag / arrows / screen edge', 'Scroll the map'],
        ['Esc', 'Cancel placement / pause menu'],
        ['Right click a build button', 'Cancel that production order']
      ],
      'help.economyRows': [
        ['Ore Miner', 'Fills up at an ore field and unloads at a refinery for credits.'],
        ['Ore Refinery', 'Your first refinery comes with a free miner. Build more near fresh ore.'],
        ['Power', 'Consuming more than you produce shuts defences down and halves build speed.'],
        ['Construction Yard', 'Builds structures; they must be placed next to your existing base.'],
        ['Engineer', 'Walk him into an enemy structure to capture it (keeps 50% HP).'],
        ['Veterancy', 'Kills promote units to veteran and elite, with better guns and self-repair.']
      ],

      'about.rows': [
        '<p>Red Alert Web is a course project: a complete browser skirmish game in the',
        'style of the classic isometric real-time strategy games.</p>',
        '<p>Everything you see and hear is generated by code: terrain, units, buildings,',
        'sound effects and the Chinese voice-over. No third-party assets are included.</p>',
        '<p>The simulation is deterministic, so a link with <code>?seed=...</code> reproduces',
        'exactly the same battlefield.</p>',
        '<h3>Features</h3>',
        '<ul>',
        '<li>Isometric battlefield with fog of war and a classic radar</li>',
        '<li>Ore economy, power grid, tech tree and build queues</li>',
        '<li>Armour/warhead combat model, veterancy, splash damage and aircraft</li>',
        '<li>Computer opponent that builds, expands, defends and attacks in waves</li>',
        '<li>Chinese voice callouts via the browser speech engine, bilingual UI</li>',
        '<li>Deterministic simulation with an automated head-less test suite</li>',
        '</ul>'
      ],

      'results.title': 'Battle report',
      'results.time': 'Time',
      'results.unitsBuilt': 'Units built',
      'results.unitsLost': 'Units lost',
      'results.kills': 'Enemies destroyed',
      'results.buildingsBuilt': 'Structures built',
      'results.structuresLost': 'Structures lost',
      'results.ore': 'Ore harvested',
      'results.credits': 'Credits earned',
      'results.peak': 'Peak army size',
      'results.share': 'Shareable link to this map:',

      'hud.credits': 'Credits',
      'hud.power': 'Power',
      'hud.repair': 'Repair',
      'hud.sell': 'Sell',
      'hud.noSelection': 'No selection',
      'hud.hp': 'HP',
      'hud.oreLoad': 'Ore load',
      'hud.selectedUnits': '{n} units selected',
      'hud.damage': 'damage',
      'hud.range': 'range',
      'hud.tiles': 'tiles',
      'hud.requires': 'Requires',
      'hud.repairing': 'repairing',
      'hud.menu': 'Menu',
      'hud.hint': 'Left click selects · right click orders · Q/E switch tabs · Esc pauses',
      'sw.ready': 'READY - click to aim',
      'hud.radarOffline': 'RADAR OFFLINE',
      'sw.chronosphere': 'Chronosphere',
      'sw.weather': 'Weather Control Device',
      'sw.ironcurtain': 'Iron Curtain',
      'sw.nuke': 'Nuclear Missile Silo',
      'alert.radarOnline': 'Radar online.',
      'alert.radarOffline': 'Radar offline: build a Radar Tower to use the minimap.',
      'alert.superReady': '{name} is fully charged!',
      'alert.superFired': '{name} fired!',
      'alert.coilCharged': 'Tesla Coil super-charged!',
      'alert.coilUncharged': 'Tesla Coil lost its charge.',
      'alert.infiltrate': 'Spy infiltration successful!',
      'alert.infiltrated': 'Alert: an enemy spy infiltrated our {name}!',
      'alert.chronoJump': 'Chrono Miner teleported back to the refinery.',
      'alert.aimSource': 'Click the position of your troops',
      'alert.aimTarget': 'Click the teleport destination',
      'alert.superAim': 'Click the target position',
      'alert.superCharging': '{name} is still charging',

      'alert.underAttack': 'Our base is under attack',
      'alert.lowPower': 'Low power - defences offline, building slowed',
      'alert.unitReady': '{name} ready',
      'alert.structureReady': '{name} ready - click the icon to place it',
      'alert.buildingComplete': '{name} online',
      'alert.insufficientFunds': 'Insufficient funds',
      'alert.noRefinery': 'Ore miner waiting - build a refinery',
      'alert.noOre': 'No ore left in reach',
      'alert.promote': 'Unit promoted to {rank}',
      'alert.capture': 'Structure captured!',
      'alert.capturedByEnemy': 'The enemy captured your {name}!',
      'alert.sell': 'Structure sold for {refund}',
      'alert.suddenDeath': 'Satellite uplink online - the shroud is lifted',
      'alert.allStructuresLost': 'All our structures are gone',
      'alert.groupSet': 'Group {n} set ({count})',
      'alert.orderReceived': 'Order received',
      'alert.cannotBuild': 'Cannot build there',
      'alert.selectOwn': 'Select one of your own structures first',
      'alert.placed': 'Construction started',

      'reason.needPrereq': 'Requires {name}',
      'reason.needCredits': 'Not enough credits',
      'reason.wrongFaction': 'Wrong faction',
      'reason.unavailable': 'Unavailable',
      'reason.alreadyBuilt': 'Already built',
      'reason.outsideMap': 'Outside the map',
      'reason.blocked': 'Blocked',
      'reason.water': 'Cannot build on water',
      'reason.cliff': 'Cannot build on cliffs',
      'reason.trees': 'Clear the trees first',
      'reason.ore': 'Cannot build on ore',
      'reason.notAdjacent': 'Must be built next to your base',
      'reason.unitsInWay': 'Something is in the way',
      'reason.invalid': 'Invalid location'
    }
  };

  // -------------------------------------------------------------------------
  // Chinese names for the game data (unit/building/weapon/rank/faction names)
  // -------------------------------------------------------------------------
  var DEF_TEXT = {
    harvester: ['矿车', '自动开采矿石并送回精炼厂，是经济的命脉。'],
    gi: ['步兵', '廉价的制式步枪兵，对付步兵有效，也能打下飞机。'],
    guardian: ['重装步兵', '反坦克 / 防空导弹兵，推进缓慢，需要掩护。'],
    rocketeer: ['火箭飞行兵', '喷气飞行兵，可以越过地形，只有防空火力能打到他。'],
    engineer: ['工程师', '走进敌方建筑即可占领（建筑保留 50% 生命值）。'],
    grizzly: ['灰熊坦克', '速度与造价均衡的盟军主力坦克。'],
    prismtank: ['光棱坦克', '远程光棱束，火力强但装甲薄，需要护卫。'],
    conscript: ['动员兵', '造价极低、训练粗糙，靠数量取胜。'],
    flak: ['防空步兵', '机动防空火力，苏军对付火箭飞行兵的手段。'],
    rhino: ['犀牛坦克', '比灰熊略慢，但正面战斗几乎必胜。'],
    apoc: ['天启坦克', '移动堡垒：缓慢、昂贵、令人生畏。'],
    ifv: ['多功能步兵车', '战场上最快的侦察单位，可对空对地。'],
    mirage: ['幻影坦克', '静止两秒后伪装成一棵树，敌人不会主动攻击它。'],
    warminer: ['战争矿车', '一边采矿一边用机枪自卫的苏军矿车。'],
    flaktrack: ['防空履带车', '便宜快速的防空载具，也能扫射步兵。'],
    v3: ['V3 火箭发射车', '远程攻城火箭，对建筑毁伤极大，自身非常脆弱。'],
    tesla_trooper: ['磁暴步兵', '会走路的磁暴线圈，可为磁暴线圈充能（射程+35%、伤害+50%）。'],
    spy: ['间谍', '潜入敌方建筑：精炼厂偷钱、电厂断电、工厂清空生产进度。'],
    allied_adv_power: ['高级电厂', '输出是普通电厂的两倍，也更结实。'],
    allied_radar: ['空军指挥部', '雷达上行链路：没有它小地图一片漆黑（与原版一致）。'],
    allied_satellite: ['间谍卫星', '只要它存在，就永久点亮整张地图。'],
    allied_gap: ['裂缝产生器', '让范围内的我方单位从敌方雷达上消失。'],
    allied_chronosphere: ['超时空传送仪', '把一小片区域内的我方单位传送到地图任意位置。'],
    allied_weather: ['天气控制器', '在目标区域召唤持续 20 秒的闪电风暴。'],
    soviet_radar: ['雷达站', '雷达上行链路：没有它小地图一片漆黑。'],
    soviet_nuclear: ['核反应堆', '提供 2000 电力，被摧毁时会发生核爆。'],
    soviet_ironcurtain: ['铁幕装置', '让范围内我方单位 20 秒免疫所有伤害。'],
    soviet_nuke: ['核弹发射井', '向地图任意位置发射核弹。'],
    ore_purifier: ['矿石精炼器', '每车矿石的价值提高 25%。'],
    service_depot: ['维修厂', '受损载具停在旁边会自动修复（按血量扣钱）。'],
    conyard: ['建造厂', '基地核心。失去全部建造厂即告失败。'],
    allied_power: ['电厂', '提供 100 单位电力。电力不足时一切都会停摆。'],
    soviet_power: ['磁能反应堆', '提供 150 单位电力，被摧毁时会剧烈爆炸。'],
    refinery: ['矿石精炼厂', '把矿石冶炼成资金，附赠一辆矿车。'],
    barracks: ['兵营', '训练步兵。'],
    warfactory: ['战车工厂', '生产战车与矿车，右键可以设置集结点。'],
    lab: ['作战实验室', '解锁高级科技：重型坦克与高级防御。'],
    allied_pillbox: ['机枪碉堡', '便宜的机枪堡，屠杀步兵，但打不到飞机。'],
    allied_patriot: ['爱国者导弹', '防空导弹阵地，火箭飞行兵的克星。'],
    allied_prism: ['光棱塔', '聚焦光束，远距离融化坦克。'],
    soviet_sentry: ['哨戒炮', '自动加农炮，轻松击穿轻装甲。'],
    soviet_flak: ['防空炮', '高射炮：对空极强，对步兵也有用。'],
    soviet_tesla: ['磁暴线圈', '释放雷电弧，威力惊人，也非常耗电。']
  };

  var WEAPON_TEXT = {
    'M60 MG': '机枪',
    'Patriot SAM': '爱国者导弹',
    'Prism Beam': '光棱束',
    'Sentry Cannon': '哨戒炮',
    'Flak Burst': '高射炮',
    'Tesla Bolt': '磁暴电击',
    'M16 Rifle': 'M16 步枪',
    'Rocket Launcher': '火箭筒',
    'Rocket Pod': '火箭巢',
    'AK-47': 'AK-47',
    'Flak Gun': '高射机枪',
    '105mm Cannon': '105mm 加农炮',
    '120mm Cannon': '120mm 加农炮',
    'Twin 125mm': '双联 125mm 主炮'
  };

  var EXTRA = {
    zh: {
      tab: { structures: '建筑', defenses: '防御', infantry: '步兵', vehicles: '车辆' },
      faction: { allied: '盟军', soviet: '苏联', mixed: '混合' },
      difficulty: { easy: '简单', normal: '普通', hard: '困难' },
      rank: ['新兵', '老兵', '精英'],
      color: ['金色', '红色', '蓝色', '绿色', '橙色', '天蓝色', '紫色', '深灰色'],
      size: { small: '小型 64×64', medium: '中型 80×80', large: '大型 96×96' },
      start: {
        mcv: '极简：只有建造厂',
        standard: '标准：建造厂 + 2 名步兵 + $10,000',
        quick: '快速开局：附加电厂、精炼厂与矿车'
      },
      factionBlurb: {
        allied: '轻型坦克、光棱科技与空中支援。',
        soviet: '重装甲、磁能科技与廉价人海。'
      },
      prereq: {
        power: '电厂', refinery: '矿石精炼厂', barracks: '兵营',
        factory: '战车工厂', lab: '作战实验室', builder: '建造厂'
      }
    },
    en: {
      tab: { structures: 'Structures', defenses: 'Defences', infantry: 'Infantry', vehicles: 'Vehicles' },
      faction: { allied: 'Allied', soviet: 'Soviet', mixed: 'Mixed' },
      difficulty: { easy: 'Easy', normal: 'Normal', hard: 'Hard' },
      rank: ['Rookie', 'Veteran', 'Elite'],
      color: ['Gold', 'Red', 'Blue', 'Green', 'Orange', 'Sky Blue', 'Purple', 'Dark Grey'],
      size: { small: 'Small 64x64', medium: 'Medium 80x80', large: 'Large 96x96' },
      start: {
        mcv: 'Minimal - Construction Yard only',
        standard: 'Standard - Construction Yard, 2 infantry, $10,000',
        quick: 'Quick Start - add Power Plant, Refinery and a miner'
      },
      factionBlurb: {
        allied: 'Fast light tanks, laser defence, air power.',
        soviet: 'Heavy armour, tesla technology, cheap hordes.'
      },
      prereq: {
        power: 'a Power Plant', refinery: 'an Ore Refinery', barracks: 'a Barracks',
        factory: 'a War Factory', lab: 'a Battle Lab', builder: 'a Construction Yard'
      }
    }
  };

  // -------------------------------------------------------------------------
  I18n.setLang = function (lang) {
    if (I18n.LANGS.indexOf(lang) >= 0) I18n.lang = lang;
    return I18n.lang;
  };

  /** Look up a string and replace {placeholders}. */
  I18n.t = function (key, params) {
    var table = STRINGS[I18n.lang] || STRINGS.zh;
    var s = table[key];
    if (s === undefined) s = (STRINGS.zh[key] !== undefined ? STRINGS.zh[key] : key);
    if (typeof s !== 'string') return s;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return params[name] === undefined ? m : String(params[name]);
      });
    }
    return s;
  };

  I18n.arr = function (key) {
    var table = STRINGS[I18n.lang] || STRINGS.zh;
    var v = table[key];
    if (!Array.isArray(v)) v = STRINGS.zh[key];
    return Array.isArray(v) ? v : [];
  };

  I18n.extra = function () { return EXTRA[I18n.lang] || EXTRA.zh; };

  I18n.defName = function (def) {
    if (!def) return '';
    if (I18n.lang === 'zh' && DEF_TEXT[def.id]) return DEF_TEXT[def.id][0];
    return def.name;
  };
  I18n.defDesc = function (def) {
    if (!def) return '';
    if (I18n.lang === 'zh' && DEF_TEXT[def.id]) return DEF_TEXT[def.id][1];
    return def.desc || '';
  };
  I18n.weaponName = function (weapon) {
    if (!weapon) return '';
    if (I18n.lang === 'zh' && WEAPON_TEXT[weapon.name]) return WEAPON_TEXT[weapon.name];
    return weapon.name;
  };
  I18n.get = function (id) { return RA.Rules.get(id); };
  I18n.nameOf = function (id) { return I18n.defName(RA.Rules.get(id)); };
  I18n.tabName = function (tab) { return I18n.extra().tab[tab] || tab; };
  I18n.factionName = function (f) { return I18n.extra().faction[f] || f; };
  I18n.difficultyName = function (d) { return I18n.extra().difficulty[d] || d; };
  I18n.rankName = function (i) { return I18n.extra().rank[i] || ''; };
  I18n.colorName = function (i) { return I18n.extra().color[i] || ''; };
  I18n.sizeLabel = function (s) { return I18n.extra().size[s] || s; };
  I18n.startLabel = function (s) { return I18n.extra().start[s] || s; };
  I18n.factionBlurb = function (f) { return I18n.extra().factionBlurb[f] || ''; };
  I18n.prereqName = function (tag) { return I18n.extra().prereq[tag] || tag; };

  /** Turn a simulation refusal into a localised sentence. */
  I18n.reason = function (result) {
    if (!result) return '';
    if (result.reasonKey) {
      var params = {};
      if (result.needTag) params.name = I18n.prereqName(result.needTag);
      return I18n.t('reason.' + result.reasonKey, params);
    }
    return result.reason || '';
  };

  void Rules;
})(globalThis.RA = globalThis.RA || {});
