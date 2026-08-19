// realmap.js — 真实 VX Ace 地图渲染 (?map=rm004)
// 移植自 D:/dev/k3/zq/vxace_render.py (规则见 VXACE_ASSETS.md, 与 mkxp-z 一致):
//   9 表图集(1024x2048) + autotile 48 模式 16px 子块展开 + 阴影层 + 星标分层合成。
// 通行规则同 VX Ace checkPassage: 自上而下(z2→z1→z0)跳过空/星标(0x10), 首个决定格
//   flag & 0x0f == 0x0f 则不可通行 (桥盖水面因此可通行)。
import { RECTS_A, RECTS_B, RECTS_C } from './autotiles.js';

const TS = 32;
const SUBPOS = [[0, 0], [16, 0], [0, 16], [16, 16]];   // TL TR BL BR
const FREE = [8, 48];
// A1 autotileID -> 图集原点(格); null = 瀑布
const A1_ORIG = [
  [0, 0], [0, 3], [FREE[0], FREE[1]], [FREE[0], FREE[1] + 3],
  [6, 0], null, [6, 3], null, [0, 6], null, [0, 9], null, [6, 6], null, [6, 9], null,
];
const AE_PARTS = [[12, 0], [12, 3], [14, 0], [14, 3], [12, 6], [12, 9]];   // 瀑布
const A4_OFFY = [0, 3, 5, 8, 10, 13];
const SHEET_KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];

const IMPASSABLE = { id: 'blocked', name: '不可进入', avo: 0, def: 0, cost: 99, pass: false, tile: '' };
const BUSH = { id: 'bush', name: '草丛', avo: 5, def: 0, cost: 1, pass: true, tile: '' };
const PLAIN = { id: 'plain', name: '平原', avo: 0, def: 0, cost: 1, pass: true, tile: '' };

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`load failed: ${src}`));
    im.src = src;
  });
}

// 图集合成 (tileatlasvx.cpp build()): 1024x2048 px = 32x64 格
function buildAtlas(sheets) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 2048;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const blit = (key, sx, sy, w, h, dx, dy) => {
    const im = sheets[key];
    if (!im) return;
    g.drawImage(im, sx * TS, sy * TS, w * TS, h * TS, dx * TS, dy * TS, w * TS, h * TS);
  };
  blit('A1', 0, 0, 6, 12, 0, 0);
  blit('A1', 8, 0, 6, 12, 6, 0);
  blit('A1', 6, 0, 2, 6, FREE[0], FREE[1]);
  blit('A1', 14, 0, 2, 6, 12, 0);
  blit('A1', 6, 6, 2, 6, 14, 0);
  blit('A1', 14, 6, 2, 6, 12, 6);
  blit('A2', 0, 0, 16, 12, 0, 13);
  blit('A3', 0, 0, 16, 8, 0, 25);
  blit('A4', 0, 0, 16, 15, 0, 33);
  blit('A5', 0, 0, 8, 16, 0, 48);
  blit('B', 0, 0, 16, 16, 16, 0);
  blit('C', 0, 0, 16, 16, 16, 16);
  blit('D', 0, 0, 16, 16, 16, 32);
  blit('E', 0, 0, 16, 16, 16, 48);
  return cv;
}

function drawAutotile(g, atlas, rects, pattern, orig, x, y) {
  for (let i = 0; i < 4; i++) {
    const [rx, ry, rw, rh] = rects[pattern * 4 + i];
    g.drawImage(atlas,
      orig[0] * TS + rx, orig[1] * TS + ry, rw, rh,
      x * TS + SUBPOS[i][0], y * TS + SUBPOS[i][1], rw, rh);
  }
}

