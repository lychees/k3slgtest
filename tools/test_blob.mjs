// blob-47 模式计算测试: node tools/test_blob.mjs
// 期望模式值来自 209 张原版地图反推的 BLOB47 表 (derive_blob3.py 回放一致率 96.3%)。
import { BLOB47, WF_PATTERN } from '../js/editor/blob47.js';
import { autoInfo, autoBase, patternAt, paintAuto, eraseAuto } from '../js/editor/vxauto.js';

const W = 9, H = 9;
const WATER = autoBase('A1', 0);   // 0x800
const GRASS = autoBase('A2', 0);   // 0xB00
let failed = 0;

function blank(fill = 0) { return new Array(W * H).fill(fill); }
function pat(z0, x, y) { return patternAt(z0, x, y, W, H); }
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got=${got} want=${want}`);
}

// 掩码->模式 直接抽查 (推导表的关键锚点)
check('mask 255 (全包围) -> 0', BLOB47[255], 0);
check('mask 0 (孤岛) -> 46', BLOB47[0], 46);
check('mask 10 (E+W) -> 33', BLOB47[10], 33);
check('mask 3 (N+E) -> 41', BLOB47[3], 41);
check('mask 223 (缺SE角) -> 4', BLOB47[223], 4);

// 1) 直线水面: (2..6, 4)
{
  const z0 = blank();
  for (let x = 2; x <= 6; x++) paintAuto(z0, x, 4, W, H, 'A1', 0);
  check('直线中段 (4,4): E+W -> 33', pat(z0, 4, 4), 33);
  check('直线左端 (2,4): E   -> 43', pat(z0, 2, 4), 43);
  check('直线右端 (6,4): W   -> 45', pat(z0, 6, 4), 45);
  check('直线写入的是 A1 基址', autoInfo(z0[4 * W + 4]).block, 0);
}

// 2) 拐角 L 形: 竖 (4,2..4) + 横 (4..6,4)
{
  const z0 = blank();
  for (const [x, y] of [[4, 2], [4, 3], [4, 4], [5, 4], [6, 4]]) paintAuto(z0, x, y, W, H, 'A1', 0);
  check('拐角 (4,4): N+E(NE角无) -> 41', pat(z0, 4, 4), 41);
  check('竖段 (4,3): N+S -> 32', pat(z0, 4, 3), 32);
  check('横段 (5,4): E+W -> 33', pat(z0, 5, 4), 33);
}

// 3) 孤岛: 单格水
{
  const z0 = blank();
  paintAuto(z0, 4, 4, W, H, 'A1', 0);
  check('孤岛 -> 46', pat(z0, 4, 4), 46);
}

// 4) 3x3 水块: 中心全包围, 边中/角各不同
{
  const z0 = blank();
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) paintAuto(z0, x, y, W, H, 'A1', 0);
  check('3x3 中心 -> 0', pat(z0, 4, 4), 0);
  check('3x3 上中: E+S+W +SE/SW角(mask 110) -> 20', pat(z0, 4, 3), BLOB47[110]);
  check('3x3 左上: E+S +SE角(mask 38) -> 34', pat(z0, 3, 3), BLOB47[38]);
  check('掩码110 期望 20', BLOB47[110], 20);
  check('掩码38 期望 34', BLOB47[38], 34);
}

// 5) 内角: 3x3 缺 SE -> 中心 N+E+S+W + NE+SW+NW 角 (mask 223) -> 4
{
  const z0 = blank();
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) if (!(x === 5 && y === 5)) paintAuto(z0, x, y, W, H, 'A1', 0);
  check('内角 (4,4) 缺SE -> 4', pat(z0, 4, 4), 4);
}

// 6) 擦除后邻格回退: 3x3 水块擦掉中心, 四角变内角, 边中变 U 形
{
  const z0 = blank();
  for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) paintAuto(z0, x, y, W, H, 'A1', 0);
  eraseAuto(z0, 4, 4, W, H);
  check('擦除后中心为空', z0[4 * W + 4], 0);
  // 上中 (4,3): E+S+W, S 是空 -> 只剩 E+W + ... S 空了: mask = E|W = 10 -> 33? 不对: S 边为空, 但角 SE/SW 需要 S 边
  check('擦后上中 (4,3): E+W -> 33', pat(z0, 4, 3), 33);
  // 左上 (3,3): E+S 边都在, SE 角 (4,4) 空 -> mask = 2|4 = 6 -> 35
  check('擦后左上 (3,3): E+S 无角 -> 35', pat(z0, 3, 3), 35);
}

// 7) 越界=同类: 贴左边界的格子, W 侧视为同类
{
  const z0 = blank();
  paintAuto(z0, 0, 4, W, H, 'A1', 0);
  // (0,4): W 越界=同类, 其余空 -> mask = 8 -> 45
  check('左边界格: W(越界=同类) -> 45', pat(z0, 0, 4), 45);
}

// 8) 不同块不连通: A2 块0 旁刷 A2 块1, 互不影响
{
  const z0 = blank();
  paintAuto(z0, 3, 4, W, H, 'A2', 0);
  paintAuto(z0, 4, 4, W, H, 'A2', 1);
  check('异块相邻仍各自孤岛 -> 46', pat(z0, 3, 4) === 46 && pat(z0, 4, 4) === 46, true);
}

// 9) 同块才连通: A1 块0 与 A1 块4 相邻互不影响 (浅/深水有岸线)
{
  const z0 = blank();
  paintAuto(z0, 3, 4, W, H, 'A1', 0);
  paintAuto(z0, 4, 4, W, H, 'A1', 4);
  check('异水块相邻各自孤岛 -> 46', pat(z0, 3, 4) === 46 && pat(z0, 4, 4) === 46, true);
}

// 10) 瀑布: 左右连接
{
  const z0 = blank();
  paintAuto(z0, 3, 4, W, H, 'A1', 5);
  paintAuto(z0, 4, 4, W, H, 'A1', 5);
  paintAuto(z0, 5, 4, W, H, 'A1', 5);
  check('瀑布独立 (0,0)->3', WF_PATTERN[0], 3);
  check('瀑布中段 左右连 -> 0', pat(z0, 4, 4), 0);
  check('瀑布左端 右连 -> 1', pat(z0, 3, 4), 1);
  check('瀑布右端 左连 -> 2', pat(z0, 5, 4), 2);
}

// 11) 刷写后整层 tileID 基址正确 (A2 块3)
{
  const z0 = blank();
  paintAuto(z0, 4, 4, W, H, 'A2', 3);
  check('A2 块3 孤岛 tileID', z0[4 * W + 4], 0xB00 + 3 * 48 + 46);
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
