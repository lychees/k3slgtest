// SoW Tactics — Symphony of War 式小队制战棋 (数据驱动: data/*.json)
// 入口: Three.js 场景/地图渲染 + 游戏状态机 + 输入
import * as THREE from './lib/three.module.js';
import { loadData } from './js/game/data.js';
import { Squad, setTechBonuses } from './js/game/squad.js';
import * as Army from './js/game/army.js';
import { openArmyUI } from './js/game/armyui.js';
import * as Story from './js/game/story.js';
import * as Inspect from './js/game/inspect.js';
import { computeMove, computeAttackTiles, findPath } from './js/game/range.js';
import { resolveCombat } from './js/game/combat.js';
import { BattleScene } from './js/game/battlescene.js';
import { planAction } from './js/game/ai.js';
import * as UI from './js/game/ui.js';
import { loadTex, hash } from './js/game/gfx.js';
import { DIR, SPRITE_MAP, frameRect } from './js/game/sprites.js';
import { loadRealMap } from './js/game/realmap.js';

// ---------------------------------------------------------------- config
const STAGE_W = 960, STAGE_H = 540;

const params = new URLSearchParams(location.search);
const mapId = params.get('map') || 'rm004';
const DEBUG = params.get('debug');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- three setup
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(STAGE_W, STAGE_H, false);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1e);

// 1 world unit = 1 tile; origin top-left, y grows downward (frustum 由相机系统每帧设置)
const camera = new THREE.OrthographicCamera(0, 15, 0, -15 * STAGE_H / STAGE_W, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

const battleScene = new BattleScene(renderer);

let db = null;          // 数据索引
let COLS = 0, ROWS = 0;
let MAP = [];           // 规范化后的地形字符行 (手绘地图模式)
let realMap = null;     // 真实 VX Ace 地图模式 (?map=rm004)
let squads = [];

const PLAIN_FALLBACK = { id: 'plain', char: '.', name: '平原', avo: 0, def: 0, cost: 1, pass: true, tile: 'tile_grass' };

function terrainAt(x, y) {
  if (realMap) return realMap.terrainAt(x, y);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return PLAIN_FALLBACK;
  return db.terrainByChar[MAP[y][x]] || PLAIN_FALLBACK;
}
function squadAt(x, y) { return squads.find(s => s.x === x && s.y === y); }

// 供 range/combat/ai 模块使用的上下文
const ctx = {
  get cols() { return COLS; },
  get rows() { return ROWS; },
  get squads() { return squads; },
  terrainAt,
  squadAt,
  computeMove: s => computeMove(s, ctx),
  terrainAvo: s => terrainAt(s.x, s.y).avo,
};

// ---------------------------------------------------------------- camera (平滑跟随 + 整数倍缩放)
// 缩放级别 = 整数倍: 1x=32px/格, 2x=64px/格(默认), 3x=96px/格 — 保持 Nearest 像素对齐
const cam = { cx: 0, cy: 0, tx: 0, ty: 0, level: 2 };   // tile 坐标 (cy 向下为正)

function tilePx() { return 32 * cam.level; }
function camVW() { return STAGE_W / tilePx(); }
function camVH() { return STAGE_H / tilePx(); }
function camLeft() { return cam.cx - camVW() / 2; }
function camTop() { return cam.cy - camVH() / 2; }

function clampCamValue(v, size, view) {
  return size > view ? Math.max(view / 2, Math.min(size - view / 2, v)) : size / 2;
}
function clampCamTarget() {
  cam.tx = clampCamValue(cam.tx, COLS, camVW());
  cam.ty = clampCamValue(cam.ty, ROWS, camVH());
}
function clampCamNow() {
  cam.cx = clampCamValue(cam.cx, COLS, camVW());
  cam.cy = clampCamValue(cam.cy, ROWS, camVH());
}

function setCamTargetTile(x, y) {
  cam.tx = x + 0.5;
  cam.ty = y + 0.5;
  clampCamTarget();
}

// 立即对齐相机到目标 (菜单弹出/脚本测试等需要画面稳定的时刻)
function snapCamera() {
  cam.cx = cam.tx;
  cam.cy = cam.ty;
  clampCamNow();
}

// 滚轮缩放: 以鼠标所指点为锚 (缩放前后鼠标下是同一地图点)
function setZoom(level, anchorClient) {
  level = Math.max(1, Math.min(3, level));
  if (level === cam.level) return;
  let fx = null, fy = null, px = 0, py = 0;
  if (anchorClient) {
    const r = stage.getBoundingClientRect();
    const s = r.width / STAGE_W;
    px = (anchorClient.x - r.left) / s;
    py = (anchorClient.y - r.top) / s;
    fx = camLeft() + px / tilePx();
    fy = camTop() + py / tilePx();
  }
  cam.level = level;
  if (fx !== null) {
    cam.cx = fx - px / tilePx() + camVW() / 2;
    cam.cy = fy - py / tilePx() + camVH() / 2;
  }
  clampCamNow();
  cam.tx = cam.cx;
  cam.ty = cam.cy;
  updateZoomLabel();
}

function updateZoomLabel() {
  const el = $('zoom-label');
  if (el) el.textContent = `${cam.level}x`;
}

function updateCamera(dt) {
  const k = 1 - Math.pow(0.002, dt);   // 帧率无关 lerp
  cam.cx += (cam.tx - cam.cx) * k;
  cam.cy += (cam.ty - cam.cy) * k;
  clampCamNow();
  const vw = camVW(), vh = camVH();
  camera.left = cam.cx - vw / 2;
  camera.right = cam.cx + vw / 2;
  camera.top = -(cam.cy - vh / 2);
  camera.bottom = -(cam.cy + vh / 2);
  camera.updateProjectionMatrix();
}

// tile -> 舞台 px (含当前相机偏移)
function tileToScreen(tx, ty) {
  const tp = tilePx();
  return [(tx - camLeft()) * tp, (ty - camTop()) * tp, tp];
}

// ---------------------------------------------------------------- ground build
const waterTiles = [];
const treeTiles = [];
const decoTiles = [];

const DECO = ['deco_flowers1', 'deco_flowers2', 'deco_bush', 'deco_shrooms', 'deco_log', 'deco_stump'];

function buildGround() {
  if (realMap) { buildRealGround(); return; }
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = COLS * 32;
  groundCanvas.height = ROWS * 32;
  const gctx = groundCanvas.getContext('2d');
  gctx.imageSmoothingEnabled = false;

  // 收集需要的地面贴图 (tile_*; 水面用 shader, 森林用草地打底 + 树)
  const names = new Set(['tile_grass', 'tile_grass_dark']);
  for (const t of db.terrains) {
    if (t.tile.startsWith('tile_') && t.tile !== 'tile_water') names.add(t.tile);
  }
  const imgs = {};
  let pending = names.size;
  for (const n of names) {
    const img = new Image();
    img.onload = () => { imgs[n] = img; if (--pending === 0) draw(); };
    img.onerror = () => { imgs[n] = imgs.tile_grass; if (--pending === 0) draw(); };
    img.src = `assets/${n}.png`;
  }

  function draw() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const ter = terrainAt(x, y);
        let img;
        if (ter.tile === 'tile_water') {
          img = imgs.tile_grass;   // 水底下铺草地
          waterTiles.push({ x, y });
        } else if (ter.tile.startsWith('tile_')) {
          img = imgs[ter.tile] || imgs.tile_grass;
          if (ter.char === '.' && hash(x, y) < 12) img = imgs.tile_grass_dark;  // 平原点缀
        } else {
          img = hash(x, y) < 50 ? imgs.tile_grass_dark : imgs.tile_grass;
          treeTiles.push({ x, y });
        }
        gctx.drawImage(img, x * 32, y * 32);
        // 装饰物: 草地/草丛格 ~15% 密度, 每格最多 1 个
        if (ter.id === 'plain' || ter.id === 'bush') {
          const h = hash(x * 3 + 11, y * 7 + 5);
          if (h < 15) decoTiles.push({ x, y, name: DECO[(h * 7 + x + y * 3) % DECO.length] });
        }
      }
    }
    const gtex = new THREE.CanvasTexture(groundCanvas);
    gtex.magFilter = THREE.NearestFilter;
    gtex.minFilter = THREE.NearestFilter;
    gtex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS, ROWS),
      new THREE.MeshBasicMaterial({ map: gtex })
    );
    ground.position.set(COLS / 2, -ROWS / 2, 0);
    scene.add(ground);
    buildWater();
    buildTrees();
    buildDeco();
  }
}

