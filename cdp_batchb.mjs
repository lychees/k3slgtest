// CDP 批次 B 端到端: 标题页 -> 选关 -> B0 原地待机 -> 置胜(金币/通关记录)
// -> 商店购买/招募 -> seize 占领胜利 -> survive 坚守胜利 -> 领主判负 -> 设置生效
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9347;
const BASE = 'http://localhost:8931/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-profile17',
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
async function skipIntroAndBanner() {
  await realClick(500, 300);   // skip intro
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const st = await evaljs(`(() => { const T = window.__tactics;
      return T && T.state.phase === 0 &&
        getComputedStyle(document.getElementById('phase-banner')).display === 'none' &&
        document.getElementById('intro-banner').style.display !== 'flex'; })()`);
    if (st) return true;
  }
  return false;
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
  writeFileSync(`D:/dev/k3/zq/verify14_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify14_${name}.png`);
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

  // 选 seize/survive 测试图
  const cat = await (await fetch('http://localhost:8931/data/rm/catalog.json')).json();
  const seizeMap = cat.find(e => e.order % 3 === 0).id;
  const surviveMap = cat.find(e => e.order % 5 === 0 && e.order % 3 !== 0).id;
  console.log('seize map:', seizeMap, '/ survive map:', surviveMap);

  // 1. 标题画面
  await nav(BASE, 3000);
  await evaljs(`localStorage.clear()`);
  await nav(BASE, 3000);
  check(await evaljs(`getComputedStyle(document.getElementById('title-ui')).display`) === 'flex', '标题画面出现');
  check(await evaljs(`document.getElementById('ti-continue').style.display`) === 'none', '无存档时无「继续战役」');
  await shot('title');

  // 2. 标题 -> 选关 -> Chapter 1
  await evaljs(`document.getElementById('ti-select').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(800);
  check(await evaljs(`getComputedStyle(document.getElementById('level-select')).display`) === 'flex', '标题->选关');
  await evaljs(`(() => {
    const it = [...document.querySelectorAll('#ls-list .ls-item')]
      .find(d => d.querySelector('span').textContent.includes('Chapter 1: Rebellion'));
    it.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (await evaljs(`document.getElementById('story-ui').style.display === 'block'`)) {
      await evaljs(`document.getElementById('story-skip').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
      break;
    }
  }
  check(await skipIntroAndBanner(), '进图就绪 (rm004)');

  // 3. B0: 原地待机 — 选中泽洛斯后点自己格 -> 动作菜单
  await clickTile(4, 16);
  await sleep(300);
  check(await evaljs(`(window.__tactics.state.selected || {}).template?.id`) === 'zelos_guard', '选中泽洛斯');
  await clickTile(4, 16);
  await sleep(300);
  const menuItems = await evaljs(`[...document.querySelectorAll('#action-menu .item')].map(i => i.textContent)`);
  check(menuItems.some(t => t.includes('待机')) && menuItems.some(t => t.includes('取消')),
    `B0 原地菜单 (${JSON.stringify(menuItems)})`);
  await clickMenuItem('取消');
  await sleep(300);

  // 4. 置胜: 金币/科技点/通关记录/横幅
  check((await armyState()).gold === 2000, '初始金币 2000');
  await evaljs(`window.__tactics.win()`);
  await sleep(600);
  check(await evaljs(`document.getElementById('end-banner').style.display`) === 'flex', '胜利横幅');
  check((await evaljs(`document.querySelector('#end-banner .end-hint').textContent`)).includes('+1000 金币'), '横幅显示 +1000 金币');
  const a1 = await armyState();
  check(a1.gold === 3000, `金币 2000->${a1.gold}`);
  check(a1.techPoints === 5, `科技点 +5 (${a1.techPoints})`);
  check(await evaljs(`JSON.parse(localStorage.getItem('sow_cleared') || '[]').includes('rm004')`), '通关记录写入 rm004');

  // 5. 胜利 -> 整备: 商店购买 + 招募
  await evaljs(`document.getElementById('end-army').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(1200);
  check(await evaljs(`getComputedStyle(document.getElementById('army-ui')).display`) === 'flex', '胜利后进整备');
  // 商店
  await evaljs(`document.querySelector('.au-tab[data-tab="shop"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await shot('shop');
  const invBefore = (await armyState()).inventory.length;
  await evaljs(`(() => {
    const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('勇气战旗'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  const a2 = await armyState();
  check(a2.gold === 1500 && a2.inventory.length === invBefore + 1, `商店购买勇气战旗 (金币->${a2.gold}, 库存 ${a2.inventory.length})`);
  // 招募
  await evaljs(`document.querySelector('.au-tab[data-tab="recruit"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(400);
  await shot('recruit');
  const unitsBefore = Object.keys((await armyState()).units).length;
  await evaljs(`(() => {
    const row = [...document.querySelectorAll('#au-body .au-row')].find(r => r.textContent.includes('士兵'));
    row.querySelector('.au-btn:not(.disabled)').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await sleep(300);
  const a3 = await armyState();
  check(a3.gold === 1000 && Object.keys(a3.units).length === unitsBefore + 1, `招募士兵 (金币->${a3.gold}, 单位+1)`);
  await evaljs(`document.querySelector('.au-close').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(2500);   // 胜利后关闭整备 -> 回标题

  // 6. seize: 传送泽洛斯到占领点 -> 点自己 -> 占领 -> 胜利
  await nav(`${BASE}?map=${seizeMap}&nostory=1`);
  check(await skipIntroAndBanner(), `进图就绪 (${seizeMap})`);
  const sp = await evaljs(`window.__tactics.realMap().mapMeta.seizePoint`);
  check(!!sp, `占领点存在 (${sp && sp.x},${sp && sp.y})`);
  await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    z.setPos(${sp.x}, ${sp.y}); })()`);
  await cursorTo(sp.x, sp.y);
  await settleCam();
  await shot('seize');
  await clickTile(sp.x, sp.y);
  await sleep(300);
  await clickTile(sp.x, sp.y);   // B0: 点自己开菜单
  await sleep(300);
  check((await evaljs(`[...document.querySelectorAll('#action-menu .item')].map(i => i.textContent)`)).some(t => t.includes('占领')), '菜单含「占领」');
  check(await clickMenuItem('占领'), '点占领');
  await sleep(600);
  check(await evaljs(`window.__tactics.state.over && document.getElementById('end-banner').classList.contains('win')`), 'seize 占领胜利');

  // 7. survive: turn=8 结束回合 -> turn 9 -> 胜利
  await nav(`${BASE}?map=${surviveMap}&nostory=1`);
  check(await skipIntroAndBanner(), `进图就绪 (${surviveMap})`);
  check((await evaljs(`document.getElementById('phase-name').textContent`)).includes('坚守'), '回合面板显示坚守');
  await evaljs(`window.__tactics.state.turn = 8`);
  await evaljs(`window.__tactics.state.turn`);   // noop
  await endPhase();
  let survWin = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    // 战斗中按键加速
    if (await evaljs(`window.__tactics.state.battle`)) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ' });
    }
    if (await evaljs(`window.__tactics.state.over`)) { survWin = true; break; }
  }
  check(survWin, 'survive 坚守 8 回合胜利');

  // 8. 领主队灭判负
  await nav(`${BASE}?map=rm004&nostory=1`);
  check(await skipIntroAndBanner(), '进图就绪 (判负测试)');
  await evaljs(`(() => { const T = window.__tactics;
    const z = T.squads().find(s => s.template.id === 'zelos_guard');
    z.members.forEach(m => { m.hp = 0; m.alive = false; });
    T.checkEnd(); })()`);
  await sleep(400);
  check(await evaljs(`window.__tactics.state.over && document.getElementById('end-banner').classList.contains('lose')`), '泽洛斯队灭判负');

  // 9. 设置: 音量/速度/动画
  await nav(BASE, 3000);
  await evaljs(`document.getElementById('ti-settings').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(500);
  check(await evaljs(`getComputedStyle(document.getElementById('settings-ui')).display`) === 'flex', '设置层打开');
  await evaljs(`(() => { const v = document.getElementById('st-vol');
    v.value = 30; v.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  check((await evaljs(`localStorage.getItem('sow_volume')`)) === '0.3', '音量设置生效 (0.3)');
  await evaljs(`document.getElementById('st-speed').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check((await evaljs(`localStorage.getItem('sow_battlespeed')`)) === '2', '战斗速度=快速');
  await evaljs(`document.getElementById('st-anim').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check((await evaljs(`localStorage.getItem('sow_battleanim')`)) === '0', '战斗动画=关');
  await shot('settings');

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
