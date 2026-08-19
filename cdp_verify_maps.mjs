// CDP 批量摆位验证: 抽样真实地图, 校验自动摆位
// 断言: 每支部队在可通行格 / 互不重叠 / 敌我在同一连通域 (BFS 可达) / 至少 1v1
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9338;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--use-angle=swiftshader',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/cdp-profile8',
  '--window-size=1000,600', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaljs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

// 页面内验证逻辑 (注入一次, 逐图调用)
const CHECK_FN = `(() => {
  const T = window.__tactics;
  const rm = T.realMap();
  const W = rm.cols, H = rm.rows;
  const pass = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rm.terrainAt(x, y).pass;
  const squads = T.squads().map(s => ({ id: s.template.id, x: s.x, y: s.y, team: s.team }));
  const problems = [];
  if (!squads.some(s => s.team === 0)) problems.push('没有玩家部队');
  if (!squads.some(s => s.team === 1)) problems.push('没有敌方部队');
  const seen = new Set();
  for (const s of squads) {
    if (!pass(s.x, s.y)) problems.push(\`\${s.id}@\${s.x},\${s.y} 不可通行\`);
    const k = s.x + ',' + s.y;
    if (seen.has(k)) problems.push(\'格子重叠 \' + k);
    seen.add(k);
  }
  // BFS: 从第一支玩家部队出发, 所有部队都要可达 (同连通域)
  const start = squads.find(s => s.team === 0);
  if (start) {
    const vis = new Set([start.x + ',' + start.y]);
    const q = [[start.x, start.y]];
    while (q.length) {
      const [cx, cy] = q.pop();
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy, k = nx + ',' + ny;
        if (pass(nx, ny) && !vis.has(k)) { vis.add(k); q.push([nx, ny]); }
      }
    }
    for (const s of squads) {
      if (!vis.has(s.x + ',' + s.y)) problems.push(\`\${s.id}@\${s.x},\${s.y} 与玩家不连通\`);
    }
  }
  return { problems, n: squads.length, players: squads.filter(s => s.team === 0).length,
    enemies: squads.filter(s => s.team === 1).length, name: rm.mapMeta.name };
})()`;

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
  };
  await send('Runtime.enable');
  await send('Page.enable');

  // 抽样: 三张目标图 + 按 order 均匀抽样 + 面积最大/最小
  const cat = await (await fetch('http://localhost:8931/data/rm/catalog.json')).json();
  const byOrder = cat.slice().sort((a, b) => a.order - b.order);
  const picks = new Set([3, 20, 26]);
  for (let i = 0; i < byOrder.length; i += 18) picks.add(byOrder[i].num);
  
  const byArea = cat.slice().sort((a, b) => a.w * a.h - b.w * b.h);
  
  picks.add(byArea[0].num); picks.add(byArea[byArea.length - 1].num);
  const nums = [...picks].sort((a, b) => a - b);
  console.log('验证地图:', nums.join(','));

  let fails = 0;
  for (const num of nums) {
    const id = 'rm' + String(num).padStart(3, '0');
    await send('Page.navigate', { url: `http://localhost:8931/index.html?map=${id}&debug=clean` });
    await sleep(4000);
    let r;
    try {
      r = await evaljs(`(window.__tactics && window.__tactics.realMap()) ? ${CHECK_FN} : null`);
    } catch (e) { r = null; }
    if (!r) { console.log(`FAIL ${id}: 页面未就绪`); fails++; continue; }
    if (r.problems.length) {
      console.log(`FAIL ${id} (${r.name}) P${r.players}/E${r.enemies}: ${r.problems.join('; ')}`);
      fails++;
    } else {
      console.log(`OK   ${id} (${r.name}) P${r.players}/E${r.enemies}`);
    }
  }
  console.log(fails ? `*** ${fails} FAIL ***` : `ALL ${nums.length} MAPS PASS`);
}
main().catch(e => console.error('DRIVER ERROR:', e.message))
  .finally(() => { try { chrome.kill(); } catch {} process.exit(0); });