// 真实地图模式: 底图 (非星标格+阴影) + 顶层 (星标格, 盖在单位上方)
function buildRealGround() {
  const gtex = new THREE.CanvasTexture(realMap.groundCanvas);
  gtex.magFilter = THREE.NearestFilter;
  gtex.minFilter = THREE.NearestFilter;
  gtex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS, ROWS),
    new THREE.MeshBasicMaterial({ map: gtex })
  );
  ground.position.set(COLS / 2, -ROWS / 2, 0);
  scene.add(ground);

  const ttex = new THREE.CanvasTexture(realMap.topCanvas);
  ttex.magFilter = THREE.NearestFilter;
  ttex.minFilter = THREE.NearestFilter;
  ttex.colorSpace = THREE.SRGBColorSpace;
  const topLayer = new THREE.Mesh(
    new THREE.PlaneGeometry(COLS, ROWS),
    new THREE.MeshBasicMaterial({ map: ttex, transparent: true })
  );
  topLayer.position.set(COLS / 2, -ROWS / 2, 0.6);   // 单位(0.5)之上
  scene.add(topLayer);
}

// ---------------------------------------------------------------- water (animated shader + 岸边泡沫)
const waterUniforms = { uTime: { value: 0 } };
const WATER_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const WATER_FRAG = `
  uniform float uTime;
  uniform vec4 uEdge;   // (左,右,上,下) 邻接陆地 = 1
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 4.0;
    float w1 = sin(p.x * 3.1 + uTime * 1.6) * 0.5 + 0.5;
    float w2 = sin(p.y * 4.3 - uTime * 1.1 + p.x) * 0.5 + 0.5;
    float m = w1 * 0.35 + w2 * 0.35;
    vec3 deep = vec3(0.10, 0.24, 0.52);
    vec3 lite = vec3(0.24, 0.50, 0.82);
    vec3 col = mix(deep, lite, m);
    float sparkle = step(0.965, sin(p.x * 12.0 + uTime * 2.0) * sin(p.y * 9.0 - uTime * 1.4));
    col += sparkle * 0.25;
    // 岸边泡沫: 邻接陆地的边缘描一圈亮色, 随时间呼吸
    float foam = 0.0;
    foam += uEdge.x * smoothstep(0.18, 0.03, vUv.x);
    foam += uEdge.y * smoothstep(0.18, 0.03, 1.0 - vUv.x);
    foam += uEdge.z * smoothstep(0.18, 0.03, 1.0 - vUv.y);
    foam += uEdge.w * smoothstep(0.18, 0.03, vUv.y);
    float wave = 0.55 + 0.45 * sin(uTime * 2.2 + (vUv.x + vUv.y) * 18.0);
    col = mix(col, vec3(0.86, 0.94, 1.0), clamp(foam, 0.0, 1.0) * wave * 0.75);
    gl_FragColor = vec4(col, 0.94);
  }`;

function buildWater() {
  if (!waterTiles.length) return;
  const isLand = (nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return 0;
    return terrainAt(nx, ny).tile === 'tile_water' ? 0 : 1;
  };
  for (const { x, y } of waterTiles) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: waterUniforms.uTime,
        uEdge: { value: new THREE.Vector4(isLand(x - 1, y), isLand(x + 1, y), isLand(x, y - 1), isLand(x, y + 1)) },
      },
      transparent: true,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.set(x + 0.5, -(y + 0.5), 0.05);
    scene.add(m);
  }
}

// ---------------------------------------------------------------- trees (billboards w/ sway + 落影)
const treeMeshes = [];
const treeShadowGeo = new THREE.CircleGeometry(0.42, 16);
treeShadowGeo.scale(1, 0.4, 1);
const treeShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });

function buildTrees() {
  // tree1/tree2: 64x96 源, 64px 格下 2x = 128x192px = 2.0x3.0 世界单位
  const w = 2.0, h = 3.0;
  for (const { x, y } of treeTiles) {
    const t = hash(x, y) < 50 ? loadTex('tree1') : loadTex('tree2');
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.1 })
    );
    // 树根对齐格子底边
    m.position.set(x + 0.5, -(y + 0.5) - 0.5 + h / 2, 0.4);
    m.userData.phase = hash(x, y) / 100 * Math.PI * 2;
    scene.add(m);
    treeMeshes.push(m);
    // 树下落影
    const sh = new THREE.Mesh(treeShadowGeo, treeShadowMat);
    sh.position.set(x + 0.5, -(y + 0.5) - 0.42, 0.06);
    scene.add(sh);
  }
}

