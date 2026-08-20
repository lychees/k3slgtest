// CDP 收尾包 D: Boss 战 / 章节挑战 / 战中事件
// Boss 章 rm007 (order 150 -> boss_wyrm 远古巨龙, seize, 有剧情)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9363;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile29',
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
async function cursorTo(tx, ty) {
  for (let i = 0; i < 60; i++) {
    const c = await evaljs(`({ ...window.__tactics.state.cursor })`);
    if (c.x === tx && c.y === ty) return;
    const k = c.x < tx ? 'ArrowRight' : c.x > tx ? 'ArrowLeft' : c.y < ty ? 'ArrowDown' : 'ArrowUp';
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k });
    await sleep(90);
  }
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
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify19_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify19_${name}.png`);
}
async function skipIntro() {
  await realClick(500, 300);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
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
const armyState = () => evaljs(`JSON.parse(localStorage.getItem('sow_army'))`);
const patchArmy = fn => evaljs(`(() => { const a = JSON.parse(localStorage.getItem('sow_army'));
  (${fn})(a); localStorage.setItem('sow_army', JSON.stringify(a)); })()`);
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

  // 1. Boss 章开场: intro 显示 Boss 名 + Boss 队存在 + 挑战标签
  await nav(`${BASE}?map=rm007&nostory=1`, 4000);
  const intro = await evaljs(`(() => ({
    name: document.querySelector('#intro-banner .map-name').textContent,
    text: document.querySelector('#intro-banner .intro-text').textContent }))()`);
  check(intro.text.includes('Boss：远古巨龙'), `Boss 章开场 intro (${intro.text})`);
  await shot('boss_intro');
  await skipIntro();
  check(await evaljs(`window.__tactics.squads().some(s => s.isBoss)`), 'Boss 队存在 (isBoss)');
  const wyrm = await evaljs(`(() => { const T = window.__tactics;
    const b = T.squads().find(s => s.isBoss);
    const w = b.members.find(m => m.def.boss);
    return { tpl: b.template.id, cls: w.def.name, traits: w.traits.map(t => t.id) }; })()`);
  check(wyrm.tpl === 'boss_wyrm' && wyrm.cls === '远古巨龙', `Boss=远古巨龙 (${wyrm.tpl}/${wyrm.cls})`);
  check(wyrm.traits.includes('hearty') && wyrm.traits.includes('tough'),
    `Boss 固定特性 健壮+坚韧 (${wyrm.traits})`);
  check((await evaljs(`document.getElementById('bonus-label').textContent`)).includes('击杀'),
    `挑战目标显示 (${await evaljs(`document.getElementById('bonus-label').textContent`)})`);

  // 2. C 详情: Boss 职业名金色 + 红威胁
  const bpos = await evaljs(`(() => { const T = window.__tactics;
    const b = T.squads().find(s => s.isBoss); return [b.x, b.y]; })()`);
  await cursorTo(bpos[0], bpos[1]);
  await key('c');
  await sleep(400);
  const inHtml = await evaljs(`document.getElementById('in-panel').innerHTML`);
  check(inHtml.includes('in-boss') && inHtml.includes('远古巨龙'), '详情页 Boss 职业名金色');
  check(inHtml.includes('in-boss-score'), '威胁度红色');
  await shot('boss_detail');
  await key('Escape');
  await sleep(300);

  // 3. 强化玩家后 combatsettle 打 Boss 队 -> 讨伐奖励 + 挑战达成
  await patchArmy(`a => { a.gold = 5000;
    for (const uid of Object.values(a.rosters.zelos_guard.members)) {
      a.units[uid].gains = { hp: 30, str: 30, mag: 25, skl: 25, arm: 15, ldr: 0 };
    } }`);
  await nav(`${BASE}?map=rm007&debug=combatsettle`);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evaljs(`window.__tactics.state.battle`)) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
    }
    const done = await evaljs(`(() => { const T = window.__tactics;
      return !T.state.battle && (T.state.bossDown || T.state.over); })()`);
    if (done) break;
  }
  await sleep(500);
  check(await evaljs(`window.__tactics.state.bossDown`), 'Boss 队已讨伐 (bossDown)');
  let a1 = await armyState();
  check(a1.gold === 5750, `金币 5000->${a1.gold} (+500 Boss +250 击杀奖励)`);
  check(a1.inventory.length === 3, `击杀随机神器进库存 (库存 ${a1.inventory.length})`);

  // rm007 是 seize 图: 传送泽洛斯到占领点 -> 占领 -> 胜利 + 挑战达成
  const sp = await evaljs(`window.__tactics.realMap().mapMeta.seizePoint`);
  check(!!sp, `占领点 (${sp && sp.x},${sp && sp.y})`);
  await evaljs(`(() => { const T = window.__tactics;
    T.squads().find(s => s.template.id === 'zelos_guard').setPos(${sp.x}, ${sp.y}); })()`);
  await cursorTo(sp.x, sp.y);
  await clickTile(sp.x, sp.y);
  await sleep(300);
  if (!(await evaljs(`(window.__tactics.state.selected || {}).template?.id`))) {
    await clickTile(sp.x, sp.y);
    await sleep(300);
  }
  await clickTile(sp.x, sp.y);   // B0 原地菜单 (canter 选中态也兼容)
  await sleep(300);
  check(await clickMenuItem('占领'), '点占领');
  await sleep(600);
  const end = await evaljs(`(() => ({ title: document.querySelector('#end-banner .end-title').textContent,
    hint: document.querySelector('#end-banner .end-hint').textContent,
    over: window.__tactics.state.over }))()`);
  a1 = await armyState();
  check(end.over, '占领获胜');
  check(a1.gold === 7050, `金币 ->${a1.gold} (= 5750 +1000 胜利 +300 挑战)`);
  check(end.title === 'Boss 讨伐!', `胜利横幅标题 (${end.title})`);
  check(end.hint.includes('★ 挑战达成'), `挑战达成显示 (${end.hint.slice(0, 60)}…)`);
  await shot('boss_win');

  // 4. 战中对话条 (rm004 第 2 回合)
  await nav(`${BASE}?map=rm004&nostory=1`);
  await skipIntro();
  await endPhase();
  let ilUp = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await evaljs(`window.__tactics.state.battle`)) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
    }
    if (await evaljs(`getComputedStyle(document.getElementById('interlude')).display === 'block'`)) { ilUp = true; break; }
  }
  check(ilUp, '战中对话条出现 (第 2 回合)');
  const ilText = await evaljs(`document.querySelector('#interlude .il-text').textContent`);
  check(ilText.length > 0, `对话条有内容 (${ilText.slice(0, 24)}…)`);
  await shot('interlude');
  await evaljs(`document.getElementById('interlude').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(300);
  check(await evaljs(`getComputedStyle(document.getElementById('interlude')).display`) === 'none', '点击关闭对话条');

  // 5. 敌方增援 (rm007 seize, turn=3)
  await nav(`${BASE}?map=rm007&nostory=1`);
  await skipIntro();
  const foesBefore = await evaljs(`window.__tactics.squads().filter(s => s.team === 1).length`);
  await evaljs(`window.__tactics.state.turn = 3`);
  await endPhase();
  let reinforced = false, banner = '';
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    banner = await evaljs(`document.querySelector('#phase-banner .inner').textContent`);
    if (banner.includes('增援')) { reinforced = true; break; }
    const n = await evaljs(`window.__tactics.squads().filter(s => s.team === 1).length`);
    if (n > foesBefore) { reinforced = true; break; }
  }
  check(reinforced, `敌方增援触发 (横幅 "${banner}")`);
  check((await evaljs(`window.__tactics.squads().filter(s => s.team === 1).length`)) === foesBefore + 1,
    `增援 1 支 risen_pack (敌 ${foesBefore}->${foesBefore + 1})`);
  await shot('reinforce');

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
