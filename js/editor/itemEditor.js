// 物品编辑器: 列表 + 表单; weapon 显示武器字段, artifact 显示 bonuses 键值对
import {
  h, DB, WEAPON_TYPES, STATS,
  saveJSON, downloadJSON, toast,
} from './common.js';

const TYPES = ['weapon', 'artifact'];

export function initItemEditor(root) {
  let cur = null;
  let filter = '';

  const search = h('input', { type: 'text', placeholder: '搜索 id / 名称…', style: 'width:100%' });
  search.addEventListener('input', () => { filter = search.value.trim().toLowerCase(); renderList(); });

  const listEl = h('div', { class: 'item-list' });
  const formEl = h('div', { class: 'panel fe-panel', style: 'flex:1' });

  const btnNew = h('button', { class: 'btn', onclick: addItem }, '新增');
  const btnDup = h('button', { class: 'btn', onclick: dupItem }, '复制');
  const btnDel = h('button', { class: 'btn danger', onclick: delItem }, '删除');
  const btnSave = h('button', { class: 'btn gold', onclick: () => saveJSON('data/items.json', DB.items) }, '保存到服务器');
  const btnDl = h('button', { class: 'btn', onclick: () => downloadJSON('items.json', DB.items) }, '下载 JSON');

  root.append(
    h('div', { class: 'col', style: 'width:260px;flex:none' },
      h('div', { class: 'panel fe-panel col', style: 'flex:1' },
        h('h3', {}, '物品列表'), search, listEl)),
    h('div', { class: 'col', style: 'flex:1' },
      h('div', { class: 'btn-row' }, btnNew, btnDup, btnDel, btnSave, btnDl),
      formEl),
  );

  function renderList() {
    listEl.innerHTML = '';
    for (const it of DB.items.items) {
      if (filter && !it.id.toLowerCase().includes(filter) && !it.name.toLowerCase().includes(filter)) continue;
      const tag = it.type === 'weapon' ? '⚔' : '✦';
      const row = h('div', { class: 'row' + (it === cur ? ' sel' : '') },
        h('span', { class: 'fe-label' }, tag),
        h('span', {}, it.name), h('span', { class: 'fe-dim' }, it.id));
      row.addEventListener('click', () => { cur = it; renderList(); renderForm(); });
      listEl.append(row);
    }
  }

  function numInput(val, onch) {
    const inp = h('input', { type: 'number', value: val });
    inp.addEventListener('change', () => onch(parseInt(inp.value || '0', 10) || 0));
    return inp;
  }

  function renderForm() {
    formEl.innerHTML = '';
    if (!cur) { formEl.append(h('h3', {}, '物品属性'), h('p', { class: 'fe-dim' }, '从左侧选择一个物品, 或点击「新增」。')); return; }
    const it = cur;

    formEl.append(h('h3', {}, `物品属性 — ${it.name}`));
    const grid = h('div', { class: 'form-grid' });

    const idInp = h('input', { type: 'text', value: it.id });
    idInp.addEventListener('change', () => {
      const nid = idInp.value.trim();
      if (!nid) { toast('id 不能为空', false); idInp.value = it.id; return; }
      if (DB.items.items.some(x => x !== it && x.id === nid)) { toast('id 已存在', false); idInp.value = it.id; return; }
      it.id = nid; renderList();
    });
    const nameInp = h('input', { type: 'text', value: it.name });
    nameInp.addEventListener('change', () => { it.name = nameInp.value; renderList(); renderForm(); });

    const typeSel = h('select', {}, TYPES.map(t => h('option', { value: t }, t === 'weapon' ? 'weapon (武器)' : 'artifact (神器)')));
    typeSel.value = it.type;
    typeSel.addEventListener('change', () => { it.type = typeSel.value; renderList(); renderForm(); });

    grid.append(
      h('label', {}, 'ID'), idInp,
      h('label', {}, '名称'), nameInp,
      h('label', {}, '类型'), typeSel,
      h('label', {}, '价格'), numInput(it.price, v => it.price = v),
    );

    if (it.type === 'weapon') {
      const wSel = h('select', {}, WEAPON_TYPES.map(w => h('option', { value: w }, w)));
      wSel.value = it.weapon || 'sword';
      wSel.addEventListener('change', () => it.weapon = wSel.value);
      grid.append(
        h('label', {}, '武器类型'), wSel,
        h('label', {}, '威力 might'), numInput(it.might, v => it.might = v),
        h('label', {}, '命中 hit'), numInput(it.hit, v => it.hit = v),
        h('label', {}, '必杀 crit'), numInput(it.crit, v => it.crit = v),
        h('label', {}, '射程 range'), numInput(it.range, v => it.range = v),
      );
    }
    formEl.append(grid);

    if (it.type === 'artifact') {
      formEl.append(h('h3', { style: 'margin-top:10px' }, '部队加成 bonuses'));
      it.bonuses = it.bonuses || {};
      const tbl = h('table', { class: 'kv' });
      const rebuild = () => {
        tbl.innerHTML = '';
        tbl.append(h('tr', {}, h('th', {}, '属性'), h('th', {}, '数值'), h('th', {}, '')));
        for (const [k, v] of Object.entries(it.bonuses)) {
          const kSel = h('select', {}, STATS.map(s => h('option', { value: s }, s)));
          kSel.value = k;
          kSel.addEventListener('change', () => {
            if (kSel.value === k) return;
            if (it.bonuses[kSel.value] !== undefined) { toast('该属性已存在', false); kSel.value = k; return; }
            it.bonuses[kSel.value] = it.bonuses[k];
            delete it.bonuses[k];
            rebuild();
          });
          const vInp = numInput(v, nv => it.bonuses[k] = nv);
          const del = h('button', { class: 'btn danger', onclick: () => { delete it.bonuses[k]; rebuild(); } }, '移除');
          tbl.append(h('tr', {}, h('td', {}, kSel), h('td', {}, vInp), h('td', {}, del)));
        }
      };
      rebuild();
      const addBtn = h('button', { class: 'btn', style: 'margin-top:6px', onclick: () => {
        const free = STATS.find(s => it.bonuses[s] === undefined);
        if (!free) { toast('所有属性都已添加', false); return; }
        it.bonuses[free] = 1;
        rebuild();
      } }, '添加加成');
      formEl.append(tbl, addBtn);
    }

    formEl.append(h('h3', { style: 'margin-top:10px' }, '描述'));
    const desc = h('textarea', {}, it.description);
    desc.addEventListener('change', () => it.description = desc.value);
    formEl.append(desc);
  }

  function addItem() {
    let id = 'new_item';
    let n = 1;
    while (DB.items.items.some(i => i.id === id)) id = `new_item_${++n}`;
    const it = { id, name: '新物品', type: 'weapon', weapon: 'sword', might: 3, hit: 90, crit: 0, range: 1, price: 100, bonuses: {}, description: '' };
    DB.items.items.push(it);
    cur = it; renderList(); renderForm();
    toast(`已新增物品 ${id}`);
  }

  function dupItem() {
    if (!cur) { toast('请先选择物品', false); return; }
    let id = cur.id + '_copy';
    let n = 1;
    while (DB.items.items.some(i => i.id === id)) id = `${cur.id}_copy${++n}`;
    const it = JSON.parse(JSON.stringify(cur));
    it.id = id; it.name = cur.name + '·副本';
    DB.items.items.push(it);
    cur = it; renderList(); renderForm();
    toast(`已复制为 ${id}`);
  }

  function delItem() {
    if (!cur) { toast('请先选择物品', false); return; }
    if (!confirm(`确定删除物品「${cur.name} (${cur.id})」?`)) return;
    DB.items.items = DB.items.items.filter(i => i !== cur);
    cur = null; renderList(); renderForm();
    toast('已删除(记得保存)');
  }

  cur = DB.items.items[0] || null;
  renderList();
  renderForm();
}