// ---------------------------------------------------------------- decorations
// deco 原生尺寸 (px), 按 1x 绘制: 世界尺寸 = px / 64
const DECO_SIZE = {
  deco_flowers1: [44, 44], deco_flowers2: [44, 44], deco_bush: [45, 42],
  deco_shrooms: [55, 45], deco_log: [65, 30], deco_stump: [50, 45],
};

function buildDeco() {
  for (const { x, y, name } of decoTiles) {
    const [pw, ph] = DECO_SIZE[name] || [44, 44];
    const w = pw / 64, h = ph / 64;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: loadTex(name), transparent: true, alphaTest: 0.1 })
    );
    const jx = (hash(x + 31, y + 17) - 50) / 220;   // 确定性位置抖动
    // 底边对齐格子底边
    m.position.set(x + 0.5 + jx, -(y + 0.5) - 0.5 + h / 2, 0.3);
    scene.add(m);
  }
}

// ---------------------------------------------------------------- range overlays
const rangeGroup = new THREE.Group();
rangeGroup.position.z = 0.2;
scene.add(rangeGroup);

function makeRangeMesh(x, y, color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  m.position.set(x + 0.5, -(y + 0.5), 0);
  return m;
}

function showRange(moveSet, atkSet) {
  clearRange();
  for (const k of atkSet) {
    const [x, y] = k.split(',').map(Number);
    rangeGroup.add(makeRangeMesh(x, y, 0xe02828, 0.42));
  }
  for (const k of moveSet) {
    const [x, y] = k.split(',').map(Number);
    rangeGroup.add(makeRangeMesh(x, y, 0x3060d0, 0.38));
  }
}
function clearRange() {
  while (rangeGroup.children.length) {
    const c = rangeGroup.children.pop();
    c.geometry.dispose(); c.material.dispose();
  }
}

// ---------------------------------------------------------------- squads
const unitGroup = new THREE.Group();
unitGroup.position.z = 0.5;
scene.add(unitGroup);

// ---------------------------------------------------------------- game state
const state = {
  cursor: { x: 0, y: 0 },
  selected: null,      // squad being moved
  range: null,         // {move, atk}
  moving: false,       // path animation in progress
  battle: false,       // battle scene active
  ai: false,           // enemy phase running
  over: false,         // victory/defeat shown
  menuSquad: null,     // squad awaiting action choice
  menuItems: [],
  menuSel: 0,
  pending: null,       // {squad, ox, oy} 移动后待确认
  phase: 0,            // 0 player, 1 enemy
  turn: 1,
};

// 调试钩子: 供 CDP/手动测试读取内部状态 (只读引用, 不影响逻辑)
window.__tactics = { cam, state, squads: () => squads, realMap: () => realMap, nextChapter: () => nextChapterId };

function busy() {
  return state.moving || state.battle || state.ai || state.over || UI.locked();
}

function selectSquad(s) {
  state.selected = s;
  const move = computeMove(s, ctx);
  const atk = computeAttackTiles(move, s.rangeMax(), COLS, ROWS);
  state.range = { move, atk };
  showRange(new Set(move.keys()), atk);
  UI.updateSquadPanel(s);
}

function deselect() {
  state.selected = null;
  state.range = null;
  clearRange();
}

// ---------------------------------------------------------------- action menu
const actionMenu = $('action-menu');

// 在 (x,y) 上选一个射程内的敌部队: 最近优先, 并列取总 HP 最少
function pickTarget(squad, x, y) {
  const range = squad.rangeMax();
  return squads
    .filter(e => e.team !== squad.team && Math.abs(e.x - x) + Math.abs(e.y - y) <= range)
    .sort((a, b) =>
      (Math.abs(a.x - x) + Math.abs(a.y - y)) - (Math.abs(b.x - x) + Math.abs(b.y - y)) ||
      a.totalHp() - b.totalHp())[0] || null;
}

function openMenu(squad, tileX, tileY) {
  snapCamera();   // 停住相机, 菜单位置不再漂移
  state.menuSquad = squad;
  const target = pickTarget(squad, tileX, tileY);
  state.menuItems = [
    { label: target ? `攻击 ${target.name}` : '攻击', enabled: !!target, act: () => doAttack(squad, target) },
    { label: '待机', enabled: true, act: () => { state.pending = null; endAction(squad); } },
    { label: '取消', enabled: true, act: () => cancelMove() },
  ];
  state.menuSel = target ? 0 : 1;
  renderMenu(tileX, tileY);
}

function renderMenu(tileX, tileY) {
  actionMenu.innerHTML = '';
  state.menuItems.forEach((it, i) => {
    const div = document.createElement('div');
    div.className = 'item' + (i === state.menuSel ? ' sel' : '') + (it.enabled ? '' : ' disabled');
    div.textContent = it.label;
    actionMenu.appendChild(div);
  });
  const [, , tilePx] = tileToScreen(0, 0);
  let [mx] = tileToScreen(tileX + 1, tileY);
  let [, my] = tileToScreen(tileX, tileY);
  mx += 6;
  if (mx + 220 > STAGE_W) mx = tileToScreen(tileX, tileY)[0] - 220 - 6;
  if (my + 120 > STAGE_H) my = STAGE_H - 130;
  actionMenu.style.left = mx + 'px';
  actionMenu.style.top = my + 'px';
  actionMenu.style.display = 'block';
}

function hideMenu() {
  state.menuSquad = null;
  actionMenu.style.display = 'none';
}

function cancelMove() {
  const p = state.pending;
  hideMenu();
  state.pending = null;
  if (p) {
    p.squad.setPos(p.ox, p.oy);   // 回到原地并重新选中
    selectSquad(p.squad);
  }
}

