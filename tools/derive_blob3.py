# 最终推导: 规则=同表同块, 越界=同类, 不跨层 -> 输出 blob 表 + 瀑布映射 + 回放验证
import json, glob
from collections import Counter, defaultdict

def ainfo(tid):
    if 0x800 <= tid < 0xB00:
        t = tid - 0x800
        return ('A1', t // 48, t % 48)
    if 0xB00 <= tid < 0x1100:
        t = tid - 0xB00
        return ('A2', t // 48, t % 48)
    return None

WATERFALL = {5, 7, 9, 11, 13, 15}
SIDES = [(0, -1, 0), (1, 0, 1), (0, 1, 2), (-1, 0, 3)]
CORNERS = [(4, 0, 1, 1, -1), (5, 2, 1, 1, 1), (6, 2, 3, -1, 1), (7, 0, 3, -1, -1)]

votes = defaultdict(Counter)
wf_votes = defaultdict(Counter)   # (left_same, right_same) -> Counter(pattern)

maps = []
for fn in sorted(glob.glob('data/rm/rm*.json')):
    m = json.load(open(fn, encoding='utf-8'))
    maps.append(m)
    Wd, Hd = m['data']['x'], m['data']['y']
    data = m['data']['data']
    for z in (0, 1):
        def at(x, y):
            if x < 0 or y < 0 or x >= Wd or y >= Hd:
                return 'EDGE'
            return ainfo(data[x + y * Wd + z * Wd * Hd])
        for y in range(Hd):
            for x in range(Wd):
                a = at(x, y)
                if a is None or a == 'EDGE':
                    continue
                def issame(b, aa=a):
                    if b == 'EDGE':
                        return True
                    return bool(b) and b[0] == aa[0] and b[1] == aa[1]
                if a[0] == 'A1' and a[1] in WATERFALL:
                    key = (1 if issame(at(x - 1, y)) else 0, 1 if issame(at(x + 1, y)) else 0)
                    wf_votes[key][a[2]] += 1
                    continue
                sides = {bit: issame(at(x + dx, y + dy)) for dx, dy, bit in SIDES}
                mask = 0
                for bit, v in sides.items():
                    if v:
                        mask |= 1 << bit
                for cbit, b1, b2, dx, dy in CORNERS:
                    if sides[b1] and sides[b2] and issame(at(x + dx, y + dy)):
                        mask |= 1 << cbit
                votes[mask][a[2]] += 1

BLOB = {k: c.most_common(1)[0][0] for k, c in votes.items()}
print('覆盖掩码数:', len(BLOB))
for k in sorted(BLOB):
    c = votes[k]
    s = sum(c.values())
    print('  mask %3d -> pattern %2d  (n=%d, top=%.1f%%)' % (k, BLOB[k], s, c.most_common(1)[0][1] / s * 100))

WF = {k: c.most_common(1)[0][0] for k, c in wf_votes.items()}
print('瀑布 (left,right) -> pattern:', WF, {k: dict(c) for k, c in wf_votes.items()})

# 回放验证: 用推导表重算每个 autotile 的模式, 与烘焙值对比
ok = bad = 0
for m in maps:
    Wd, Hd = m['data']['x'], m['data']['y']
    data = m['data']['data']
    for z in (0, 1):
        def at(x, y):
            if x < 0 or y < 0 or x >= Wd or y >= Hd:
                return 'EDGE'
            return ainfo(data[x + y * Wd + z * Wd * Hd])
        for y in range(Hd):
            for x in range(Wd):
                a = at(x, y)
                if a is None or a == 'EDGE' or (a[0] == 'A1' and a[1] in WATERFALL):
                    continue
                def issame(b, aa=a):
                    if b == 'EDGE':
                        return True
                    return bool(b) and b[0] == aa[0] and b[1] == aa[1]
                sides = {bit: issame(at(x + dx, y + dy)) for dx, dy, bit in SIDES}
                mask = 0
                for bit, v in sides.items():
                    if v:
                        mask |= 1 << bit
                for cbit, b1, b2, dx, dy in CORNERS:
                    if sides[b1] and sides[b2] and issame(at(x + dx, y + dy)):
                        mask |= 1 << cbit
                if BLOB.get(mask) == a[2]:
                    ok += 1
                else:
                    bad += 1
print('回放: ok=%d bad=%d (%.2f%% 一致)' % (ok, bad, ok / (ok + bad) * 100))

# 生成 JS 模块
arr = []
for mask in range(256):
    if mask in BLOB:
        arr.append(BLOB[mask])
    else:
        # 非法掩码(角位缺边): 剥掉非法角位后查表
        m2 = mask
        for cbit, b1, b2 in ((4, 0, 1), (5, 2, 1), (6, 2, 3), (7, 0, 3)):
            if (m2 >> cbit) & 1 and not ((m2 >> b1) & 1 and (m2 >> b2) & 1):
                m2 &= ~(1 << cbit)
        arr.append(BLOB.get(m2, 0))
js = '// blob47.js — VX Ace autotile 47 模式 blob 表 (掩码 -> 模式索引)\n'
js += '// 从 data/rm/*.json (209 张原版地图) 反推并回放验证; 规则: 同表同块为同类, 越界视为同类\n'
js += '// 掩码位: 0=N 1=E 2=S 3=W 4=NE 5=SE 6=SW 7=NW (角仅当相邻两边同类时置位)\n'
js += 'export const BLOB47 = ' + json.dumps(arr) + ';\n'
js += '// 瀑布: 仅看左右同类 -> 模式 (0=独立 1=右连 2=左连 3=左右连), 键 = left*1+right*2\n'
wf_arr = [WF.get((1, 0), 0) and WF.get((1, 0), 0), 0, 0, 0]
wf_map = {0: WF.get((0, 0), 0), 1: WF.get((1, 0), 0), 2: WF.get((0, 1), 0), 3: WF.get((1, 1), 0)}
js += 'export const WF_PATTERN = ' + json.dumps([wf_map[i] for i in range(4)]) + ';\n'
open('js/editor/blob47.js', 'w', encoding='utf-8').write(js)
print('已写出 js/editor/blob47.js')
