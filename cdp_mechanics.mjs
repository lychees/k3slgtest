// CDP 战斗机制深化 E2E (M1 危险范围 / M2 canter+flying+弓最小射程 / M3 地形):
// V 开关 -> canter 再移动 -> 龙过水 -> 弓相邻不可 -> 高地弓 +1 -> 地形面板数值 -> 无 JS 报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile20',
  '--window-size=1000,600', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const consoleErrs = [];
function send(method, params = {}) {
  return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function nav(url, wait = 3500) { await send('Page.navigate', { url }); await sleep(wait); }
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function key(k) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
  await sleep(80);
}
async function settleCam() {
  for (let i = 0; i < 60; i++) {
    if (await evaljs(`(() => { const c = window.__tactics.cam;
      return Math.abs(c.cx - c.tx) < 0.01 && Math.abs(c.cy - c.ty) < 0.01; })()`)) return;
    await sleep(100);
  }
}
async function cursorTo(tx, ty) {
  for (let i = 0; i < 60; i++) {
    const c = await evaljs(`({ ...window.__tactics.state.cursor })`);
    if (c.x === tx && c.y === ty) return;
    const k = c.x < tx ? 'ArrowRight' : c.x > tx ? 'ArrowLeft' : c.y < ty ? 'ArrowDown' : 'ArrowUp';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
    await sleep(90);
  }
}
async function clickTile(tx, ty) {
  await settleCam();
  const c = await evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const sx = ((${tx}) - (cam.cx - 960 / tp / 2)) * tp, sy = ((${ty}) - (cam.cy - 540 / tp / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
  await realClick(c.x, c.y);
}
async function clickMenuItem(label) {
  const r = await evaljs(`(() => {
    const it = [...document.querySelectorAll('#action-menu .item')].find(i => i.textContent.includes('${label}'));
    if (!it || it.classList.contains('disabled')) return null;
    const b = it.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (!r) return false;
  await realClick(r.x, r.y);
  return true;
}
async function waitMenu(ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaljs(`document.getElementById('action-menu').style.display`) === 'block') return true;
    await sleep(200);
  }
  return false;
}
async function skipIntro() {
  await realClick(500, 300);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
  }
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify17_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify17_${name}.png`);
}
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };

async function main() {
  let targets = null;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const text = String((d.exception && d.exception.description) || d.text);
      consoleErrs.push(text); console.log('PAGE EXCEPTION:', text.slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text.slice(0, 300));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await nav(`${BASE}?map=rm004&nostory=1`);
  await evaljs(`localStorage.clear()`);
  await nav(`${BASE}?map=rm004&nostory=1`);
  await skipIntro();

  // ---- M1: V 危险范围 ----
  await key('v');
  const d1 = await evaljs(`({ on: window.__tactics.state.danger, n: window.__tactics.state.dangerCount })`);
  check(d1.on && d1.n > 0, `V 打开危险范围 (${d1.n} 格)`);
  await shot('danger');
  await clickTile(4, 16);   // 选中泽洛斯 -> 自动隐藏
  await sleep(300);
  check((await evaljs(`window.__tactics.state.dangerCount`)) === 0, '选中部队时危险范围自动隐藏');
  await key('Escape');      // 取消选中 -> 恢复
  await sleep(300);
  check((await evaljs(`window.__tactics.state.dangerCount`)) > 0, '取消选中后恢复显示');
  await key('v');
  check(!(await evaljs(`window.__tactics.state.danger`)), 'V 关闭');

  // ---- M2: canter 骑兵再移动 (泽洛斯 lord) ----
  await clickTile(4, 16);
  await sleep(300);
  check(await evaljs(`window.__tactics.state.range.move.has('4,18')`), '(4,18) 在范围内');
  await clickTile(4, 18);   // 走 2 格平原 (不是满 mov 6)
  check(await waitMenu(), '移动完成弹菜单');
  await clickMenuItem('待机');
  await sleep(500);
  const canter = await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    return { sel: (T.state.selected || {}).template?.id || null, done: z.done,
      rem: T.state.range ? T.state.range.move.size : 0 }; })()`);
  check(canter.sel === 'zelos_guard' && !canter.done && canter.rem > 1,
    `canter: 待机后还能再移动 (剩余范围 ${canter.rem} 格)`);
  await shot('canter');
  // 再走剩余移动力回去
  check(await evaljs(`window.__tactics.state.range.move.has('4,16')`), '剩余范围含 (4,16)');
  await clickTile(4, 16);
  check(await waitMenu(), '第二段移动完成');
  await clickMenuItem('待机');
  await sleep(500);
  check(await evaljs(`window.__tactics.squads().find(s => s.template.id === 'zelos_guard').done`),
    'canter 第二次行动后部队变灰');

  // ---- M2: flying 龙过水 ----
  const fly = await evaljs(`(() => { const T = window.__tactics;
    const tiles = T.moveTiles('dragon_solo') || [];
    const rm = T.realMap();
    const water = tiles.filter(k => rm.terrainAt(...k.split(',').map(Number)).id === 'water');
    return { total: tiles.length, water: water.length, sample: water[0] }; })()`);
  check(fly.water > 0, `龙飞行: 移动范围含水面格 (${fly.water} 格, 如 ${fly.sample})`);

  // ---- M2: 弓最小射程 (改档: diana 全弓兵) ----
  await evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
    for (const uid of Object.values(a.rosters.diana_squad.members)) a.units[uid].classId = 'archer';
    localStorage.setItem('sow_army', JSON.stringify(a)); })()`);
  await nav(`${BASE}?map=rm004&nostory=1`);
  await skipIntro();
  const bow = await evaljs(`(() => { const T = window.__tactics;
    const d = T.squads().find(s => s.template.id === 'diana_squad');
    // diana 移到 (10,3): risen_pack(9,2) 距 2, risen_elite 挪到 (10,4) 距 1
    d.setPos(10, 3);
    T.squads().find(s => s.template.id === 'risen_elite').setPos(10, 4);
    return { min: d.rangeMin(), max: d.rangeMax() }; })()`);
  check(bow.min === 2 && bow.max === 2, `全弓队射程 2..2 (实际 ${bow.min}..${bow.max})`);
  await cursorTo(10, 3);
  await clickTile(10, 3);
  await sleep(300);
  await clickTile(10, 3);   // B0 原地菜单
  await sleep(300);
  const items = await evaljs(`[...document.querySelectorAll('#action-menu .item')].map(i => i.textContent)`);
  check(items[0] && items[0].includes('攻击') && !items[0].includes('复生精锐'),
    `弓手相邻 (距1) 目标不可选 (${JSON.stringify(items[0])}, 不含距1的复生精锐)`);
  await clickMenuItem('取消');
  await sleep(300);

  // ---- M3: 高地弓射程 +1 ----
  const hl = await evaljs(`(() => { const T = window.__tactics; const rm = T.realMap();
    let spot = null;
    for (let y = 0; y < rm.rows && !spot; y++) for (let x = 0; x < rm.cols; x++) {
      if (rm.terrainAt(x, y).highGround) { spot = [x, y]; break; }
    }
    const d = T.squads().find(s => s.template.id === 'diana_squad');
    d.setPos(spot[0], spot[1]);
    return { spot, eff: d.rangeMaxEff(rm.terrainAt), max: d.rangeMax() }; })()`);
  check(hl.eff === hl.max + 1, `高地弓射程 ${hl.max}->${hl.eff} (${hl.spot})`);
  await cursorTo(hl.spot[0], hl.spot[1]);
  await clickTile(hl.spot[0], hl.spot[1]);
  await sleep(400);
  await shot('highland');
  await key('Escape');

  // ---- M3: 地形面板数值 ----
  async function panelAt(x, y) {
    await cursorTo(x, y);
    await evaljs(`(() => { const T = window.__tactics; const c = T.cam;
      const tp = 32 * c.level;
      const sx = ((${x}) - (c.cx - 960 / tp / 2)) * tp, sy = ((${y}) - (c.cy - 540 / tp / 2)) * tp;
      const r = document.getElementById('stage').getBoundingClientRect();
      const s = r.width / 960;
      window.__hoverX = r.left + (sx + tp / 2) * s; window.__hoverY = r.top + (sy + tp / 2) * s; })()`);
    const hx = await evaljs(`window.__hoverX`), hy = await evaljs(`window.__hoverY`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hx, y: hy });
    await sleep(200);
    return evaljs(`(() => { const p = document.getElementById('terrain-panel');
      return { name: p.querySelector('.tname').textContent, avo: p.querySelector('.t-avo').textContent,
        def: p.querySelector('.t-def').textContent, cost: p.querySelector('.t-cost').textContent }; })()`);
  }
  const forest = await evaljs(`(() => { const rm = window.__tactics.realMap();
    for (let y = 0; y < rm.rows; y++) for (let x = 0; x < rm.cols; x++)
      if (rm.terrainAt(x, y).id === 'forest') return [x, y];
    return null; })()`);
  const fp = await panelAt(forest[0], forest[1]);
  check(fp.name === '森林' && fp.avo === '+10' && fp.def === '+1', `森林面板 (${JSON.stringify(fp)})`);
  const water = await evaljs(`(() => { const rm = window.__tactics.realMap();
    for (let y = 0; y < rm.rows; y++) for (let x = 0; x < rm.cols; x++)
      if (rm.terrainAt(x, y).id === 'water') return [x, y];
    return null; })()`);
  const wp = await panelAt(water[0], water[1]);
  check(wp.name === '水面' && wp.cost === '—', `水面面板 (${JSON.stringify(wp)})`);
  const mtn = await evaljs(`(() => { const rm = window.__tactics.realMap();
    for (let y = 0; y < rm.rows; y++) for (let x = 0; x < rm.cols; x++)
      if (rm.terrainAt(x, y).id === 'mountain') return [x, y];
    return null; })()`);
  if (mtn) {
    const mp = await panelAt(mtn[0], mtn[1]);
    check(mp.name === '山地' && mp.avo === '+20' && mp.cost === '2', `山地面板 (${JSON.stringify(mp)})`);
  }

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