// ---------------------------------------------------------------- combat flow
function battleTheme() {
  if (realMap) {
    // 按 tileset 主题选战斗背景 (没有雪原背景, 雪原沿用草原)
    const t = (realMap.tilesetName || '').toLowerCase();
    if (/lava|venom|dungeon|cave|depths/.test(t)) return 'dungeon';
    if (/castle|palace|temple|fort|church|indoor|town|ship/.test(t)) return 'fort';
    return 'grassland';
  }
  const s = (db.map.id + ' ' + db.map.name).toLowerCase();
  if (/fort|堡|城/.test(s)) return 'fort';
  if (/dungeon|洞|地牢/.test(s)) return 'dungeon';
  return 'plains';
}

async function playCombat(atkSquad, defSquad) {
  state.battle = true;
  const playback = resolveCombat(atkSquad, defSquad, ctx);
  await battleScene.play(playback, battleTheme());
  afterCombat(atkSquad);
  afterCombat(defSquad);
  state.battle = false;
  // 养成: 击杀科技点 (阵亡方为敌方才算) + 玩家成员 HP 写回实例 + 存档
  const kills = playback.events
    .filter(ev => ev.kind === 'strike')
    .reduce((n, ev) => {
      const targetTeam = ev.side === 'atk' ? 1 - playback.atkTeam : playback.atkTeam;
      return targetTeam === 1 ? n + ev.targets.filter(t => t.killed).length : n;
    }, 0);
  Army.addKills(kills);
  for (const s of [atkSquad, defSquad]) {
    if (s.team === 0) for (const m of s.members) Army.syncMemberHp(s.template.id, m.slot, m.hp);
  }
  Army.saveArmy();
  return checkEnd();
}

async function doAttack(squad, target) {
  hideMenu();
  state.pending = null;
  if (!target) { endAction(squad); return; }
  if (await playCombat(squad, target)) return;
  endAction(squad);
}

function afterCombat(s) {
  s.syncDeadVisuals();
  if (s.wiped) removeSquad(s);
}

function removeSquad(s) {
  unitGroup.remove(s.group);
  squads.splice(squads.indexOf(s), 1);
}

function endAction(squad) {
  squad.setDone(true);
  hideMenu();
  deselect();
  if (state.over) return;
  if (state.phase === 0 && squads.every(s => s.team !== 0 || s.done)) startEnemyPhase();
}

// ---------------------------------------------------------------- phases
function updateTurnPanel() {
  $('turn-num').textContent = state.turn;
  $('phase-name').textContent = state.phase === 0 ? '玩家阶段' : '敌方阶段';
}

function startEnemyPhase() {
  if (state.over) return;
  state.phase = 1;
  deselect();
  updateTurnPanel();
  UI.showPhaseBanner('敌方阶段', true, async () => {
    state.ai = true;
    await runEnemyAI();
    state.ai = false;
    if (state.over) return;
    state.turn++;
    state.phase = 0;
    squads.forEach(s => s.setDone(false));
    updateTurnPanel();
    UI.showPhaseBanner('玩家阶段', false);
  });
}

async function runEnemyAI() {
  for (const s of squads.filter(s => s.team === 1)) {
    if (state.over) return;
    if (!squads.includes(s)) continue;   // 已被消灭
    const plan = planAction(s, ctx);
    if (!plan) return;                   // 没有玩家部队了
    if (plan.dest.x !== s.x || plan.dest.y !== s.y) {
      const path = findPath(s, plan.dest.x, plan.dest.y, plan.move);
      state.moving = true;
      await animateMove(s, path);
      state.moving = false;
    }
    if (plan.target && squads.includes(plan.target)) {
      if (await playCombat(s, plan.target)) return;
    }
    s.setDone(true);
    await sleep(120);
  }
}

// TODO: objective seize / survive 暂未实现, 目前只识别 rout (SPEC「玩法规则」第 5 条)
function checkEnd() {
  if (state.over) return true;
  const players = squads.filter(s => s.team === 0).length;
  const enemies = squads.filter(s => s.team === 1).length;
  const obj = db.map.objective || { type: 'rout' };
  if (obj.type === 'rout' && enemies === 0) {
    state.over = true;
    Army.addVictory();   // 胜利 +5 科技点
    UI.showEnd(true, {
      onArmy: () => openArmy(true),
      nextLabel: nextChapterId ? '下一章 »' : '回选关',
      onNext: () => { location.href = nextChapterId ? `?map=${nextChapterId}` : location.pathname; },
    });
    return true;
  }
  if (players === 0) {
    state.over = true;
    UI.showEnd(false);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- movement
function startMove(squad, tx, ty) {
  const path = findPath(squad, tx, ty, state.range.move);
  const ox = squad.x, oy = squad.y;
  clearRange();
  state.selected = null;
  state.range = null;
  state.moving = true;
  animateMove(squad, path).then(() => {
    state.moving = false;
    state.pending = { squad, ox, oy };
    openMenu(squad, tx, ty);
  });
}

// path-follow movement animation (Promise), 行走帧按移动方向切换
// 用固定步数 setTimeout 驱动 (headless 虚拟时间下也能走完, 便于自动化验证)
function animateMove(squad, path) {
  return new Promise(resolve => {
    let i = 0;
    const STEPS = 7;   // ~112ms/格
    function step() {
      if (i >= path.length) {
        squad.setWalking(null);
        resolve();
        return;
      }
      const [tx, ty] = path[i];
      const from = { x: squad.group.position.x, y: squad.group.position.y };
      const to = { x: tx + 0.5, y: -(ty + 0.5) };
      const dx = to.x - from.x, dy = to.y - from.y;
      squad.setWalking(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIR.RIGHT : DIR.LEFT) : (dy > 0 ? DIR.UP : DIR.DOWN));
      let k = 0;
      function tick() {
        k++;
        const t = Math.min(1, k / STEPS);
        squad.group.position.x = from.x + (to.x - from.x) * t;
        squad.group.position.y = from.y + (to.y - from.y) * t;
        if (t < 1) setTimeout(tick, 16);
        else { squad.setPos(tx, ty); i++; step(); }
      }
      setTimeout(tick, 16);
    }
    step();
  });
}

// ---------------------------------------------------------------- input
const stage = $('stage');
const cursorEl = $('cursor');

function fitStage() {
  const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fitStage);
fitStage();

function eventToTile(e) {
  const r = stage.getBoundingClientRect();
  const s = r.width / STAGE_W;
  const px = (e.clientX - r.left) / s;
  const py = (e.clientY - r.top) / s;
  const tp = tilePx();
  const x = Math.floor(camLeft() + px / tp), y = Math.floor(camTop() + py / tp);
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return null;
  return { x, y };
}

// follow: true = 相机立即以光标为目标 (键盘/点击); false = 仅边缘推移 (鼠标悬停)
function updateCursor(x, y, follow = true) {
  state.cursor = { x, y };
  cursorEl.style.display = 'block';
  UI.updateTerrainPanel(terrainAt(x, y));
  if (follow) setCamTargetTile(x, y);
}

// 鼠标悬停不推移相机: 相机在鼠标下滑动会让用户瞄准的格子漂走, 点击落到别的格
// (曾在此导致视口边缘的部队点不中)。键盘移动始终跟随 (updateCursor follow=true),
// 点击某格也会让相机向该格靠拢, 鼠标平移需求已被覆盖。

// 光标 DOM 每帧跟随相机
function updateCursorDom() {
  const [sx, sy, tp] = tileToScreen(state.cursor.x, state.cursor.y);
  cursorEl.style.width = tp + 'px';
  cursorEl.style.height = tp + 'px';
  cursorEl.style.left = sx + 'px';
  cursorEl.style.top = sy + 'px';
}

stage.addEventListener('mousemove', e => {
  const t = eventToTile(e);
  if (!t || busy()) return;
  if (t.x === state.cursor.x && t.y === state.cursor.y) return;
  updateCursor(t.x, t.y, false);
  if (!state.menuSquad) UI.updateSquadPanel(squadAt(t.x, t.y));
});

// 滚轮缩放: 1x/2x/3x 整数倍, 鼠标锚点
stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (busy()) return;
  setZoom(cam.level + (e.deltaY < 0 ? 1 : -1), { x: e.clientX, y: e.clientY });
}, { passive: false });

