// data.js — 加载 data/*.json 并建立索引 (SPEC: data/ 是唯一事实来源)
export async function loadData(mapId) {
  const get = async path => {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  };
  const [units, skills, items, terrains, squads, techs, traits, map] = await Promise.all([
    get('data/units.json'),
    get('data/skills.json'),
    get('data/items.json'),
    get('data/terrains.json'),
    get('data/squads.json'),
    get('data/tech.json'),
    get('data/traits.json'),
    // rm* = 真实 VX Ace 地图, 由 realmap.js 单独加载, 这里跳过
    mapId.toLowerCase().startsWith('rm') ? Promise.resolve(null) : get(`data/maps/${mapId}.json`),
  ]);
  const db = {
    unitsById: index(units.units),
    skillsById: index(skills.skills),
    itemsById: index(items.items),
    squadsById: index(squads.squads),
    itemList: items.items,
    terrains: terrains.terrains,
    techs: techs.techs || techs,
    traits: traits.traits || traits,
    terrainByChar: {},
    map,
  };
  db.traitsById = index(db.traits);
  for (const t of db.terrains) db.terrainByChar[t.char] = t;
  // 规范化地图行: 每行恰好 cols 个字符 (真实地图模式 map 为 null, 由 realmap 提供)
  if (map) map.terrain = map.terrain.map(row => row.padEnd(map.cols, '.').slice(0, map.cols));
  return db;
}

function index(arr) {
  const o = {};
  for (const e of arr) o[e.id] = e;
  return o;
}

// 单位没有显式配置武器时, 按武器类型找一把默认武器
export function defaultWeapon(unitDef, db) {
  const w = db.itemList.find(it => it.type === 'weapon' && it.weapon === unitDef.weapon);
  return w || { id: 'improvised', name: '旧武器', type: 'weapon', weapon: unitDef.weapon, might: 3, hit: 80, crit: 0, range: 1, bonuses: {} };
}
