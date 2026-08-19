// 关卡编辑器: 地图选择/新建, Canvas 地形绘制, 部队放置, 目标设置
import {
  h, DB, MAP_IDS, unitById, squadById,
  loadJSON, saveJSON, downloadJSON, toast,
} from './common.js';

const CELL = 32;
const OBJ_TYPES = ['rout', 'seize', 'survive'];

export function initMapEditor(root) {
  let map = null;          // 当前地图(工作副本)
  let grid = [];           // grid[y][x] = terrain char
  let mode = 'terrain';    // terrain | squad | seize
  let selTerrain = '.';    // 调色板选中的地形 char
  let selSquadRef = '';    // 部队模板 id
  let selTeam = 0;
  let selSquadIdx = -1;    // 地图上选中的部队下标
  let painting = false;
  let dragging = false;
  const imgCache = {};     // tile name -> Image

  // ---------- 左侧控制面板 ----------
  const mapSel = h('select', {}, MAP_IDS.map(id => h('option', { value: id }, id)));
  mapSel.addEventListener('change', () => loadMap(mapSel.value));

  const newIdInp = h('input', { type: 'text', placeholder: '新地图 id', style: 'width:100%' });
  const colsInp = h('input', { type: 'number', value: 20, style: 'width:60px' });
  const rowsInp = h('input', { type: 'number', value: 11, style: 'width:60px' });
  const btnCreate = h('button', { class: 'btn', onclick: createMap }, '新建');

  const modeBtns = {};
  const modeBar = h('div', { class: 'col', style: 'gap:4px' },
    [['terrain', '地形模式'], ['squad', '部队模式'], ['seize', '目标点模式']].map(([m, label]) => {
      const b = h('button', { class: 'btn mode-btn', onclick: () => setMode(m) }, label);
      modeBtns[m] = b;
      return b;
    }));

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
    h('div', { class: 'col', style: 'width:210px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:none' },
        h('h3', {}, '地图'),
        h('div', { style: 'display:flex;gap:4px' }, mapSel),
        h('div', { style: 'display:flex;gap:4px;align-items:center' }, newIdInp),
        h('div', { style: 'display:flex;gap:4px;align-items:center;font-size:12px' },
          h('span', { class: 'fe-dim' }, '宽'), colsInp, h('span', { class: 'fe-dim' }, '高'), rowsInp, btnCreate),
        h('h3', { style: 'margin-top:6px' }, '模式'), modeBar),
      h('div', { class: 'panel fe-panel col', style: 'flex:1;min-height:0' },
        h('h3', {}, '地形调色板'), terrainPal),
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

  // ---------- 图像 ----------
  function tileImg(name) {
    const im = h('img', { src: `assets/${name}.png`, alt: name });
    return im;
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

  // ---------- 地图载入 / 新建 / 保存 ----------
  async function loadMap(id) {
    try {
      map = await loadJSON(`data/maps/${id}.json`);
    } catch (e) {
      toast(e.message, false);
      return;
    }
    afterLoad();
    toast(`已载入地图 ${id}`);
  }

  function afterLoad() {
    grid = map.terrain.map(row => row.split(''));
    // 容错: 行列不齐时补齐平原
    for (let y = 0; y < map.rows; y++) {
      if (!grid[y]) grid[y] = [];
      while (grid[y].length < map.cols) grid[y].push('.');
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
    map = {
      id, name: id, cols, rows,
      terrain: Array.from({ length: rows }, () => '.'.repeat(cols)),
      squads: [],
      objective: { type: 'rout' },
      seizePoint: { x: Math.floor(cols / 2), y: 1 },
      intro: '',
    };
    if (![...mapSel.options].some(o => o.value === id)) mapSel.append(h('option', { value: id }, id));
    mapSel.value = id;
    afterLoad();
    toast(`已创建新地图 ${id} (记得保存)`);
  }

  function serialize() {
    return { ...map, terrain: grid.map(row => row.join('')) };
  }

  function saveMap() {
    if (!map) { toast('没有可保存的地图', false); return; }
    saveJSON(`data/maps/${map.id}.json`, serialize());
  }

  // ---------- 绘制 ----------
  function draw() {
    if (!map) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  function paint(x, y, ch) {
    if (grid[y][x] === ch) return;
    grid[y][x] = ch;
    draw();
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    if (!map) return;
    const c = cellAt(e);
    if (!c) return;
    if (mode === 'terrain') {
      painting = true;
      paint(c.x, c.y, e.button === 2 ? '.' : selTerrain);
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
    infoLine.textContent = c ? `(${c.x}, ${c.y}) ${terrainByChar(grid[c.y][c.x])?.name || ''}` : '';
    if (!c) return;
    if (painting && mode === 'terrain') paint(c.x, c.y, (e.buttons & 2) ? '.' : selTerrain);
    if (dragging && selSquadIdx >= 0) {
      const s = map.squads[selSquadIdx];
      if (s && (s.x !== c.x || s.y !== c.y) && squadAt(c.x, c.y) < 0) {
        s.x = c.x; s.y = c.y;
        draw();
      }
    }
  });
  window.addEventListener('mouseup', () => { painting = false; dragging = false; });

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
  updateObjUI();
  loadMap(MAP_IDS[0]);
}