stage.addEventListener('click', e => {
  const t = eventToTile(e);
  if (!t || busy()) return;

  // action menu open -> choose by click
  if (state.menuSquad) {
    const items = actionMenu.querySelectorAll('.item');
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        const it = state.menuItems[i];
        if (it.enabled) it.act();
        return;
      }
    }
    return;
  }

  if (state.phase !== 0) return;

  // 点击位置即光标位置: 先把光标同步到点击格, 保证所见即所选
  updateCursor(t.x, t.y);
  if (!state.menuSquad) UI.updateSquadPanel(squadAt(t.x, t.y) || state.selected);

  if (state.selected) {
    const key = `${t.x},${t.y}`;
    const u = squadAt(t.x, t.y);
    if (state.range.move.has(key) && !u) {
      startMove(state.selected, t.x, t.y);
      return;
    }
    deselect();
    if (u && u.team === 0 && !u.done) selectSquad(u);
    return;
  }

  const u = squadAt(t.x, t.y);
  if (u && u.team === 0 && !u.done) selectSquad(u);
  else if (u) UI.updateSquadPanel(u);
  else endPhaseHint();
});

function endPhaseHint() {
  // 双击同一空格结束玩家阶段 (FE 式便捷操作); 不同格/间隔超时都不算, 防误触
  const now = performance.now();
  const c = state.cursor;
  if (endPhaseHint.last && now - endPhaseHint.last.t < 450 &&
      endPhaseHint.last.x === c.x && endPhaseHint.last.y === c.y) {
    endPhaseHint.last = null;
    startEnemyPhase();
    return;
  }
  endPhaseHint.last = { t: now, x: c.x, y: c.y };
}

stage.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (busy()) return;
  if (state.menuSquad) cancelMove();
  else if (state.selected) deselect();
});

window.addEventListener('keydown', e => {
  // 选关/整备/详情覆盖层打开时不响应游戏按键; 剧情播放由 story.js capture 拦截
  if (Story.isPlaying() || Inspect.isOpen()) return;
  if ($('level-select').style.display === 'flex' || $('army-ui').style.display === 'flex') return;
  if (busy()) return;
  const c = state.cursor;

  // C/Tab: 查看光标下部队详情 (敌我均可)
  if (e.key === 'c' || e.key === 'C' || e.key === 'Tab') {
    e.preventDefault();
    if (!state.menuSquad) {
      const u = squadAt(c.x, c.y);
      if (u) Inspect.open(u, db);
    }
    return;
  }
  const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

  if (state.menuSquad) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const d = e.key === 'ArrowUp' ? -1 : 1;
      state.menuSel = (state.menuSel + d + state.menuItems.length) % state.menuItems.length;
      renderMenu(state.menuSquad.x, state.menuSquad.y);
    } else if (e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
      const it = state.menuItems[state.menuSel];
      if (it.enabled) it.act();
    } else if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
      cancelMove();
    }
    return;
  }

  if (state.phase !== 0) return;

  if (moves[e.key]) {
    const [dx, dy] = moves[e.key];
    const nx = Math.max(0, Math.min(COLS - 1, c.x + dx));
    const ny = Math.max(0, Math.min(ROWS - 1, c.y + dy));
    updateCursor(nx, ny);
    if (!state.selected) UI.updateSquadPanel(squadAt(nx, ny));
  } else if (e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
    if (state.selected) {
      const key = `${c.x},${c.y}`;
      if (state.range.move.has(key) && !squadAt(c.x, c.y)) {
        startMove(state.selected, c.x, c.y);
      }
    } else {
      const u = squadAt(c.x, c.y);
      if (u && u.team === 0 && !u.done) selectSquad(u);
    }
  } else if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
    if (state.selected) deselect();
  }
});

