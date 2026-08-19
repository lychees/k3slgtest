// CDP 过桥测试: rm004 真实浏览器, zelos 两回合走到桥边 -> 上桥 -> 过桥 -> 返回
// 断言逻辑落点 + 截图检查桥上单位的可见性
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const URL = 'http://localhost:8931/index.html?map=rm004&nostory=1';   // nostory: 跳过战前剧情
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile6',
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
// 等相机 lerp 停稳再点 (模拟真人瞄准静止画面; 否则平移途中点击会落错格)
async function settleCam() {
  for (let i = 0; i < 60; i++) {
    const done = await evaljs(`(() => { const c = window.__tactics.cam;
      return Math.abs(c.cx - c.tx) < 0.01 && Math.abs(c.cy - c.ty) < 0.01; })()`);
    if (done) return;
    await sleep(100);
  }
}
async function clickTile(tx, ty, fast = false) {
  if (!fast) await settleCam();
  const c = await evaljs(`(() => {
    const { cam } = window.__tactics;
    const tp = 32 * cam.level;
    const sx = ((${tx}) - (cam.cx - 960 / tp / 2)) * tp, sy = ((${ty}) - (cam.cy - 540 / tp / 2)) * tp;
    const r = document.getElementById('stage').getBoundingClientRect();
    const s = r.width / 960;
    return { x: r.left + (sx + tp / 2) * s, y: r.top + (sy + tp / 2) * s };
  })()`);
  if (fast) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    return;
  }
  await realClick(c.x, c.y);
}
// 双击同一空格结束玩家阶段 (两次 click 需在 450ms 内)
async function doubleClickTile(tx, ty) {
  await clickTile(tx, ty, true);
  await sleep(60);
  await clickTile(tx, ty, true);
}
// 找一个当前视野内的空格并双击它来结束玩家阶段
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
  if (!t) return false;
  await doubleClickTile(t[0], t[1]);
  return true;
}
async function clickMenuItem(label) {
  const r = await evaljs(`(() => {
    const it = [...document.querySelectorAll('#action-menu .item')].find(i => i.textContent.includes('${label}'));
    if (!it) return null;
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
async function waitPlayerTurn(turn) {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await evaljs(`({ phase: window.__tactics.state.phase, ai: window.__tactics.state.ai,
      over: window.__tactics.state.over, turn: window.__tactics.state.turn,
      banner: getComputedStyle(document.getElementById('phase-banner')).display })`);
    if (st.over) return st;
    if (st.phase === 0 && !st.ai && st.turn === turn && st.banner === 'none') return st;
    await sleep(500);
  }
  return null;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`D:/dev/k3/zq/verify8_${name}.png`, Buffer.from(s.data, 'base64'));
  console.log('screenshot ->', `D:/dev/k3/zq/verify8_${name}.png`);
}
const zelos = () => evaljs(`(() => { const s = window.__tactics.squads().find(s => s.template.id === 'zelos_guard');
  return s ? { x: s.x, y: s.y } : null; })()`);
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
  await realClick(500, 300);   // 跳过 intro
  check(await waitPlayerTurn(1) !== null, 'turn 1 玩家阶段就绪');

  // 回合 1: zelos (4,16) -> (10,16) 桥头, 待机; 双击空地结束回合
  await clickTile(4, 16);
  await sleep(300);
  check(await evaljs(`(window.__tactics.state.selected || {}).template?.id`) === 'zelos_guard', '选中 zelos');
  check(await evaljs(`window.__tactics.state.range.move.has('10,16')`), '(10,16) 在范围内');
  await clickTile(10, 16);
  check(await waitMenu(), 'zelos 到桥头弹出菜单');
  await clickMenuItem('待机');
  await sleep(400);
  // 双击视野内空格结束玩家阶段
  await endPhase();
  check(await waitPlayerTurn(2) !== null, '敌方阶段完成, turn 2 就绪');

  // 回合 2: zelos (10,16) -> 上桥 (12,17)
  const z1 = await zelos();
  check(z1 && z1.x === 10 && z1.y === 16, `zelos 在桥头 (实际 ${z1 && z1.x},${z1 && z1.y})`);
  await clickTile(z1.x, z1.y);
  await sleep(300);
  check(await evaljs(`(window.__tactics.state.selected || {}).template?.id`) === 'zelos_guard', 'turn2 选中 zelos');
  const onBridge = await evaljs(`window.__tactics.state.range.move.has('12,17')`);
  const farSide = await evaljs(`window.__tactics.state.range.move.has('13,17')`);
  check(onBridge, '桥甲板 (12,17) 在移动范围内');
  check(farSide, '桥对岸 (13,17) 在移动范围内');
  await clickTile(12, 17);
  check(await waitMenu(), 'zelos 上桥弹出菜单');
  const z2 = await zelos();
  check(z2.x === 12 && z2.y === 17, `zelos 站上桥甲板 (实际 ${z2.x},${z2.y})`);
  const diag = await evaljs(`(() => {
    const { cam, squads } = window.__tactics;
    const z = squads().find(s => s.template.id === 'zelos_guard');
    const cur = document.getElementById('cursor');
    const r = document.getElementById('stage').getBoundingClientRect();
    return { cursor: { left: cur.style.left, top: cur.style.top, display: cur.style.display },
      unitPos: { x: z.group.position.x, y: z.group.position.y },
      unitVisible: z.group.visible && z.mesh.visible,
      groupInScene: !!z.group.parent,
      stageRect: { left: r.left, top: r.top, w: r.width, h: r.height },
      cam: { cx: cam.cx, cy: cam.cy, level: cam.level } };
  })()`);
  console.log('DIAG:', JSON.stringify(diag));
  await shot('on_bridge');   // 检查桥上单位可见性
  // 点待机 (单位留在桥上), 菜单关闭后再截一张
  await clickMenuItem('待机');
  await sleep(400);
  await shot('on_bridge_idle');

  // 回合 3: 从桥上跨到对岸
  await endPhase();
  check(await waitPlayerTurn(3) !== null, 'turn 3 就绪');
  await clickTile(12, 17);
  await sleep(300);
  check(await evaljs(`(window.__tactics.state.selected || {}).template?.id`) === 'zelos_guard', 'turn3 在桥上选中 zelos');
  await clickTile(13, 17);
  check(await waitMenu(), 'zelos 过桥弹出菜单');
  const z3 = await zelos();
  check(z3.x === 13 && z3.y === 17, `zelos 抵达桥对岸 (实际 ${z3.x},${z3.y})`);
  await clickMenuItem('待机');
  await sleep(400);
  await shot('far_side');

  // 回合 4: 从对岸走回来 (验证不会困在桥上)
  await endPhase();
  check(await waitPlayerTurn(4) !== null, 'turn 4 就绪');
  const z4 = await zelos();
  check(z4 && z4.x === 13 && z4.y === 17, `zelos turn4 仍在对岸 (实际 ${z4 && z4.x},${z4 && z4.y})`);
  await clickTile(z4.x, z4.y);
  await sleep(300);
  check(await evaljs(`window.__tactics.state.range.move.has('10,16')`), '回桥头 (10,16) 在范围内');
  await clickTile(10, 16);
  check(await waitMenu(), 'zelos 返回弹出菜单');
  const z5 = await zelos();
  check(z5.x === 10 && z5.y === 16, `zelos 返回桥头 (实际 ${z5.x},${z5.y})`);

  check(consoleErrs.length === 0, `无 JS 报错 (${consoleErrs.length})`);
  const fails = R.filter(x => x.startsWith('FAIL'));
  console.log(fails.length ? `*** ${fails.length} FAIL ***` : 'ALL PASS');
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