function drawTile(g, atlas, tileId, x, y) {
  if (tileId <= 0) return;
  if (tileId < 0x400) {   // B..E
    const ob = (tileId / 128) | 0;
    const ox = tileId % 8 + (ob % 2) * 8;
    const oy = ((tileId / 8) | 0) % 16 + ((ob / 2) | 0) * 16;
    g.drawImage(atlas, (16 + ox) * TS, oy * TS, TS, TS, x * TS, y * TS, TS, TS);
    return;
  }
  if (tileId < 0x600) return;
  if (tileId < 0x680) {   // A5
    const t = tileId - 0x600;
    g.drawImage(atlas, (t % 8) * TS, (48 + ((t / 8) | 0)) * TS, TS, TS, x * TS, y * TS, TS, TS);
    return;
  }
  if (tileId < 0x800) return;
  if (tileId < 0xB00) {   // A1 (水面/瀑布; 动画取第 0 帧)
    const t = tileId - 0x800;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    const orig = A1_ORIG[atId];
    if (!orig) {   // 瀑布: 4 模式 x 2 竖条
      const o = AE_PARTS[((atId - 5) / 2) | 0];
      if (pattern > 3) return;
      for (let i = 0; i < 2; i++) {
        const [rx, ry, rw, rh] = RECTS_C[pattern * 2 + i];
        g.drawImage(atlas, o[0] * TS + rx, o[1] * TS + ry, rw, rh, x * TS + i * 16, y * TS, rw, rh);
      }
      return;
    }
    drawAutotile(g, atlas, RECTS_A, pattern, orig, x, y);
    return;
  }
  if (tileId < 0x1100) {  // A2 地面 autotile
    const t = tileId - 0xB00;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    drawAutotile(g, atlas, RECTS_A, pattern, [(atId % 8) * 2, 13 + ((atId / 8) | 0) * 3], x, y);
    return;
  }
  if (tileId < 0x1700) {  // A3 屋顶 (B 型展开)
    const t = tileId - 0x1100;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    if (pattern >= 0x10) return;
    drawAutotile(g, atlas, RECTS_B, pattern, [(atId % 8) * 2, 25 + ((atId / 8) | 0) * 2], x, y);
    return;
  }
  if (tileId < 0x2000) {  // A4 墙壁: 偶数行组 A 型, 奇数 B 型
    const t = tileId - 0x1700;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    const offI = (atId / 8) | 0;
    const orig = [(atId % 8) * 2, 33 + A4_OFFY[offI]];
    if (offI % 2 === 0) drawAutotile(g, atlas, RECTS_A, pattern, orig, x, y);
    else if (pattern < 0x10) drawAutotile(g, atlas, RECTS_B, pattern, orig, x, y);
  }
}

// ---- 缓存: Tilesets/catalog 只取一次, 图集按 tileset_id, 地图按 num ----
let tilesetsP = null, catalogP = null;
const atlasCache = {};   // tileset_id -> 图集 canvas
const mapCache = {};     // num -> Promise<realMap>

export function loadRealMap(num) {
  if (!mapCache[num]) mapCache[num] = buildRealMap(num);
  return mapCache[num];
}

// 自动摆位: 最大连通可通行域内, 玩家 3 支放南部开阔处, 敌方 3-5 支放北部开阔处,
// 同队间隔 ≥2 格, 敌我默认隔 ≥8 (区域小时逐步放宽/减员, 优雅降级)
function autoPlacement(terrainAt, W, H) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const pass = (x, y) => x >= 0 && y >= 0 && x < W && y < H && terrainAt(x, y).pass;

  // 连通域标记 (BFS)
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!pass(x, y) || comp[x + y * W] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      const q = [[x, y]];
      comp[x + y * W] = id;
      while (q.length) {
        const [cx, cy] = q.pop();
        size++;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (pass(nx, ny) && comp[nx + ny * W] < 0) { comp[nx + ny * W] = id; q.push([nx, ny]); }
        }
      }
      sizes.push(size);
    }
  }
  if (!sizes.length) return [];
  const big = sizes.indexOf(Math.max(...sizes));

  const region = [];
  let minY = H, maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (comp[x + y * W] === big) {
        region.push({ x, y });
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // 开阔度: 5x5 邻域内可通行格数
  const open = (x, y) => {
    let c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (pass(x + dx, y + dy)) c++;
    return c;
  };

  const span = Math.max(4, Math.round((maxY - minY) * 0.25));
  let south = region.filter(c => c.y >= maxY - span);
  let north = region.filter(c => c.y <= minY + span);
  if (!south.length) south = region;
  if (!north.length) north = region;
  // 开阔优先, 南区靠南/北区靠北, 坐标兜底 — 排序确定性 (测试可复现)
  south.sort((a, b) => open(b.x, b.y) - open(a.x, a.y) || b.y - a.y || a.x - b.x);
  north.sort((a, b) => open(b.x, b.y) - open(a.x, a.y) || a.y - b.y || a.x - b.x);

  const taken = [];
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const pickFrom = (cands, n, minGap) => {
    const out = [];
    for (const c of cands) {
      if (out.length >= n) break;
      if (taken.every(t => dist(t, c) >= minGap) && out.every(t => dist(t, c) >= 2)) {
        out.push(c); taken.push(c);
      }
    }
    return out;
  };

  const regionSize = sizes[big];
  const nPlayers = regionSize >= 24 ? 3 : regionSize >= 12 ? 2 : 1;
  const nEnemies = regionSize >= 250 ? 5 : regionSize >= 120 ? 4 : regionSize >= 40 ? 3 : regionSize >= 16 ? 2 : 1;

  const PLAYER_REFS = ['zelos_guard', 'diana_squad', 'knight_wall'];
  const ENEMY_REFS = ['risen_pack', 'risen_elite', 'dragon_solo'];
  const squads = [];
  pickFrom(south, nPlayers, 2)
    .forEach((c, i) => squads.push({ ref: PLAYER_REFS[i], x: c.x, y: c.y, team: 0 }));
  // 敌我间距不足则放宽; 至少保证 1 支敌军
  let es = [];
  for (const gap of [8, 5, 3, 2]) {
    es = pickFrom(north, nEnemies, gap);
    if (es.length >= Math.min(nEnemies, 2)) break;
  }
  if (!es.length) es = pickFrom(north, 1, 2);
  es.forEach((c, i) => squads.push({ ref: ENEMY_REFS[i % ENEMY_REFS.length], x: c.x, y: c.y, team: 1 }));
  return squads;
}