// ---------------------------------------------------------------- render loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.getElapsedTime();

  if (battleScene.active) {
    battleScene.update(dt);
    battleScene.render();
    return;
  }

  waterUniforms.uTime.value = t;
  updateCamera(dt);
  updateCursorDom();
  // 单位待机/行走帧动画
  for (const s of squads) s.updateAnim(t);
  // 树木摇摆
  for (const m of treeMeshes) {
    m.rotation.z = Math.sin(t * 0.9 + m.userData.phase) * 0.012;
  }
  // cursor pulse
  const p = 1 + Math.sin(t * 6) * 0.05;
  cursorEl.style.transform = `scale(${p})`;
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- debug script
// ?debug=script: 合成鼠标/键盘事件做端到端验证 (相机平移后的点击映射/移动落点/缩放锚点)
async function runScript() {
  const results = [];
  const assert = (cond, msg) => {
    results.push(`${cond ? 'OK' : 'FAIL'} ${msg}`);
    if (!cond) console.error('SCRIPT FAIL:', msg);
  };
  const waitFor = async (cond, ms = 6000) => {
    const t0 = performance.now();
    while (!cond()) {
      if (performance.now() - t0 > ms) return false;
      await sleep(50);
    }
    return true;
  };
  const tileClient = (tx, ty) => {
    const [sx, sy, tp] = tileToScreen(tx, ty);
    const r = stage.getBoundingClientRect();
    const s = r.width / STAGE_W;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  };
  const clickTile = (tx, ty) => {
    const c = tileClient(tx, ty);
    stage.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x, clientY: c.y, bubbles: true }));
    stage.dispatchEvent(new MouseEvent('click', { clientX: c.x, clientY: c.y, bubbles: true }));
  };
  const key = k => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const wheel = (clientX, clientY, deltaY) =>
    stage.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY, bubbles: true, cancelable: true }));

  await sleep(400);

  // 0a. zelos_guard 专项: 用 elementFromPoint 命中路径点击它的实际屏幕位置选中,
  //     再点范围内路径最远格, 断言落点 (rm004 出生点 (4,16) 曾有点不中的回归)
  const Z = squads.find(s => s.template.id === 'zelos_guard') || squads.find(s => s.team === 0);
  const zx = Z.x, zy = Z.y;
  {
    const c = tileClient(Z.x, Z.y);
    const hit = document.elementFromPoint(c.x, c.y) || stage;
    assert(hit === canvas, `zelos 屏幕位置命中 canvas (实际 ${hit.id || hit.tagName})`);
    // 事件派发到命中的最上层元素, 经冒泡到 stage — 与真实浏览器点击链一致
    hit.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x, clientY: c.y, bubbles: true }));
    hit.dispatchEvent(new MouseEvent('click', { clientX: c.x, clientY: c.y, bubbles: true }));
    assert(state.selected === Z, `点击选中 zelos_guard @${zx},${zy}`);
    let far = null, farLen = 0;
    for (const k of state.range.move.keys()) {
      const [x, y] = k.split(',').map(Number);
      const p = findPath(Z, x, y, state.range.move);
      if (p.length > farLen) { farLen = p.length; far = [x, y]; }
    }
    assert(!!far, `zelos 最远可达格 ${far} (路径 ${farLen})`);
    clickTile(far[0], far[1]);
    assert(await waitFor(() => state.menuSquad === Z), 'zelos 移动完成弹出菜单');
    assert(Z.x === far[0] && Z.y === far[1], `zelos 落点 ${far} (实际 ${Z.x},${Z.y})`);
    key('Escape');   // 取消 -> 回原地并重新选中
    assert(Z.x === zx && Z.y === zy && state.selected === Z, 'zelos 取消移动回到出生点');
    key('Escape');   // 再取消选中, 不影响后续用例
  }

  // 0b. 悬停不推相机: 鼠标移到视口边缘格, 相机目标必须保持不动
  //     (回归: 悬停推相机会让瞄准的格子在鼠标下滑走, 点击落到别的格)
  {
    const tx0 = cam.tx, ty0 = cam.ty;
    const ex = Math.min(COLS - 1, Math.floor(camLeft() + camVW()) - 1);   // 视口最右一格
    const c = tileClient(ex, state.cursor.y);
    stage.dispatchEvent(new MouseEvent('mousemove', { clientX: c.x, clientY: c.y, bubbles: true }));
    assert(cam.tx === tx0 && cam.ty === ty0, '悬停视口边缘格不推移相机');
  }

  const S = squads.find(s => s.team === 0);
  const ox = S.x, oy = S.y;

  // 1. 点击部队格 -> 选中
  clickTile(S.x, S.y);
  assert(state.selected === S, `点击选中部队 @${S.x},${S.y}`);
  assert(state.range && state.range.move.size > 1, '显示移动范围');

  // 2. 点击可达格 -> 路径移动 -> 落点正确
  const destKey = [...state.range.move.keys()]
    .map(k => k.split(',').map(Number))
    .filter(([x, y]) => Math.abs(x - ox) + Math.abs(y - oy) === 2)[0];
  assert(!!destKey, '找到距离2的可达格');
  clickTile(destKey[0], destKey[1]);
  assert(await waitFor(() => state.menuSquad === S), '移动完成弹出菜单');
  assert(S.x === destKey[0] && S.y === destKey[1], `落点 ${destKey} (实际 ${S.x},${S.y})`);

  // 3. Esc 取消 -> 回到原地并重新选中
  key('Escape');
  assert(S.x === ox && S.y === oy && state.selected === S, '取消移动回到原地');

  // 4. 多格行走 (路径 ≥5 格): 落点断言 + 行走途中帧采样不越界断言
  let longDest = null, longPath = null;
  for (const k of state.range.move.keys()) {
    const [x, y] = k.split(',').map(Number);
    const p = findPath(S, x, y, state.range.move);
    if (!longPath || p.length > longPath.length) { longPath = p; longDest = [x, y]; }
  }
  assert(longPath && longPath.length >= 5, `找到 ≥5 格的行走路径 (长度 ${longPath ? longPath.length : 0})`);
  const spriteInfo = SPRITE_MAP[S.spriteName];
  let walkSampleOk = true;
  clickTile(longDest[0], longDest[1]);
  while (state.moving) {
    // 行走途中采样: offset 必须恒落在该单位块 row0 的 96x32 条带内
    const py = (1 - S.anim.texture.offset.y) * 256 - 32;
    const px = S.anim.texture.offset.x * 384 - spriteInfo.bx * 96;
    if (py !== spriteInfo.by * 128 || px < 0 || px > 64) walkSampleOk = false;
    await sleep(30);
  }
  assert(await waitFor(() => state.menuSquad === S), '多格移动完成弹出菜单');
  assert(S.x === longDest[0] && S.y === longDest[1], `多格行走落点 ${longDest} (实际 ${S.x},${S.y})`);
  assert(Math.abs(S.group.position.x - (S.x + 0.5)) < 1e-6 && Math.abs(S.group.position.y + (S.y + 0.5)) < 1e-6,
    '移动结束后位置精确归位到格子中心');
  assert(walkSampleOk, '行走过程帧采样不越界 (恒在块 row0)');

  // 5. 全部单位 x 全部序列步的源矩形断言 (纯函数级)
  {
    let rectOk = true;
    for (const [name, info] of Object.entries(SPRITE_MAP)) {
      for (let i = 0; i < 4; i++) {
        const [px, py, w, h] = frameRect(name, i);
        if (px < info.bx * 96 || px + w > info.bx * 96 + 96 || py !== info.by * 128 || h !== 32) rectOk = false;
      }
    }
    assert(rectOk, '全部单位帧矩形恒在各自块 row0 内');
  }

  // 6. 待机 -> 行动完毕
  state.menuSel = state.menuItems.findIndex(i => i.label === '待机');
  key('Enter');
  assert(S.done && !state.menuSquad, '待机后部队变灰');

  // 5. 键盘平移相机后再点击另一支部队 (验证相机平移后的点击映射)
  const cxBefore = state.cursor.x;
  for (let i = 0; i < 10; i++) key('ArrowRight');
  assert(state.cursor.x === Math.min(COLS - 1, cxBefore + 10), `键盘光标右移 (${state.cursor.x},${state.cursor.y})`);
  snapCamera();   // headless 下 rAF 不走, 直接对齐 (真实浏览器由 lerp 完成)
  const S2 = squads.filter(s => s.team === 0)[2];
  clickTile(S2.x, S2.y);
  assert(state.selected === S2, `相机平移后点击选中第二支部队 @${S2.x},${S2.y}`);
  assert(state.cursor.x === S2.x && state.cursor.y === S2.y, '点击后光标=点击格');
  key('Escape');

  // 6. 缩放: 整数倍 + 锚点保持
  const r = stage.getBoundingClientRect();
  const s = r.width / STAGE_W;
  const anchorClient = { x: r.left + 480 * s, y: r.top + 270 * s };   // 舞台中心
  setCamTargetTile(Math.floor(COLS / 2), Math.floor(ROWS / 2)); snapCamera();   // 移到地图中央避免 clamp 干扰
  const fx0 = camLeft() + 480 / tilePx(), fy0 = camTop() + 270 / tilePx();
  wheel(anchorClient.x, anchorClient.y, -100);
  assert(cam.level === 3 && tilePx() === 96, '滚轮放大到 3x (96px/格)');
  const fx1 = camLeft() + 480 / tilePx(), fy1 = camTop() + 270 / tilePx();
  assert(Math.abs(fx1 - fx0) < 0.01 && Math.abs(fy1 - fy0) < 0.01, `3x 锚点保持 (${fx0.toFixed(2)},${fy0.toFixed(2)})->(${fx1.toFixed(2)},${fy1.toFixed(2)})`);
  wheel(anchorClient.x, anchorClient.y, 100);
  wheel(anchorClient.x, anchorClient.y, 100);
  assert(cam.level === 1 && tilePx() === 32, '滚轮缩小到 1x (32px/格)');
  wheel(anchorClient.x, anchorClient.y, 100);
  wheel(anchorClient.x, anchorClient.y, 100);
  assert(cam.level === 1, '缩放下限钳制在 1x');
  wheel(anchorClient.x, anchorClient.y, -100);
  assert(cam.level === 2, '回到 2x');

  const fails = results.filter(x => x.startsWith('FAIL')).length;
  const summary = `脚本验证: ${results.length - fails}/${results.length} 通过`;
  results.unshift(fails ? `*** ${summary} ***` : summary);
  console.log('[debug=script]\n' + results.join('\n'));
  document.title = fails ? 'SCRIPT FAIL' : 'SCRIPT OK';
  const el = $('script-result');
  el.style.display = 'block';
  el.textContent = results.join('  |  ');
  el.style.color = fails ? '#ff8a7a' : '#8fe07a';
}

