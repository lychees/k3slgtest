// CDP 新兵种/属性卡 E2E:
// 招募 tab 7 初始职业+inline 属性 -> 雇医护兵 -> 编队上阵 -> 悬停属性卡
// -> 进图让医护兵在敌方阶段战斗中治疗 (heal 事件+heal 音效) -> 新敌模板出现 -> 无 JS 报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9348;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile18',
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
async function settleCam() {
  for (let i = 0; i < 60; i++) {
    if (await evaljs(`(() => { const c = window.__tactics.cam;
      return Math.abs(c.cx - c.tx) < 0.01 && Math.abs(c.cy - c.ty) < 0.01; })()`)) return;
    await sleep(100);
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
async function cursorTo(tx, ty) {
  for (let i = 0; i < 60; i++) {
    const c = await evaljs(`({ ...window.__tactics.state.cursor })`);
    if (c.x === tx && c.y === ty) return;
    const k = c.x < tx ? 'ArrowRight' : c.x > tx ? 'ArrowLeft' : c.y < ty ? 'ArrowDown' : 'ArrowUp';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
    await sleep(90);
  }
}
async function endPhase() {
  const t = await evaljs(`(() => {
    const { cam, squads } = window.__tactics;
    const tp = 32 * cam.level, vw = 960 / tp, vh = 540 / tp;
    const l = Math.ceil(cam.cx - vw / 2) + 1, r = Math.floor(cam.cx + vw / 2) - 1;
    const u = Math.ceil(cam.cy - vh / 2) + 1, d = Math.floor(cam.cy + vh / 2) - 1;
    for (let y = u; y <= d; y++) for (let x = l; x <= r; x++) {
      if (!squads().some(s => s.x === x && s.y === y)) return [x, y];
    }
    return null;
  })()`);
  await cursorTo(t[0], t[1]);
  await settleCam();
  const c = await evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const sx = ((${t[0]}) - (cam.cx - 960 / tp / 2)) * tp, sy = ((${t[1]}) - (cam.cy - 540 / tp / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify15_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify15_${name}.png`);
}
const armyState = () => evaljs(`JSON.parse(localStorage.getItem('sow_army'))`);
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
  await nav(`${BASE}?map=rm004&debug=clean`);
  await evaljs(`localStorage.clear()`);

  // 1. 整备 -> 招募 tab: 7 初始职业 + inline 属性
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(1000);
  await evaljs(`document.querySelector('.au-tab[data-tab="recruit"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  const rows = await evaljs(`[...document.querySelectorAll('#au-body .au-row:not(.au-legend-row)')].map(r => r.textContent)`);
  check(rows.length === 7, `招募 7 个初始职业 (实际 ${rows.length})`);
  check(rows.some(r => r.includes('医护兵')) && rows.some(r => r.includes('枪兵')) && rows.some(r => r.includes('佣兵')),
    '含医护兵/枪兵/佣兵');
  const medicRow = rows.find(r => r.includes('医护兵')) || '';
  check(medicRow.includes('治疗') && medicRow.includes('急救'), '医护兵 inline 显示 治疗/急救');
  check(medicRow.includes('成长') && medicRow.includes('魔55%'), '招募行含成长率');
  await shot('recruit');

  // 2. 雇一个医护兵
  const goldBefore = (await armyState()).gold;
  await evaljs(`(() => {
    const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('医护兵'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  const a1 = await armyState();
  check(a1.gold === goldBefore - 500, `雇医护兵扣款 (${goldBefore}->${a1.gold})`);
  check(Object.values(a1.units).some(u => u.classId === 'medic'), '后备池有医护兵实例');

  // 3. 编队: 医护兵上阵泽洛斯队
  await evaljs(`document.querySelector('.au-tab[data-tab="formation"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  const sizeBefore = Object.keys((await armyState()).rosters.zelos_guard.members).length;
  await evaljs(`(() => {
    const c = [...document.querySelectorAll('.au-pool-grid .au-cell')].find(c => c.textContent.includes('医护兵'));
    c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  await evaljs(`(() => {
    const empty = [...document.querySelectorAll('.au-grid .au-cell')].find(c => !c.querySelector('img'));
    empty.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  const sizeAfter = Object.keys((await armyState()).rosters.zelos_guard.members).length;
  check(sizeAfter === sizeBefore + 1, `医护兵上阵 (${sizeBefore}->${sizeAfter})`);
  await shot('formation_medic');

  // 4. 悬停属性卡 (后备池单位)
  await evaljs(`(() => {
    const c = document.querySelector('.au-pool-grid .au-cell');
    c.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  })()`);
  await sleep(300);
  const card = await evaljs(`(() => { const c = document.getElementById('au-card');
    return { shown: c.style.display === 'block', text: c.textContent }; })()`);
  check(card.shown && card.text.includes('Lv.') && card.text.includes('力') && card.text.includes('成长'),
    `属性卡显示 (${card.text.slice(0, 40)}…)`);
  await shot('statcard');

  // 5. 进图: 泽洛斯(含医护兵)贴到敌旁, 敌方阶段被打 -> 医护兵治疗
  //    (敌方全 miss 则无人受伤无 heal, 允许重试至多 3 回合)
  await nav(`${BASE}?map=rm004&nostory=1`);
  await realClick(500, 300);   // skip intro
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
  }
  let heal = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaljs(`(() => { const T = window.__tactics;
      const z = T.squads().find(s => s.template.id === 'zelos_guard');
      const foe = T.squads().filter(s => s.team === 1)
        .sort((a, b) => (Math.abs(a.x - z.x) + Math.abs(a.y - z.y)) - (Math.abs(b.x - z.x) + Math.abs(b.y - z.y)))[0];
      if (foe) z.setPos(foe.x, foe.y + 1); })()`);
    await endPhase();
    heal = await evaljs(`(() => { const p = window.__tactics.lastPlayback;
      if (!p) return null;
      const evs = p.events.filter(e => e.kind === 'heal');
      return { n: evs.length, amount: evs[0] && evs[0].amount, defSide: p.events.some(e => e.side === 'def') }; })()`);
    if (heal && heal.n > 0) break;
  }
  // 等敌方阶段中的战斗, 抓治疗飘字
  let healShot = false;
  for (let i = 0; i < 120; i++) {
    await sleep(400);
    if (await evaljs(`window.__tactics.state.battle`)) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });   // 加速但不skip太多
      const healFloat = await evaljs(`[...document.querySelectorAll('.bu-float')].some(f => f.classList.contains('heal'))`);
      if (healFloat && !healShot) { await shot('heal'); healShot = true; }
    }
    const done = await evaljs(`(() => { const T = window.__tactics;
      return T.state.phase === 0 || T.state.over; })()`);
    if (done) break;
  }
  console.log('  [battle events]', await evaljs(`(() => { const p = window.__tactics.lastPlayback;
    return p ? p.events.map(e => e.kind + ':' + e.side).join(' ') : 'none'; })()`));
  console.log('  [zelos hp]', await evaljs(`(() => { const z = window.__tactics.squads().find(s => s.template.id === 'zelos_guard');
    return z.members.map(m => m.def.id + ' ' + m.hp + '/' + m.maxhp).join(' | '); })()`));
  check(heal && heal.n > 0 && heal.amount > 0, `战斗中出现治疗事件 (${JSON.stringify(heal)})`);
  check((await evaljs(`window.__audio.sfx`)).includes('heal'), 'heal 音效已触发');
  check(healShot, '抓到治疗飘字截图');

  // 6. 新敌模板进入轮换 (rm003 大域 5 敌, 轮换含新模板)
  await nav(`${BASE}?map=rm003&debug=clean`);
  const foes = await evaljs(`window.__tactics.squads().filter(s => s.team === 1).map(s => s.template.id)`);
  check(foes.includes('dark_coven') || foes.includes('darklance_guard'), `新敌模板轮换 (${JSON.stringify(foes)})`);

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
