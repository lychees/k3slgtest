// CDP 特性/传说随从/新神器 E2E:
// 初始单位带特性+属性卡显示 -> 传说随从位(橙名/Lv.8/3特性/2000) -> 雇佣入池
// -> 神行队长 mov+1 -> 血饮坠 lifedrain 回血事件 -> 天使圣杯 heal x1.5 -> 胜利刷新传说 -> 无报错
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9349;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile19',
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
  writeFileSync(`D:/dev/k3/zq/verify16_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify16_${name}.png`);
}
async function skipIntro() {
  await realClick(500, 300);
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
  }
}
// 传送泽洛斯到 risen 旁, 结束回合, 等战斗播完
async function triggerBattle() {
  await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    z.setPos(9, 3); })()`);
  await endPhase();
  for (let i = 0; i < 120; i++) {
    await sleep(400);
    if (await evaljs(`window.__tactics.state.battle`)) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
    }
    if (await evaljs(`(() => { const T = window.__tactics; return T.state.phase === 0 || T.state.over; })()`)) break;
  }
}
const armyState = () => evaljs(`JSON.parse(localStorage.getItem('sow_army'))`);
// 改存档 (改完需重新 openArmyUI 或 nav 才生效)
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

  // 1. 初始单位带特性 + 属性卡显示
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(1000);
  const a0 = await armyState();
  const withTraits = Object.values(a0.units).filter(u => Array.isArray(u.traits) && u.traits.length > 0).length;
  check(withTraits === Object.keys(a0.units).length, `全部 ${withTraits} 个实例带特性`);
  await evaljs(`(() => {   // 悬停阵型格 -> 属性卡含特性
    const c = [...document.querySelectorAll('.au-grid .au-cell')].find(c => c.querySelector('img'));
    c.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  })()`);
  await sleep(300);
  const card0 = await evaljs(`(() => { const c = document.getElementById('au-card');
    return { shown: c.style.display === 'block', hasTrait: c.innerHTML.includes('card-trait') }; })()`);
  check(card0.shown && card0.hasTrait, '属性卡显示特性');
  await shot('trait_card');

  // 2. 传说随从位
  await evaljs(`document.querySelector('.au-tab[data-tab="recruit"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  const leg = await evaljs(`(() => { const r = document.querySelector('.au-legend-row');
    return r ? { text: r.textContent, name: (r.querySelector('.legend') || {}).textContent } : null; })()`);
  check(leg && leg.name && leg.text.includes('Lv.8') && leg.text.includes('2000') && leg.text.includes('特性'),
    `传说随从位 (${leg && leg.name}, ${leg && leg.text.slice(0, 50)}…)`);
  await shot('legend');
  const legSig = leg.name + '|' + leg.text;

  // 3. 雇传说 (2000 金 = 全部初始金)
  await evaljs(`(() => { const r = document.querySelector('.au-legend-row');
    r.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  const a1 = await armyState();
  const legendUnit = Object.values(a1.units).find(u => u.name);
  check(a1.gold === 0 && !!legendUnit, `传说雇佣入池 (金币->${a1.gold})`);
  check(legendUnit && legendUnit.level === 8 && legendUnit.traits.length === 3,
    `传说 Lv.8 + 3 特性 (${legendUnit && legendUnit.name})`);
  // 雇走后显示已加入
  const leg2 = await evaljs(`document.querySelector('.au-legend-row').textContent`);
  check(leg2.includes('已加入'), '雇走后显示已加入');

  // 4. 神行特性队长 mov+1: 改档给泽洛斯队长 marcher
  await patchArmy(`a => { const r = a.rosters.zelos_guard; a.units[r.leader].traits = ['marcher']; }`);
  await nav(`${BASE}?map=rm004&debug=clean`);
  const mov = await evaljs(`(() => { const T = window.__tactics;
    return T.squads().find(s => s.template.id === 'zelos_guard').mov; })()`);
  check(mov === 7, `神行队长 mov 6->${mov} (want 7)`);

  // 5. 血饮坠 lifedrain: 给够钱 -> 商店买 -> 装备 -> 战斗断言 drain
  await patchArmy(`a => { a.gold = 9999; a.units[a.rosters.zelos_guard.leader].traits = []; }`);
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(800);
  await evaljs(`document.querySelector('.au-tab[data-tab="shop"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('血饮坠'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  check((await armyState()).inventory.includes('blood_pendant'), '买到血饮坠');
  await evaljs(`document.querySelector('.au-tab[data-tab="artifact"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await evaljs(`(() => { const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('血饮坠'));
    const btn = row.querySelector('.au-btn:not(.disabled)'); if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await sleep(300);
  check((await armyState()).rosters.zelos_guard.artifacts.includes('blood_pendant'), '血饮坠已装备泽洛斯队');

  await nav(`${BASE}?map=rm004&nostory=1`);
  await skipIntro();
  await triggerBattle();
  const drain = await evaljs(`(() => { const p = window.__tactics.lastPlayback;
    const evs = p.events.filter(e => e.drain);
    return { n: evs.length, amount: evs[0] && evs[0].drain.amount }; })()`);
  check(drain.n > 0 && drain.amount > 0, `lifedrain 回血事件 (${JSON.stringify(drain)})`);
  check((await evaljs(`window.__audio.sfx`)).includes('heal'), '吸血音效 (heal)');

  // 6. 天使圣杯 heal x1.5: 买圣杯+装备, 法师位改医护兵
  await patchArmy(`a => {
    a.gold = 9999;
    a.rosters.zelos_guard.artifacts = ['holy_chalice'];
    if (!a.inventory.includes('holy_chalice')) a.inventory.push('holy_chalice');
    const r = a.rosters.zelos_guard;
    const uid = r.members[3];   // 法师位 -> 医护兵 (特性清空保证 mag=8 确定)
    a.units[uid].classId = 'medic';
    a.units[uid].traits = [];
  }`);
  await nav(`${BASE}?map=rm004&nostory=1`);
  await skipIntro();
  await triggerBattle();
  const heal = await evaljs(`(() => { const p = window.__tactics.lastPlayback;
    const evs = p.events.filter(e => e.kind === 'heal');
    return { n: evs.length, amount: evs[0] && evs[0].amount }; })()`);
  // ceil((3 + mag 8) * 1.5) = ceil(16.5) = 17
  check(heal.n > 0 && heal.amount === 17, `圣杯治疗量 x1.5 (${JSON.stringify(heal)}, want 17)`);

  // 7. 胜利后传说刷新
  await evaljs(`window.__tactics.win()`);
  await sleep(500);
  await nav(`${BASE}?map=rm004&debug=army`);
  await sleep(800);
  await evaljs(`document.querySelector('.au-tab[data-tab="recruit"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  const leg3 = await evaljs(`(() => { const r = document.querySelector('.au-legend-row');
    return r ? r.textContent : ''; })()`);
  check(leg3 && !leg3.includes('已加入') && leg3 !== legSig, `胜利后传说刷新 (${leg3.slice(0, 40)}…)`);

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
