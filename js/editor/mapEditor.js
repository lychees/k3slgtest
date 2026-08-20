// 关卡编辑器: 手绘字符地图 + 真实 VX Ace tileset 两种模式
// 真实模式: 用 assets/tilesets 正版素材画地图, autotile 按 blob-47 规则刷写 (见 vxauto.js),
//   存为 data/maps/<id>.json 的 vxace 扩展格式 (见 SPEC.md "vxace 关卡格式")。
// 图集合成/autotile 展开与 js/game/realmap.js 同一布局 (tileatlasvx.cpp)。
import {
  h, DB, MAP_IDS, unitById, squadById,
  loadJSON, saveJSON, downloadJSON, toast,
} from './common.js';
import { RECTS_A, RECTS_B, RECTS_C } from '../game/autotiles.js';
import { autoInfo, autoBase, paintAuto, eraseAuto, WF_BLOCKS } from './vxauto.js';

const CELL = 32;
const OBJ_TYPES = ['rout', 'seize', 'survive'];

// ---- VX Ace 图集 (拷贝自 js/game/realmap.js 的布局; 1024x2048 px = 32x64 格) ----
const TS = 32;
const SUBPOS = [[0, 0], [16, 0], [0, 16], [16, 16]];   // TL TR BL BR
const FREE = [8, 48];
const A1_ORIG = [
  [0, 0], [0, 3], [FREE[0], FREE[1]], [FREE[0], FREE[1] + 3],
  [6, 0], null, [6, 3], null, [0, 6], null, [0, 9], null, [6, 6], null, [6, 9], null,
];
const AE_PARTS = [[12, 0], [12, 3], [14, 0], [14, 3], [12, 6], [12, 9]];   // 瀑布
const A4_OFFY = [0, 3, 5, 8, 10, 13];
const SHEET_KEYS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'];

