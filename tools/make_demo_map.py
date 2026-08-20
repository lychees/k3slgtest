# 生成演示用真实模式地图 data/maps/rx_demo.json (World_Grasslands: 草地+湖泊+深水+树木)
import json, re

BLOB47 = json.loads(re.search(r'BLOB47 = (\[.*?\]);', open('js/editor/blob47.js', encoding='utf-8').read()).group(1))
W, H = 24, 16
A2_GRASS = 0xB00 + 2 * 48
A1_WATER = 0x800 + 0 * 48
A1_DEEP = 0x800 + 4 * 48

def auto_info(t):
    if 0x800 <= t < 0xB00: return ('A1', (t - 0x800) // 48)
    if 0xB00 <= t < 0x1100: return ('A2', (t - 0xB00) // 48)
    return None

def pattern_at(z0, x, y):
    a = auto_info(z0[y * W + x])
    if not a: return -1
    def same(nx, ny):
        if nx < 0 or ny < 0 or nx >= W or ny >= H: return True
        b = auto_info(z0[ny * W + nx])
        return bool(b) and b == a
    n, e, s, w = same(x, y-1), same(x+1, y), same(x, y+1), same(x-1, y)
    mask = (1 if n else 0) | (2 if e else 0) | (4 if s else 0) | (8 if w else 0)
    if n and e and same(x+1, y-1): mask |= 16
    if s and e and same(x+1, y+1): mask |= 32
    if s and w and same(x-1, y+1): mask |= 64
    if n and w and same(x-1, y-1): mask |= 128
    return BLOB47[mask]

def paint(z0, x, y, base):
    z0[y * W + x] = base
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H:
                a = auto_info(z0[ny * W + nx])
                if a:
                    b = (0x800 if a[0] == 'A1' else 0xB00) + a[1] * 48
                    z0[ny * W + nx] = b + pattern_at(z0, nx, ny)

z0 = [A2_GRASS] * (W * H)   # 全草地 (全同类 -> 模式 0)

lake = [(8, 5), (9, 5), (10, 5), (11, 5), (12, 5),
        (7, 6), (8, 6), (9, 6), (10, 6), (11, 6), (12, 6), (13, 6),
        (7, 7), (8, 7), (9, 7), (10, 7), (11, 7), (12, 7), (13, 7),
        (8, 8), (9, 8), (10, 8), (11, 8), (12, 8),
        (9, 9), (10, 9), (11, 9)]
deep = [(9, 6), (10, 6), (10, 7), (9, 7), (10, 8)]
for x, y in lake: paint(z0, x, y, A1_WATER)
for x, y in deep: paint(z0, x, y, A1_DEEP)
# 一条河从湖向南
for y in range(10, 16): paint(z0, 10, y, A1_WATER)

z2 = [0] * (W * H)
for x, y, t in [(3, 3, 0x80), (4, 3, 0x81), (3, 4, 0x09), (16, 4, 0x22), (17, 4, 0x23),
                (16, 5, 0x1a), (20, 10, 0x168), (5, 12, 0x1b), (19, 3, 0x2ba)]:
    z2[y * W + x] = t

m = {
    'id': 'rx_demo', 'name': '真实模式演示 湖畔', 'cols': W, 'rows': H,
    'format': 'vxace', 'tileset_id': 2,
    'layers': {'z0': z0, 'z1': [0] * (W * H), 'z2': z2},
    'squads': [
        {'ref': 'zelos_guard', 'x': 4, 'y': 12, 'team': 0},
        {'ref': 'diana_squad', 'x': 3, 'y': 13, 'team': 0},
        {'ref': 'risen_pack', 'x': 18, 'y': 6, 'team': 1},
        {'ref': 'risen_elite', 'x': 20, 'y': 5, 'team': 1},
    ],
    'objective': {'type': 'seize'},
    'seizePoint': {'x': 19, 'y': 2},
    'intro': '演示: 真实 tileset 模式绘制的湖畔战场。',
}
json.dump(m, open('data/maps/rx_demo.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('written data/maps/rx_demo.json')
