// CDP 全回合流程测试: rm004 真实浏览器, 真实鼠标事件
// 三支玩家部队各移动+待机 -> 敌方阶段(含战斗) -> 第二回合再移动 zelos
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const URL = 'http://localhost:8931/index.html?map=rm004';
const SHOT = process.argv[2] || 'D:/dev/k3/zq/verify7_cdp_turn.png';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile2',
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
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
// 用 __tactics 读取相机, 把 tile 转成 client 坐标
async function tileClient(tx, ty) {
  return evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const vw = 960 / tp, vh = 540 / tp;
    const sx = ((${tx}) - (cam.cx - vw / 2)) * tp, sy = ((${ty}) - (cam.cy - vh / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
}
async function clickTile(tx, ty) { const c = await tileClient(tx, ty); await realClick(c.x, c.y); }
async function clickMenuItem(label) {
  const r = await evaljs(`(() => {
    const items = [...document.querySelectorAll('#action-menu .item')];
    const it = items.find(i => i.textContent.includes('${label}'));
    if (!it) return null;
    const b = it.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (!r) return false;
  await realClick(r.x, r.y);
  return true;
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleErrs.push(text); console.log('CONSOLE ERROR:', text);
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3000);
  await evaljs(`localStorage.removeItem('sow_army')`);   // 清战役存档, 保证默认编队
  await send('Page.navigate', { url: URL });
  await sleep(3000);

  // 跳过 intro, 等阶段横幅
  await realClick(500, 300);
  for (let i = 0; i < 40; i++) {
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
    await sleep(300);
  }
  check(await evaljs(`window.__tactics.state.phase`) === 0, '玩家阶段开始');

  // 回合 1: 三支玩家部队各移动 2 格并待机
  const moves = [ ['zelos_guard', 6, 16], ['diana_squad', 5, 14], ['knight_wall', 8, 17] ];
  for (const [id, dx, dy] of moves) {
    const sq = await evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === '${id}');
      return s ? { x: s.x, y: s.y, done: s.done } : null; })()`);
    check(!!sq, `${id} 存在 @${sq ? sq.x + ',' + sq.y : '?'}`);
    await clickTile(sq.x, sq.y);
    await sleep(300);
    const sel = await evaljs(`(window.__tactics.state.selected || {}).template?.id || null`);
    check(sel === id, `选中 ${id} (实际 ${sel})`);
    // 目标格必须在范围内; 先查
    const inRange = await evaljs(`window.__tactics.state.range.move.has('${dx},${dy}')`);
    check(inRange, `${dx},${dy} 在 ${id} 移动范围内`);
    await clickTile(dx, dy);
    // 等菜单
    let menuUp = false;
    for (let i = 0; i < 30; i++) {
      if (await evaljs(`document.getElementById('action-menu').style.display`) === 'block') { menuUp = true; break; }
      await sleep(200);
    }
    check(menuUp, `${id} 移动完成弹出菜单`);
    check(await clickMenuItem('待机'), `${id} 点待机`);
    await sleep(400);
  }

  // 敌方阶段 (含战斗场景) — 可能十几秒
  console.log('等待敌方阶段...');
  let backToPlayer = false;
  for (let i = 0; i < 120; i++) {
    const st = await evaljs(`({ phase: window.__tactics.state.phase, ai: window.__tactics.state.ai,
      battle: window.__tactics.state.battle, over: window.__tactics.state.over,
      turn: window.__tactics.state.turn, n: window.__tactics.squads().length })`);
    if (i % 10 === 0) console.log('  state:', JSON.stringify(st));
    if (st.over) { console.log('  游戏结束!'); break; }
    if (st.phase === 0 && !st.ai && st.turn === 2) { backToPlayer = true; break; }
    await sleep(500);
  }
  check(backToPlayer, '敌方阶段完成, 回到玩家阶段 turn 2');

  // 等 '玩家阶段' 横幅结束 (bannerBusy 期间输入被锁)
  for (let i = 0; i < 30; i++) {
    if (await evaljs(`getComputedStyle(document.getElementById('phase-banner')).display`) === 'none') break;
    await sleep(300);
  }
  await sleep(300);

  // 回合 2: 再移动 zelos
  const z = await evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === 'zelos_guard');
    return s ? { x: s.x, y: s.y } : null; })()`);
  if (z) {
    await clickTile(z.x, z.y);
    await sleep(300);
    const sel = await evaljs(`(window.__tactics.state.selected || {}).template?.id || null`);
    check(sel === 'zelos_guard', `turn2 选中 zelos (实际 ${sel})`);
    const dest = await evaljs(`(() => {
      const m = window.__tactics.state.range.move;
      const z = { x: ${z.x}, y: ${z.y} };
      let best = null;
      for (const k of m.keys()) { const [x, y] = k.split(',').map(Number);
        if (Math.abs(x - z.x) + Math.abs(y - z.y) === 2 && !window.__tactics.squads().some(s => s.x === x && s.y === y)) { best = [x, y]; break; } }
      return best; })()`);
    if (dest) {
      await clickTile(dest[0], dest[1]);
      let menuUp = false;
      for (let i = 0; i < 30; i++) {
        if (await evaljs(`document.getElementById('action-menu').style.display`) === 'block') { menuUp = true; break; }
        await sleep(200);
      }
      check(menuUp, 'turn2 zelos 移动完成弹出菜单');
      const z2 = await evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === 'zelos_guard'); return [s.x, s.y]; })()`);
      check(z2[0] === dest[0] && z2[1] === dest[1], `turn2 zelos 落点 ${dest} (实际 ${z2})`);
    }
  } else {
    check(false, 'turn2 zelos 已不存在 (被歼灭?)');
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('screenshot ->', SHOT);
  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}

main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