function buildAtlas(sheets) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 2048;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const blit = (key, sx, sy, w, hh, dx, dy) => {
    const im = sheets[key];
    if (!im || !im.complete || !im.naturalWidth) return;
    g.drawImage(im, sx * TS, sy * TS, w * TS, hh * TS, dx * TS, dy * TS, w * TS, hh * TS);
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

// 把 tileID 画到 (x, y) 格 (与 realmap.js drawTile 相同规则; 动画取第 0 帧)
function drawTilePx(g, atlas, tileId, x, y) {
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
  if (tileId < 0xB00) {   // A1 (水面/瀑布)
    const t = tileId - 0x800;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    const orig = A1_ORIG[atId];
    if (!orig) {
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
  if (tileId < 0x1700) {  // A3 屋顶
    const t = tileId - 0x1100;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    if (pattern >= 0x10) return;
    drawAutotile(g, atlas, RECTS_B, pattern, [(atId % 8) * 2, 25 + ((atId / 8) | 0) * 2], x, y);
    return;
  }
  if (tileId < 0x2000) {  // A4 墙壁
    const t = tileId - 0x1700;
    const pattern = t % 0x30, atId = (t / 0x30) | 0;
    const offI = (atId / 8) | 0;
    const orig = [(atId % 8) * 2, 33 + A4_OFFY[offI]];
    if (offI % 2 === 0) drawAutotile(g, atlas, RECTS_A, pattern, orig, x, y);
    else if (pattern < 0x10) drawAutotile(g, atlas, RECTS_B, pattern, orig, x, y);
  }
}

// ---- 调色板用的 sheet 格原点 ----
// A1 水面块 (非瀑布): block -> sheet 格原点
const A1_WATER = [[0, [0, 0]], [1, [0, 3]], [4, [8, 0]], [6, [8, 3]],
  [8, [0, 6]], [10, [0, 9]], [12, [8, 6]], [14, [8, 9]]];
// A1 瀑布块: block -> sheet 格原点
const A1_FALL = [[5, [14, 0]], [7, [14, 3]], [9, [6, 6]], [11, [6, 9]],
  [13, [14, 6]], [15, [14, 9]]];
const PAL_TABS = [['A2', '地面 A2'], ['A1', '水面 A1'], ['A5', 'A5 单格'],
  ['B', 'B 装饰'], ['C', 'C 装饰'], ['D', 'D 装饰'], ['E', 'E 装饰']];

// A5/B-E 单格 tileID: sheet 格 (gx, gy)
function singleTileId(sheet, gx, gy) {
  if (sheet === 'A5') return 0x600 + gy * 8 + gx;
  const s = { B: 0, C: 1, D: 2, E: 3 }[sheet];
  return s * 0x100 + (gx >= 8 ? 128 : 0) + gy * 8 + (gx % 8);
}

export function initMapEditor(root) {
  let map = null;          // 当前地图(工作副本)
  let grid = [];           // 手绘模式: grid[y][x] = terrain char
  let mode = 'terrain';    // terrain | squad | seize
  let mapKind = 'hand';    // hand | real
  let selTerrain = '.';    // 手绘调色板选中的地形 char
  let brush = null;        // 真实模式刷子: {kind:'auto',table,block,label} | {kind:'tile',id,label}
  let selSquadRef = '';
  let selTeam = 0;
  let selSquadIdx = -1;
  let painting = false;
  let dragging = false;
  const imgCache = {};     // 手绘 tile name -> Image

  // 真实模式资源
  let tilesets = null;     // Tilesets.json
  let tilesetIdx = -1;     // 当前 tileset 下标
  let sheetImgs = {};      // sheet key -> Image
  let atlas = null;        // 当前 tileset 的图集 canvas

  // ---------- 左侧控制面板 ----------
  const mapSel = h('select', {}, MAP_IDS.map(id => h('option', { value: id }, id)));
  mapSel.addEventListener('change', () => loadMap(mapSel.value));

  const loadIdInp = h('input', { type: 'text', placeholder: '按 id 载入', style: 'width:70px' });
  const btnLoadId = h('button', { class: 'btn', onclick: () => loadIdInp.value.trim() && loadMap(loadIdInp.value.trim()) }, '载入');

  const kindBtns = {};
  const kindBar = h('div', { style: 'display:flex;gap:4px' },
    [['hand', '手绘模式'], ['real', '真实 tileset']].map(([k, label]) => {
      const b = h('button', { class: 'btn mode-btn', style: 'flex:1;text-align:center', onclick: () => setMapKind(k) }, label);
      kindBtns[k] = b;
      return b;
    }));

  const newIdInp = h('input', { type: 'text', placeholder: '新地图 id', style: 'width:100%' });
  const colsInp = h('input', { type: 'number', value: 20, style: 'width:60px' });
  const rowsInp = h('input', { type: 'number', value: 11, style: 'width:60px' });
  const btnCreate = h('button', { class: 'btn', onclick: createMap }, '新建');
  const tilesetSel = h('select', { style: 'width:100%' });
  const tilesetRow = h('div', { style: 'display:flex;gap:4px;align-items:center;font-size:12px' },
    h('span', { class: 'fe-dim' }, 'tileset'), tilesetSel);
  tilesetRow.style.display = 'none';

  const modeBtns = {};
  const modeBar = h('div', { class: 'col', style: 'gap:4px' },
    [['terrain', '绘制模式'], ['squad', '部队模式'], ['seize', '目标点模式']].map(([m, label]) => {
      const b = h('button', { class: 'btn mode-btn', onclick: () => setMode(m) }, label);
      modeBtns[m] = b;
      return b;
    }));

  // 手绘地形调色板
  const terrainPal = h('div', { class: 'terrain-pal' });
  for (const t of DB.terrains.terrains) {
    const row = h('div', { class: 'trow' + (t.char === '.' ? ' sel' : ''), 'data-char': t.char },
      tileImg(t.tile), h('span', {}, `${t.name} (${t.char})`));
    row.addEventListener('click', () => {
      selTerrain = t.char;
      terrainPal.querySelectorAll('.trow').forEach(r => r.classList.toggle('sel', r.dataset.char === t.char));
      setMode('terrain');
    });
    terrainPal.append(row);
  }

  // 真实 tileset 调色板
  const palTabs = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px' });
  const palGrid = h('div', { style: 'display:flex;flex-wrap:wrap;gap:2px;align-content:flex-start' });
  const palInfo = h('div', { class: 'fe-dim', style: 'font-size:11px;margin-top:4px;min-height:14px' }, '');
  const tilePalWrap = h('div', {}, palTabs, palGrid, palInfo);
  tilePalWrap.style.display = 'none';

  const palPanelTitle = h('h3', {}, '地形调色板');
  const palPanel = h('div', { class: 'panel fe-panel col', style: 'flex:1;min-height:0' },
    palPanelTitle, terrainPal, tilePalWrap);

  const squadSel = h('select', { style: 'width:100%' },
    DB.squads.squads.map(s => h('option', { value: s.id }, `${s.name} (${s.id})`)));
  selSquadRef = DB.squads.squads[0]?.id || '';
  squadSel.addEventListener('change', () => { selSquadRef = squadSel.value; setMode('squad'); });

  const teamSel = h('select', { style: 'width:100%' },
    h('option', { value: '0' }, '队伍 0 — 玩家(蓝)'),
    h('option', { value: '1' }, '队伍 1 — 敌人(红)'));
  teamSel.addEventListener('change', () => selTeam = parseInt(teamSel.value, 10));

  const btnDelSquad = h('button', { class: 'btn danger', onclick: deleteSelectedSquad }, '删除选中部队');

  // ---------- 顶部属性面板 ----------
  const nameInp = h('input', { type: 'text', style: 'width:200px' });
  nameInp.addEventListener('change', () => { if (map) map.name = nameInp.value; });

  const objSel = h('select', {}, OBJ_TYPES.map(o => h('option', { value: o },
    o === 'rout' ? 'rout (全歼)' : o === 'seize' ? 'seize (占领目标点)' : 'survive (坚守回合)')));
  const turnsInp = h('input', { type: 'number', value: 8, style: 'width:60px', title: '坚守回合数' });
  objSel.addEventListener('change', () => {
    if (!map) return;
    map.objective = { type: objSel.value };
    if (objSel.value === 'survive') map.objective.turns = parseInt(turnsInp.value || '8', 10) || 8;
    updateObjUI();
  });
  turnsInp.addEventListener('change', () => {
    if (map && map.objective.type === 'survive') map.objective.turns = parseInt(turnsInp.value || '8', 10) || 8;
  });
  function updateObjUI() { turnsInp.style.display = objSel.value === 'survive' ? '' : 'none'; }

  const introTa = h('textarea', { style: 'min-height:36px' });
  introTa.addEventListener('change', () => { if (map) map.intro = introTa.value; });

  const btnSave = h('button', { class: 'btn gold', onclick: saveMap }, '保存到服务器');
  const btnDl = h('button', { class: 'btn', onclick: () => map && downloadJSON(`${map.id}.json`, serialize()) }, '下载 JSON');

  const infoLine = h('span', { class: 'fe-dim', style: 'font-size:12px' }, '');

  // ---------- 画布 ----------
  const canvas = h('canvas', { id: 'map-canvas' });
  const ctx = canvas.getContext('2d');

  root.append(
    h('div', { class: 'col', style: 'width:230px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:none;max-height:46%;overflow:auto' },
        h('h3', {}, '地图'),
        h('div', { style: 'display:flex;gap:4px' }, mapSel),
        h('div', { style: 'display:flex;gap:4px' }, loadIdInp, btnLoadId),
        kindBar,
        h('div', { style: 'display:flex;gap:4px;align-items:center' }, newIdInp),
        h('div', { style: 'display:flex;gap:4px;align-items:center;font-size:12px' },
          h('span', { class: 'fe-dim' }, '宽'), colsInp, h('span', { class: 'fe-dim' }, '高'), rowsInp, btnCreate),
        tilesetRow),
      h('div', { class: 'panel fe-panel col', style: 'flex:none' },
        h('h3', {}, '模式'), modeBar),
      palPanel,
      h('div', { class: 'panel fe-panel col', style: 'flex:none' },
        h('h3', {}, '部队放置'), squadSel, teamSel, btnDelSquad)),
    h('div', { class: 'col', style: 'flex:1' },
      h('div', { class: 'panel fe-panel', style: 'flex:none' },
        h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px' },
          h('span', { class: 'fe-dim' }, '名称'), nameInp,
          h('span', { class: 'fe-dim' }, '目标'), objSel, turnsInp,
          btnSave, btnDl, infoLine),
        h('div', { style: 'display:flex;gap:10px;align-items:flex-start;margin-top:6px;font-size:13px' },
          h('span', { class: 'fe-dim' }, '开场白'), introTa)),
      h('div', { id: 'map-canvas-wrap' }, canvas)),
  );

  // ---------- 手绘模式图像 ----------
  function tileImg(name) {
    return h('img', { src: `assets/${name}.png`, alt: name });
  }
  function getImg(name) {
    if (!imgCache[name]) {
      const im = new Image();
      im.onload = () => draw();
      im.src = `assets/${name}.png`;
      imgCache[name] = im;
    }
    return imgCache[name];
  }
  function terrainByChar(ch) { return DB.terrains.terrains.find(t => t.char === ch); }

  // ---------- 真实模式: tileset 资源 ----------
  async function ensureTilesets() {
    if (!tilesets) tilesets = await loadJSON('data/Tilesets.json');
    if (!tilesetSel.options.length) {
      tilesets.forEach((t, i) => {
        if (t && t.name) tilesetSel.append(h('option', { value: i }, `${i}: ${t.name}`));
      });
      tilesetSel.value = tilesetSel.options[0]?.value || '1';
    }
    return tilesets;
  }

  // 加载某 tileset 的 9 张表, 全部就绪(或失败)后合成图集并重画
  function setupTileset(idx) {
    if (idx === tilesetIdx) return;
    tilesetIdx = idx;
    atlas = null;
    sheetImgs = {};
    const ts = tilesets[idx];
    if (!ts) return;
    let pending = 0, settled = 0;
    const done = () => {
      if (++settled >= pending) {
        atlas = buildAtlas(sheetImgs);
        buildPalGrid(curPalTab);
        draw();
      }
    };
    ts.tileset_names.forEach((n, i) => {
      if (!n) return;
      pending++;
    });
    if (!pending) { atlas = buildAtlas(sheetImgs); buildPalGrid(curPalTab); draw(); return; }
    ts.tileset_names.forEach((n, i) => {
      if (!n) return;
      const im = new Image();
      im.onload = done;
      im.onerror = done;
      im.src = `assets/tilesets/${n}.png`;
      sheetImgs[SHEET_KEYS[i]] = im;
    });
  }

  function sheetReady(key) {
    const im = sheetImgs[key];
    return im && im.complete && im.naturalWidth ? im : null;
  }

  // ---------- 真实模式调色板 ----------
  let curPalTab = 'A2';
  for (const [key, label] of PAL_TABS) {
    const b = h('button', { class: 'btn', style: 'font-size:11px;padding:2px 6px', 'data-tab': key, onclick: () => buildPalGrid(key) }, label);
    palTabs.append(b);
  }

  function palItem(preview, label, onSel) {
    const cv = h('canvas', { width: 32, height: 32, title: label, style: 'image-rendering:pixelated;background:#0a0e24;border:1px solid #4a5a9a;cursor:pointer;flex:none' });
    const item = { cv, preview, label, sel: false };
    cv.addEventListener('click', () => {
      palGrid.querySelectorAll('canvas').forEach(c => c.style.borderColor = '#4a5a9a');
      cv.style.borderColor = '#f0c75e';
      onSel();
      palInfo.textContent = label;
      setMode('terrain');
    });
    drawPreview(item);
    return item;
  }

  function drawPreview(item) {
    const g = item.cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 32, 32);
    const [key, sx, sy] = item.preview;
    const im = sheetReady(key);
    if (!im) {
      g.fillStyle = '#223';
      g.fillRect(0, 0, 32, 32);
      return;
    }
    g.drawImage(im, sx * TS, sy * TS, TS, TS, 0, 0, 32, 32);
  }

  function buildPalGrid(tab) {
    curPalTab = tab;
    palTabs.querySelectorAll('button').forEach(b =>
      b.style.background = b.dataset.tab === tab ? 'linear-gradient(180deg,#f5d878,#c99b2f)' : '');
    palTabs.querySelectorAll('button').forEach(b =>
      b.style.color = b.dataset.tab === tab ? '#101a3c' : '');
    palGrid.innerHTML = '';
    if (!tilesets || tilesetIdx < 0) return;
    const add = (preview, label, onSel) => palGrid.append(palItem(preview, label, onSel).cv);

    if (tab === 'A2') {
      if (!tilesets[tilesetIdx].tileset_names[1]) { palInfo.textContent = '该 tileset 无 A2 表'; return; }
      for (let b = 0; b < 32; b++) {
        const sx = (b % 8) * 2, sy = ((b / 8) | 0) * 3;
        add(['A2', sx, sy], `A2 地面块 ${b}`, () => { brush = { kind: 'auto', table: 'A2', block: b }; });
      }
    } else if (tab === 'A1') {
      if (!tilesets[tilesetIdx].tileset_names[0]) { palInfo.textContent = '该 tileset 无 A1 表'; return; }
      for (const [b, [sx, sy]] of A1_WATER) {
        add(['A1', sx, sy], `A1 水面块 ${b}`, () => { brush = { kind: 'auto', table: 'A1', block: b }; });
      }
      for (const [b, [sx, sy]] of A1_FALL) {
        add(['A1', sx, sy], `A1 瀑布块 ${b}`, () => { brush = { kind: 'auto', table: 'A1', block: b }; });
      }
    } else if (tab === 'A5') {
      if (!tilesets[tilesetIdx].tileset_names[4]) { palInfo.textContent = '该 tileset 无 A5 表'; return; }
      for (let gy = 0; gy < 16; gy++) {
        for (let gx = 0; gx < 8; gx++) {
          const id = singleTileId('A5', gx, gy);
          add(['A5', gx, gy], `A5 (${gx},${gy}) id=0x${id.toString(16)}`, () => { brush = { kind: 'tile', id }; });
        }
      }
    } else {  // B/C/D/E
      const ki = SHEET_KEYS.indexOf(tab);
      if (!tilesets[tilesetIdx].tileset_names[ki]) { palInfo.textContent = `该 tileset 无 ${tab} 表`; return; }
      for (let gy = 0; gy < 16; gy++) {
        for (let gx = 0; gx < 16; gx++) {
          const id = singleTileId(tab, gx, gy);
          add([tab, gx, gy], `${tab} (${gx},${gy}) id=0x${id.toString(16)}`, () => { brush = { kind: 'tile', id }; });
        }
      }
    }
  }

  // ---------- 模式切换 (hand / real) ----------
  function setMapKind(k) {
    mapKind = k;
    for (const [kk, b] of Object.entries(kindBtns)) b.classList.toggle('active', kk === k);
    terrainPal.style.display = k === 'hand' ? '' : 'none';
    tilePalWrap.style.display = k === 'real' ? '' : 'none';
    tilesetRow.style.display = k === 'real' ? '' : 'none';
    palPanelTitle.textContent = k === 'hand' ? '地形调色板' : '图块调色板';
    if (k === 'real') {
      ensureTilesets().then(() => {
        buildPalGrid(curPalTab);
        if (map && map.format === 'vxace') setupTileset(map.tileset_id);
      }).catch(e => toast(e.message, false));
    }
  }

  // ---------- 地图载入 / 新建 / 保存 ----------
  async function loadMap(id) {
    let m;
    try {
      m = await loadJSON(`data/maps/${id}.json`);
    } catch (e) {
      toast(e.message, false);
      return;
    }
    map = m;
    if (map.format === 'vxace' || map.layers) {
      map.format = 'vxace';
      for (const z of ['z0', 'z1', 'z2']) {
        map.layers[z] = map.layers[z] || [];
        while (map.layers[z].length < map.cols * map.rows) map.layers[z].push(0);
      }
      setMapKind('real');
      await ensureTilesets();
      tilesetSel.value = String(map.tileset_id);
      setupTileset(map.tileset_id);
    } else {
      setMapKind('hand');
    }
    afterLoad();
    toast(`已载入地图 ${id}`);
  }

  function afterLoad() {
    if (mapKind === 'hand') {
      grid = map.terrain.map(row => row.split(''));
      // 容错: 行列不齐时补齐平原
      for (let y = 0; y < map.rows; y++) {
        if (!grid[y]) grid[y] = [];
        while (grid[y].length < map.cols) grid[y].push('.');
      }
    }
    nameInp.value = map.name || '';
    introTa.value = map.intro || '';
    objSel.value = map.objective?.type || 'rout';
    turnsInp.value = map.objective?.turns ?? 8;
    updateObjUI();
    selSquadIdx = -1;
    canvas.width = map.cols * CELL;
    canvas.height = map.rows * CELL;
    draw();
  }

  function createMap() {
    const id = newIdInp.value.trim();
    if (!id) { toast('请输入新地图 id', false); return; }
    const cols = Math.max(4, parseInt(colsInp.value || '20', 10) || 20);
    const rows = Math.max(4, parseInt(rowsInp.value || '11', 10) || 11);
    if (mapKind === 'real') {
      const tsId = parseInt(tilesetSel.value || '1', 10);
      const n = cols * rows;
      const z0 = new Array(n).fill(0);
      // 有 A2 表则铺地面块 0 (全同类 -> 模式 0), 没有则留空
      if (tilesets?.[tsId]?.tileset_names[1]) z0.fill(autoBase('A2', 0));
      map = {
        id, name: id, cols, rows,
        format: 'vxace',
        tileset_id: tsId,
        layers: { z0, z1: new Array(n).fill(0), z2: new Array(n).fill(0) },
        squads: [],
        objective: { type: 'rout' },
        seizePoint: { x: Math.floor(cols / 2), y: 1 },
        intro: '',
      };
      setupTileset(tsId);
      buildPalGrid(curPalTab);
    } else {
      map = {
        id, name: id, cols, rows,
        terrain: Array.from({ length: rows }, () => '.'.repeat(cols)),
        squads: [],
        objective: { type: 'rout' },
        seizePoint: { x: Math.floor(cols / 2), y: 1 },
        intro: '',
      };
    }
    if (![...mapSel.options].some(o => o.value === id)) mapSel.append(h('option', { value: id }, id));
    mapSel.value = id;
    afterLoad();
    toast(`已创建新地图 ${id} (记得保存)`);
  }

  function serialize() {
    if (mapKind === 'hand') return { ...map, terrain: grid.map(row => row.join('')) };
    return map;   // vxace 格式: layers 已是扁平数组
  }

  function saveMap() {
    if (!map) { toast('没有可保存的地图', false); return; }
    saveJSON(`data/maps/${map.id}.json`, serialize());
  }

  // ---------- 绘制 ----------
  function draw() {
    if (!map) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mapKind === 'real') drawRealTerrain();
    else drawHandTerrain();
    drawOverlays();
  }

  function drawHandTerrain() {
    const grass = getImg('tile_grass');
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const t = terrainByChar(grid[y][x]) || terrainByChar('.');
        const px = x * CELL, py = y * CELL;
        // 树类贴图是透明叠加层, 先铺草地
        if (t.tile.startsWith('tree')) {
          if (grass.complete) ctx.drawImage(grass, px, py, CELL, CELL);
          else { ctx.fillStyle = '#3a6b35'; ctx.fillRect(px, py, CELL, CELL); }
        }
        const im = getImg(t.tile);
        if (im.complete && im.naturalWidth) ctx.drawImage(im, px, py, CELL, CELL);
        else if (!t.tile.startsWith('tree')) { ctx.fillStyle = '#223'; ctx.fillRect(px, py, CELL, CELL); }
        if (t.id === 'fort') { // 要塞加个金色角标区分城墙
          ctx.fillStyle = '#f0c75e';
          ctx.fillRect(px + 12, py + 12, 8, 8);
        }
      }
    }
  }

  function drawRealTerrain() {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!atlas) return;
    for (const z of ['z0', 'z1', 'z2']) {
      const layer = map.layers[z];
      for (let y = 0; y < map.rows; y++) {
        for (let x = 0; x < map.cols; x++) {
          drawTilePx(ctx, atlas, layer[y * map.cols + x], x, y);
        }
      }
    }
  }

  function drawOverlays() {
    // 网格线
    ctx.strokeStyle = 'rgba(8,12,32,.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.cols; x++) { ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, canvas.height); }
    for (let y = 0; y <= map.rows; y++) { ctx.moveTo(0, y * CELL + .5); ctx.lineTo(canvas.width, y * CELL + .5); }
    ctx.stroke();

    // 占领点
    if (map.seizePoint) {
      const { x, y } = map.seizePoint;
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
      ctx.fillStyle = '#f5d878';
      ctx.strokeStyle = '#7a5a10';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 4 * Math.PI / 5;
        const r = 11;
        i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
                : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // 部队
    map.squads.forEach((s, i) => {
      const tpl = squadById(s.ref);
      const leader = tpl ? unitById(tpl.leader) : null;
      const px = s.x * CELL, py = s.y * CELL;
      if (leader) {
        const im = getImg(leader.sprite);
        if (im.complete && im.naturalWidth) ctx.drawImage(im, px, py, CELL, CELL);
      }
      ctx.fillStyle = s.team === 0 ? 'rgba(60,120,255,.28)' : 'rgba(255,60,60,.28)';
      ctx.fillRect(px, py, CELL, CELL);
      ctx.strokeStyle = s.team === 0 ? '#6aa0ff' : '#ff7a6a';
      ctx.lineWidth = i === selSquadIdx ? 3 : 2;
      ctx.strokeRect(px + 1, py + 1, CELL - 2, CELL - 2);
      ctx.font = '10px serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(tpl ? tpl.name : s.ref, px + CELL / 2, py + CELL - 3);
    });
  }

  // ---------- 交互 ----------
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (r.width / map.cols));
    const y = Math.floor((e.clientY - r.top) / (r.height / map.rows));
    if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return null;
    return { x, y };
  }
  function squadAt(x, y) { return map.squads.findIndex(s => s.x === x && s.y === y); }

  // 真实模式刷写/擦除一格; 返回是否有改动
  function paintReal(x, y, erase) {
    const z0 = map.layers.z0, z2 = map.layers.z2;
    if (brush && brush.kind === 'tile') {
      const v = erase ? 0 : brush.id;
      if (z2[y * map.cols + x] === v) return false;
      z2[y * map.cols + x] = v;
      return true;
    }
    if (brush && brush.kind === 'auto') {
      if (erase) {
        if (!z0[y * map.cols + x]) return false;
        eraseAuto(z0, x, y, map.cols, map.rows);
      } else {
        const target = autoBase(brush.table, brush.block);
        const cur = autoInfo(z0[y * map.cols + x]);
        if (cur && cur.table === brush.table && cur.block === brush.block) return false;
        z0[y * map.cols + x] = target;
        paintAuto(z0, x, y, map.cols, map.rows, brush.table, brush.block);
      }
      return true;
    }
    return false;
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!map) return;
    const c = cellAt(e);
    if (!c) return;
    if (mode === 'terrain') {
      if (mapKind === 'real' && !brush) { toast('先在右侧调色板选一个图块', false); return; }
      painting = true;
      if (mapKind === 'real') { if (paintReal(c.x, c.y, e.button === 2)) draw(); }
      else paint(c.x, c.y, e.button === 2 ? '.' : selTerrain);
    } else if (mode === 'squad') {
      if (e.button === 2) { // 右键删除部队
        const i = squadAt(c.x, c.y);
        if (i >= 0) { map.squads.splice(i, 1); selSquadIdx = -1; draw(); }
        return;
      }
      const i = squadAt(c.x, c.y);
      if (i >= 0) { selSquadIdx = i; dragging = true; draw(); }
      else if (selSquadRef) {
        map.squads.push({ ref: selSquadRef, x: c.x, y: c.y, team: selTeam });
        selSquadIdx = map.squads.length - 1;
        dragging = true;
        draw();
      }
    } else if (mode === 'seize') {
      map.seizePoint = { x: c.x, y: c.y };
      draw();
    }
  });
  canvas.addEventListener('mousemove', e => {
    if (!map) return;
    const c = cellAt(e);
    if (mapKind === 'real') {
      infoLine.textContent = c
        ? `(${c.x}, ${c.y}) z0=0x${map.layers.z0[c.y * map.cols + c.x].toString(16)} z2=0x${map.layers.z2[c.y * map.cols + c.x].toString(16)}`
        : '';
    } else {
      infoLine.textContent = c ? `(${c.x}, ${c.y}) ${terrainByChar(grid[c.y][c.x])?.name || ''}` : '';
    }
    if (!c) return;
    if (painting && mode === 'terrain') {
      if (mapKind === 'real') { if (paintReal(c.x, c.y, !!(e.buttons & 2))) draw(); }
      else paint(c.x, c.y, (e.buttons & 2) ? '.' : selTerrain);
    }
    if (dragging && selSquadIdx >= 0) {
      const s = map.squads[selSquadIdx];
      if (s && (s.x !== c.x || s.y !== c.y) && squadAt(c.x, c.y) < 0) {
        s.x = c.x; s.y = c.y;
        draw();
      }
    }
  });
  window.addEventListener('mouseup', () => { painting = false; dragging = false; });

  function paint(x, y, ch) {
    if (grid[y][x] === ch) return;
    grid[y][x] = ch;
    draw();
  }

  function deleteSelectedSquad() {
    if (!map || selSquadIdx < 0) { toast('先在地图上点击选中一支部队', false); return; }
    map.squads.splice(selSquadIdx, 1);
    selSquadIdx = -1;
    draw();
  }

  function setMode(m) {
    mode = m;
    for (const [k, b] of Object.entries(modeBtns)) b.classList.toggle('active', k === m);
    canvas.style.cursor = m === 'terrain' ? 'crosshair' : 'pointer';
  }

  setMode('terrain');
  setMapKind('hand');
  updateObjUI();
  // 支持 ?map=<id> 直接载入 (含真实模式地图)
  const startId = new URLSearchParams(location.search).get('map') || MAP_IDS[0];
  loadMap(startId);
}
