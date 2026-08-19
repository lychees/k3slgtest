// 公共工具: DOM 构造 / 数据加载 / 保存 / 下载 / toast / 资源清单

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url}: ${res.status}`);
  return res.json();
}

export async function saveJSON(path, obj) {
  try {
    const res = await fetch('/api/save?path=' + encodeURIComponent(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj, null, 2),
    });
    if (res.ok) { toast(`保存成功: ${path}`, true); return true; }
    toast(`保存失败: ${path} (HTTP ${res.status})`, false);
    return false;
  } catch (e) {
    toast(`保存失败: ${path} (${e.message})`, false);
    return false;
  }
}

export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已下载 ${filename}`, true);
}

let toastTimer = null;
export function toast(msg, ok = true) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'fe-panel ' + (ok ? 'ok' : 'err');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; t.className = 'fe-panel'; }, 2600);
  t.style.display = 'block';
}

// ---- assets 资源清单(硬编码, 与 assets/ 目录对应, 不带扩展名) ----
export const SPRITES = [
  'unit_archer_green', 'unit_armor_gray', 'unit_cavalier_teal', 'unit_fighter_blue',
  'unit_hood_blue', 'unit_knight_blue', 'unit_knight_dark', 'unit_mage_teal',
  'unit_monk_orange', 'unit_risen_dark', 'unit_sage_green', 'unit_soldier_blue',
];
export const PORTRAITS = [
  'large_portrait_barnabas', 'large_portrait_diana', 'large_portrait_lysander', 'large_portrait_zelos',
];
export const ICONS = ['tech_1', 'tech_2', 'tech_3', 'tech_4', 'tech_5', 'tech_6'];
export const WEAPON_TYPES = ['sword', 'axe', 'lance', 'bow', 'fire', 'ice', 'lightning', 'heal', 'gun', 'claw'];
export const STATS = ['hp', 'str', 'mag', 'skl', 'arm', 'ldr', 'mov'];
export const MAP_IDS = ['ch1']; // data/maps/ 下已有地图

export function assetImg(name, cls = 'preview-img') {
  return h('img', { class: cls, src: `assets/${name}.png`, alt: name });
}

// 带预览图的下拉框
export function imgSelect(options, value, imgCls = 'preview-img') {
  const sel = h('select', {});
  for (const opt of options) sel.append(h('option', { value: opt }, opt));
  sel.value = value;
  const img = assetImg(options.includes(value) ? value : options[0], imgCls);
  sel.addEventListener('change', () => { img.src = `assets/${sel.value}.png`; });
  return { sel, img };
}

// 全局共享数据(启动时加载, 各编辑器直接读写)
export const DB = {
  units: null,    // {units:[...]}
  squads: null,   // {squads:[...]}
  skills: null,   // {skills:[...]}
  items: null,    // {items:[...]}
  terrains: null, // {terrains:[...]}
};

export async function loadAll() {
  const [units, squads, skills, items, terrains] = await Promise.all([
    loadJSON('data/units.json'),
    loadJSON('data/squads.json'),
    loadJSON('data/skills.json'),
    loadJSON('data/items.json'),
    loadJSON('data/terrains.json'),
  ]);
  Object.assign(DB, { units, squads, skills, items, terrains });
}

export function unitById(id) { return DB.units.units.find(u => u.id === id); }
export function skillById(id) { return DB.skills.skills.find(s => s.id === id); }
export function itemById(id) { return DB.items.items.find(i => i.id === id); }
export function squadById(id) { return DB.squads.squads.find(s => s.id === id); }
export function weaponItems() { return DB.items.items.filter(i => i.type === 'weapon'); }
export function artifactItems() { return DB.items.items.filter(i => i.type === 'artifact'); }
