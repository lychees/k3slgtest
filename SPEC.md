# SoW Tactics — 架构与数据规范

Three.js 复刻 Symphony of War 小队制战棋玩法 + 编辑器套件。
所有内容数据驱动：`data/*.json` 是唯一事实来源，游戏与编辑器都读写它们。

## 运行

```bash
cd fe-tactics && python server.py [port]   # 默认 8931
# 游戏:   http://localhost:8931/index.html
# 编辑器: http://localhost:8931/editor.html
```

`server.py` = 静态文件服务 + `POST /api/save?path=data/xxx.json`（ body 为 JSON，写盘，仅限 data/ 目录）。

## 文件结构

```
fe-tactics/
  server.py
  index.html          # 游戏
  main.js             # 游戏入口(Three.js 场景/渲染)
  js/game/            # 游戏逻辑模块
  editor.html         # 编辑器(单页, tab 切换)
  js/editor/          # 编辑器模块
  data/
    units.json        # 单位(职业)定义
    squads.json       # 部队模板
    skills.json       # 技能/特性
    items.json        # 武器/神器
    terrains.json     # 地形定义
    maps/<id>.json    # 关卡
  assets/             # 从原版提取的 PNG/字体
```

## 数据规范

### data/units.json — 单位(职业)
```json
{
  "units": [
    {
      "id": "soldier",
      "name": "士兵",
      "tier": 1,
      "sprite": "unit_soldier_blue",        // assets/ 下的 32x32 PNG(不带扩展名)
      "portrait": "large_portrait_lysander",
      "weapon": "lance",                     // sword/axe/lance/bow/fire/ice/lightning/heal/gun/claw
      "base":  { "hp": 24, "str": 8, "mag": 0, "skl": 7, "arm": 4, "ldr": 0, "mov": 5 },
      "growth":{ "hp": 60, "str": 40, "mag": 0, "skl": 35, "arm": 20, "ldr": 0 },
      "attackType": "frontline",             // frontline(打对面前排) / any(任意目标) / heal(治疗己方) / aoe(全体)
      "attacks": 1,                          // 每场战斗出手次数
      "skills": ["discipline"],
      "promotesTo": "centurion"
    }
  ]
}
```

### data/skills.json — 技能/特性
```json
{
  "skills": [
    {
      "id": "discipline",
      "name": "纪律",
      "icon": "tech_1",                     // Graphics/System/tech_N.png 拷贝进 assets/
      "type": "passive",                    // passive=常驻属性 aura=全队光环 combat=战斗触发
      "target": "self",                     // self / squad / allies_adjacent
      "effect": { "stat": "skl", "mod": 2 },// 属性修正; 特殊效果用 flag 字段
      "flag": "",                           // 例: "doubles"=追击 "vanguard"=先攻 "healer"=可治疗
      "description": "技巧 +2。"
    }
  ]
}
```

### data/items.json — 物品
```json
{
  "items": [
    {
      "id": "iron_sword",
      "name": "铁剑",
      "type": "weapon",                     // weapon=武器(装备到单位) artifact=神器(装备到部队格)
      "weapon": "sword",
      "might": 5, "hit": 90, "crit": 0, "range": 1, "price": 520,
      "bonuses": { "str": 0 },              // artifact 用: 部队属性加成
      "description": "标准的铁制长剑。"
    }
  ]
}
```

### data/terrains.json — 地形
```json
{
  "terrains": [
    { "id": "plain", "char": ".", "name": "平原", "avo": 0,  "def": 0, "cost": 1, "pass": true,  "tile": "tile_grass" },
    { "id": "water", "char": "w", "name": "河流", "avo": 0,  "def": 0, "cost": 99,"pass": false, "tile": "tile_water" }
  ]
}
```
地图字符串里的每个字符对应一个 terrain.char。

### data/squads.json — 部队模板
```json
{
  "squads": [
    {
      "id": "zelos_guard",
      "name": "泽洛斯亲卫队",
      "leader": "cavalier",                 // units.json 的 id, 领导提供 LDR 决定容量
      "members": [
        { "unit": "cavalier", "slot": 4 },  // slot: 0-8, 3x3 阵型(0=左上,4=中心,8=右下)
        { "unit": "soldier",  "slot": 1 }
      ],
      "artifacts": ["banner_of_valor"],     // items.json 中 type=artifact
      "weapon_items": { "cavalier": "iron_lance" }  // 单位id -> weapon item id (可选)
    }
  ]
}
```

### data/maps/<id>.json — 关卡
```json
{
  "id": "ch1",
  "name": "第一章 边境之火",
  "cols": 20, "rows": 11,
  "terrain": ["....wwww....", "..."],       // rows 个字符串, 每个 cols 字符
  "squads": [
    { "ref": "zelos_guard", "x": 6, "y": 7, "team": 0 },
    { "ref": "risen_pack",  "x": 13, "y": 3, "team": 1 }
  ],
  "objective": { "type": "rout" },          // rout=全歼 seize=占领 seizePoint survive=坚守turns
                                            // type=survive 时附加 "turns": <回合数>, 如 { "type": "survive", "turns": 8 }
  "seizePoint": { "x": 9, "y": 1 },
  "intro": "复生军越过了边境河……"
}
```

## 玩法规则(复刻 SoW 核心)

1. **小队制**: 地图上每个棋子是一支 3x3 阵型的部队(最多 9 人), 显示为九宫格小 sprite。
2. **移动力** = 队长 MOV; 地形消耗按地形表; 穿越敌人不可。
3. **战斗**: 攻击相邻(或射程内)敌部队 → 自动战斗:
   - 存活成员按阵型位置轮流出手(前排先), frontline 打对方前排(1/4/7 列优先), any 随机, heal 治疗己方最低 HP, aoe 打全体。
   - 伤害 = max(1, 攻击方 str/mag + 武器 might - 防御方 arm); 命中 = hit + skl*2 - 对方 skl - 地形 avo。
   - 战斗画面: 左右对冲面板(参考 SoW 分屏), 飘伤害数字。
4. **回合**: 玩家阶段 → 敌方阶段(简单 AI: 向最近敌部队移动并攻击)。全员行动完自动切阶段。
5. **胜负**: objective 达成 → 胜利横幅; 玩家全灭 → 失败。
6. **士气/威胁**: 简化 — 部队面板显示 squad_score(Σ单位战力), 暂不影响数值。

## 编辑器

`editor.html` 单页五 tab: 关卡 / 部队 / 单位 / 技能 / 物品。
- 全部读写 `data/*.json`(fetch GET + POST /api/save)。
- 关卡编辑器: 画布绘制地形(调色板选地形, 左键刷, 右键擦除为平原), 点击放置/移动部队, 设置目标点, 保存为 data/maps/<id>.json。
- 单位/技能/物品: 左侧列表 + 右侧表单; 新增/复制/删除。
- 部队编辑器: 3x3 阵型格拖放单位, 选队长, 挂神器。
- 每个编辑器有"导出下载"按钮(JSON.stringify → Blob 下载)兜底。