// ---------------------------------------------------------------- boot
let nextChapterId = null;   // 胜利后「下一章」目标 (按 catalog order 的下一个有剧情章节)

async function computeNextChapter(bootId) {
  nextChapterId = null;
  try {
    const cat = await fetch('data/rm/catalog.json').then(r => r.json());
    const cur = cat.find(e => e.id === bootId);
    if (!cur) return;
    const nxt = cat
      .filter(e => e.order > cur.order && Story.hasStory(e.id))
      .sort((a, b) => a.order - b.order)[0];
    nextChapterId = nxt ? nxt.id : null;
  } catch { /* 无目录则没有下一章 */ }
}

async function boot(bootId, opts = {}) {
  stage.classList.add('booted');
  db = await loadData(bootId);
  // 战役养成: 载入/初始化军队存档, 进图满血, 应用科技加成
  Army.loadArmy(db);
  db.army = Army.army;
  Army.healAll();
  setTechBonuses(Army.techBonuses(db.techs));
  computeNextChapter(bootId);   // 后台算好, 胜利时用
  if (!db.map) {
    // 真实 VX Ace 地图模式 (?map=rmNNN, 数据在 data/rm/)
    realMap = await loadRealMap(parseInt(bootId.slice(2), 10));
    db.map = realMap.mapMeta;
    COLS = realMap.cols;
    ROWS = realMap.rows;
  } else {
    COLS = db.map.cols;
    ROWS = db.map.rows;
    MAP = db.map.terrain;
  }

  buildGround();

  squads = db.map.squads.map(p => new Squad(db.squadsById[p.ref], p, db));
  for (const s of squads) {
    s.updateHpBar();
    unitGroup.add(s.group);
  }

  const first = squads.find(s => s.team === 0);
  if (first) {
    cam.cx = cam.tx = first.x + 0.5;
    cam.cy = cam.ty = first.y + 0.5;
    clampCamTarget();
    cam.cx = cam.tx; cam.cy = cam.ty;
    updateCursor(first.x, first.y);
  } else {
    cam.cx = cam.tx = COLS / 2;
    cam.cy = cam.ty = ROWS / 2;
    updateCursor(Math.floor(COLS / 2), Math.floor(ROWS / 2));
  }
  updateTurnPanel();
  updateZoomLabel();

  animate();

  // ?debug=zoom1/zoom3: 初始缩放级别
  if (/^zoom[123]$/.test(DEBUG || '')) {
    setZoom(parseInt(DEBUG.slice(-1), 10), null);
    return;
  }

  // ?debug=script: 脚本化端到端操作验证 (结果写入 #script-result 与 console)
  if (DEBUG === 'script') {
    runScript();
    return;
  }

  // ?debug=select: 跳过开场, 自动选中第一支我方部队并显示范围, 便于截图验证
  // ?debug=clean: 跳过开场, 不叠加范围层, 便于对比地图渲染
  if (DEBUG === 'select' || DEBUG === 'clean') {
    if (first && DEBUG === 'select') selectSquad(first);
    return;
  }

  // ?debug=battle / ?debug=battlescene: 直接打一场全屏战斗, 便于截图验证
  // &freeze=N: 播放到第 N 个事件时冻结画面
  if (DEBUG === 'battle' || DEBUG === 'battlescene') {
    const foe = squads.find(s => s.team === 1);
    if (first && foe) {
      state.battle = true;
      const pb = resolveCombat(first, foe, ctx);
      const freeze = parseInt(params.get('freeze') || '', 10);
      battleScene.play(pb, battleTheme(), Number.isFinite(freeze) ? freeze : null);   // 不 await, 不结算, 仅供截图
    }
    return;
  }

  // ?debug=combatsettle: 完整打一场并结算 (经验/科技点/存档), 供养成 E2E
  if (DEBUG === 'combatsettle') {
    const foe = squads.find(s => s.team === 1);
    if (first && foe) {
      state.pending = null;
      await playCombat(first, foe);
      if (!state.over) endAction(first);
    }
    return;
  }

  // ?debug=army: 直接打开整备界面, 便于截图/验证
  if (DEBUG === 'army') {
    openArmy(false);
    return;
  }

  // ?debug=inspect / inspectfoe: 直接弹出第一支我方/敌方部队详情, 便于截图
  if (DEBUG === 'inspect' || DEBUG === 'inspectfoe') {
    const s = DEBUG === 'inspect' ? first : squads.find(sq => sq.team === 1);
    if (s) Inspect.open(s, db);
    return;
  }

  // 战前剧情 (有剧情文件的 rm 图; &nostory=1 跳过; debug 模式在上方已 return, 不受影响)
  if (!params.has('nostory')) await Story.playStory(bootId, opts.storyStart);

  await UI.showIntro(db.map);
  UI.showPhaseBanner('玩家阶段', false);
}
// 打开整备界面; fromVictory=true 时关闭后回选关
async function openArmy(fromVictory) {
  await openArmyUI(db, {
    onTechChange: () => setTechBonuses(Army.techBonuses(db.techs)),
    onClose: () => { if (fromVictory) location.href = location.pathname; },
  });
}

