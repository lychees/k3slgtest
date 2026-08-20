// 真实模式刷写 E2E: 选 A1 水面刷 -> 在草地刷一块池塘 -> 右键擦一格 -> 截图 + 断言 tileID
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9356;
const URL = 'http://localhost:8931/editor.html?map=rx_demo#map';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp2-editpaint',
  '--window-size=1280,800', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const errs = [];
function send(method, params = {}) {
  return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function mouse(type, x, y, button = 'left', buttons = 1) {
  await send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 });
}
const R = [];
const check = (cond, msg) => { R.push(`${cond ? 'OK' : 'FAIL'} ${msg}`); console.log(R[R.length - 1]); };

async function main() {
  let targets = null;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {}
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown')
      errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(9000);

  // 切到 水面A1 调色板页并选第一个水面块
  await evaljs(`[...document.querySelectorAll('#page-map button')].find(b => b.dataset.tab === 'A1').click()`);
  await sleep(300);
  // 调色板面板 = 有 canvas 的那个 (布局可能变化, 不写死序号)
  await evaljs(`[...document.querySelectorAll('#page-map .panel')].find(p => p.querySelectorAll('canvas').length > 0).querySelectorAll('canvas')[0].click()`);
  await sleep(300);
  const brushInfo = await evaljs(`[...document.querySelectorAll('#page-map div')].map(d => d.textContent).find(t => /^A1 水面块/.test(t)) || ''`);
  check(/A1 水面块 0/.test(brushInfo), `选中水面块: ${brushInfo}`);

  // 在草地 (18,11)-(21,13) 区域刷 3x3 池塘
  const rect = await evaljs(`(() => { const r = document.getElementById('map-canvas').getBoundingClientRect(); return { left: r.left, top: r.top }; })()`);
  const px = (cx, cy) => ({ x: rect.left + cx * 32 + 16, y: rect.top + cy * 32 + 16 });
  const p0 = px(18, 11);
  await mouse('mousePressed', p0.x, p0.y);
  for (const [cx, cy] of [[19, 11], [20, 11], [20, 12], [20, 13], [19, 13], [18, 13], [18, 12], [19, 12]]) {
    const p = px(cx, cy);
    await mouse('mouseMoved', p.x, p.y, 'left', 1);
    await sleep(30);
  }
  await mouse('mouseReleased', p0.x, p0.y);
  await sleep(300);

  // 断言: 中心 (19,12) 全包围 -> tileID 0x800+0; 角 (18,11) -> 0x800+34
  // 模块内 map 不可直接读, 用 mousemove 触发 infoLine 显示 z0/z2 来验证
  async function tidAt(cx, cy) {
    const p = px(cx, cy);
    await mouse('mouseMoved', p.x, p.y, 'none', 0);
    await sleep(60);
    const info = await evaljs(`[...document.querySelectorAll('#page-map span')].map(s => s.textContent).find(t => /z0=0x/.test(t)) || ''`);
    const m = info.match(/z0=0x([0-9a-f]+)/);
    return m ? parseInt(m[1], 16) : -1;
  }
  const center = await tidAt(19, 12);
  check(center === 0x800, `池塘中心 tileID=0x${center.toString(16)} (期望 0x800 模式0)`);
  const corner = await tidAt(18, 11);
  check(corner === 0x800 + 34, `池塘左上 tileID=0x${corner.toString(16)} (期望 0x${(0x800 + 34).toString(16)} 模式34)`);
  const edgeMid = await tidAt(19, 11);
  check(edgeMid === 0x800 + 20, `池塘上中 tileID=0x${edgeMid.toString(16)} (期望 0x${(0x800 + 20).toString(16)} 模式20)`);

  // 右键擦除中心 -> 邻格回退
  const pc = px(19, 12);
  await mouse('mousePressed', pc.x, pc.y, 'right', 2);
  await mouse('mouseReleased', pc.x, pc.y, 'right', 2);
  await sleep(200);
  const erased = await tidAt(19, 12);
  check(erased === 0, `擦除后中心 tileID=${erased} (期望 0)`);
  const afterErase = await tidAt(19, 11);
  check(afterErase === 0x800 + 33, `擦后上中 tileID=0x${afterErase.toString(16)} (期望 0x${(0x800 + 33).toString(16)} 模式33)`);

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync('D:/dev/k3/zq/verify17_paint.png', Buffer.from(shot.data, 'base64'));
  check(errs.length === 0, `无 JS 异常 (${errs.length})`);
  errs.forEach(e => console.log('  ERR:', e));
  console.log(R.every(x => x.startsWith('OK')) ? '全部通过' : '有失败项');
  chrome.kill();
  process.exit(R.every(x => x.startsWith('OK')) ? 0 : 1);
}
main();