async function buildRealMap(num) {
  const id3 = String(num).padStart(3, '0');
  tilesetsP = tilesetsP || fetch('data/Tilesets.json').then(r => r.json());
  catalogP = catalogP || fetch('data/rm/catalog.json').then(r => r.json());
  const [m, tilesets, catalog] = await Promise.all([
    fetch(`data/rm/rm${id3}.json`).then(r => {
      if (!r.ok) throw new Error(`data/rm/rm${id3}.json: HTTP ${r.status}`);
      return r.json();
    }),
    tilesetsP, catalogP,
  ]);
  const ts = tilesets[m.tileset_id];

  let atlas = atlasCache[m.tileset_id];
  if (!atlas) {
    const sheets = {};
    await Promise.all(ts.tileset_names.map((n, i) =>
      n ? loadImage(`assets/tilesets/${n}.png`).then(im => { sheets[SHEET_KEYS[i]] = im; }).catch(() => {}) : null
    ));
    atlas = buildAtlas(sheets);
    atlasCache[m.tileset_id] = atlas;
  }

  const W = m.width, H = m.height;
  const data = m.data.data;   // 扁平: x + y*W + z*W*H
  const at = (x, y, z) => data[x + y * W + z * W * H];

  // 底图/顶层 split 与 mkxp tileatlasvx.cpp 一致: 由 tile 的 ☆ 星标 flag(0x10) 决定,
  // 不是按层 — 任何层的星标格画在单位上方(树梢), 非星标格一律在单位脚下(桥甲板!)
  const flags = ts.flags.data || ts.flags;
  const isStar = t => t > 0 && (flags[t] & 0x10);

  // 底图: z0 + z1 + 阴影层(z3) + 非星标 z2; 顶层: 星标格 (盖在单位上方)
  const ground = document.createElement('canvas');
  ground.width = W * TS; ground.height = H * TS;
  const gg = ground.getContext('2d');
  gg.imageSmoothingEnabled = false;
  const top = document.createElement('canvas');
  top.width = W * TS; top.height = H * TS;
  const tg = top.getContext('2d');
  tg.imageSmoothingEnabled = false;

  for (const z of [0, 1]) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = at(x, y, z);
        drawTile(isStar(t) ? tg : gg, atlas, t, x, y);
      }
    }
  }
  // 阴影层 z3: 4bit 象限各盖 16x16 半透明黑
  gg.fillStyle = 'rgba(0,0,0,0.5)';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = at(x, y, 3) & 0xF;
      if (!v) continue;
      for (let i = 0; i < 4; i++) {
        if (v & (1 << i)) gg.fillRect(x * TS + SUBPOS[i][0], y * TS + SUBPOS[i][1], 16, 16);
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = at(x, y, 2);
      drawTile(isStar(t) ? tg : gg, atlas, t, x, y);
    }
  }

  // ---- 通行/地形 (VX Ace checkPassage: 自上而下首个非星标格决定) ----
  function decideFlag(x, y) {
    for (const z of [2, 1, 0]) {
      const t = at(x, y, z);
      if (t && !(flags[t] & 0x10)) return flags[t];
    }
    return 0;
  }
  function terrainAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return IMPASSABLE;
    const f = decideFlag(x, y);
    if ((f & 0x0f) === 0x0f) return IMPASSABLE;
    if (f & 0x20) return BUSH;
    return PLAIN;
  }

  // rm004 保留手调摆位/intro (有专门的 E2E 测试依赖其精确出生点); 其余图自动摆位
  const entry = (catalog.find(e => e.num === num)) || {};
  const RM004_SQUADS = [
    { ref: 'zelos_guard', x: 4,  y: 16, team: 0 },
    { ref: 'diana_squad', x: 3,  y: 14, team: 0 },
    { ref: 'knight_wall', x: 6,  y: 17, team: 0 },
    { ref: 'risen_pack',  x: 9,  y: 2,  team: 1 },
    { ref: 'risen_pack',  x: 12, y: 1,  team: 1 },
    { ref: 'risen_elite', x: 13, y: 4,  team: 1 },
    { ref: 'dragon_solo', x: 8,  y: 3,  team: 1 },
  ];
  const mapMeta = {
    id: `rm${id3}`,
    name: entry.name || `Map ${num}`,
    cols: W, rows: H,
    squads: num === 4 ? RM004_SQUADS : autoPlacement(terrainAt, W, H),
    objective: { type: 'rout' },
    intro: num === 4
      ? '复生军越过了边境河, 出现在草原世界图的北方。泽洛斯率领亲卫队迎战, 必须全歼来敌!'
      : '复生军盘踞于此。全歼来敌!',
  };

  return { groundCanvas: ground, topCanvas: top, cols: W, rows: H, terrainAt, mapMeta, tilesetName: ts.name || entry.tileset || '' };
}