// ---------------------------------------------------------------- level select
// 不带 ?map= (且无 debug) 启动时显示: 搜索 + 按战役顺序的关卡列表, 点击直接 boot
async function showLevelSelect() {
  const overlay = $('level-select');
  const list = $('ls-list');
  const search = $('ls-search');
  overlay.style.display = 'flex';
  // 覆盖层事件不穿透到舞台 (未 boot 时键盘/鼠标 handler 仍在)
  for (const t of ['click', 'mousemove', 'wheel', 'contextmenu', 'keydown']) {
    overlay.addEventListener(t, e => e.stopPropagation());
  }

  let entries;
  try {
    const cat = await fetch('data/rm/catalog.json').then(r => r.json());
    entries = cat.slice().sort((a, b) => a.order - b.order);
  } catch (e) {
    list.textContent = `关卡目录加载失败: ${e.message}`;
    return;
  }
  entries.unshift({ id: 'ch1', name: '手绘演示地图', w: 0, h: 0, tileset: '手绘演示' });

  function render(filter) {
    const f = (filter || '').trim().toLowerCase();
    list.innerHTML = '';
    let shown = 0;
    for (const e of entries) {
      if (f && !e.name.toLowerCase().includes(f)) continue;
      shown++;
      const div = document.createElement('div');
      div.className = 'ls-item';
      const name = document.createElement('span');
      name.textContent = e.name;
      if (Story.hasStory(e.id)) {
        const tag = document.createElement('span');
        tag.className = 'ls-story';
        tag.textContent = '★剧情';
        name.prepend(tag);
      }
      const meta = document.createElement('span');
      meta.className = 'ls-meta';
      meta.textContent = e.w ? `${e.w}×${e.h} · ${e.tileset}` : e.tileset;
      div.append(name, meta);
      div.addEventListener('click', () => {
        overlay.style.display = 'none';
        boot(e.id).catch(bootFail);
      });
      list.appendChild(div);
    }
    if (!shown) list.textContent = '没有匹配的关卡';
  }
  search.addEventListener('input', () => render(search.value));
  search.addEventListener('keydown', e => e.stopPropagation());
  render('');

  // 整备入口: 未 boot 时先加载数据索引
  $('army-btn').onclick = async e => {
    e.stopPropagation();
    if (!db) db = await loadData('ch1');
    openArmy(false);
  };
  // 重置战役: 双击确认
  const resetBtn = $('reset-btn');
  resetBtn.onclick = e => {
    e.stopPropagation();
    if (resetBtn.dataset.armed) {
      Army.resetArmy();
      resetBtn.textContent = '已重置';
      delete resetBtn.dataset.armed;
    } else {
      resetBtn.dataset.armed = '1';
      resetBtn.textContent = '确认重置?';
      setTimeout(() => { delete resetBtn.dataset.armed; resetBtn.textContent = '重置战役'; }, 2500);
    }
  };
}

function bootFail(err) {
  console.error('boot failed:', err);
  const hint = $('hint');
  hint.textContent = `加载失败: ${err.message}`;
  hint.style.color = '#ff8a7a';
}

// 游戏内"选关"按钮: 回到无参数地址即选关界面 (刷新即干净的状态重置)
$('level-btn').addEventListener('click', e => {
  e.stopPropagation();
  location.href = location.pathname;
});

// 带 ?map= 或 ?debug= 直链直接进图; 否则先进选关界面
// ?debug=story=rmNNN: 进图并直接从第 3 行播剧情 (截图钩子); storyend= 从最后一行
if (DEBUG && /^story(end)?=rm\d+$/.test(DEBUG)) {
  const id = DEBUG.split('=')[1];
  boot(id, { storyStart: DEBUG.startsWith('storyend') ? 'end' : 2 }).catch(bootFail);
} else if (params.has('map') || DEBUG) {
  boot(mapId).catch(bootFail);
} else {
  showLevelSelect();
}
