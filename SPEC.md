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

### data/maps/<id>.json — 关卡 (vxace 真实 tileset 格式, 编辑器真实模式产出)
```json
{
  "id": "rx1",
  "name": "真实模式示例",
  "cols": 24, "rows": 16,
  "format": "vxace",                        // 判别字段: 有它(或有 layers)即本格式, 无 terrain
  "tileset_id": 2,                          // data/Tilesets.json 下标
  "layers": {
    "z0": [2816, 2816, "..."],              // 地面/水面层: cols*rows 个 tileID (0=空), 行优先 x+y*cols
    "z1": [0, "..."],                       // 第二 A 层 (编辑器暂未用, 保留)
    "z2": [0, "..."]                        // 装饰层: A5/B/C/D/E 单格 tileID
  },
  "squads": [ { "ref": "zelos_guard", "x": 6, "y": 7, "team": 0 } ],
  "objective": { "type": "rout" },
  "seizePoint": { "x": 9, "y": 1 },
  "intro": "……"
}
```
- tileID 编码/autotile 展开规则见 `VXACE_ASSETS.md`；autotile 模式已由编辑器按 blob-47 规则烘焙进 tileID（运行时不做邻接计算）。
- blob 表与刷写算法：`js/editor/blob47.js`（掩码→模式，从 209 张原版地图反推）+ `js/editor/vxauto.js`；同类判定=同表同块，地图越界视为同类。
- 游戏端接入（读 layers + Tilesets.json 渲染，复用 js/game/realmap.js 的图集/展开）由游戏侧协调，编辑器只负责产出文件。

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
- 关卡编辑器另有**真实 tileset 模式**: 选 Tilesets.json 的 tileset 新建 vxace 格式地图; 调色板分 A2 地面/A1 水面(含瀑布)/A5/B/C/D/E 七栏并带素材预览; 左键刷、右键擦成 0; autotile 刷写自动按 blob-47 重算 3x3 邻域; A5/B-E 单格刷 z2 层; 支持 `editor.html?map=<id>#map` 直接载入指定地图。
- 单位/技能/物品: 左侧列表 + 右侧表单; 新增/复制/删除。
- 部队编辑器: 3x3 阵型格拖放单位, 选队长, 挂神器。
- 每个编辑器有"导出下载"按钮(JSON.stringify → Blob 下载)兜底。

## 养成系统（新增）

- **单位实例**：战斗成员 = 职业id + 等级 + 经验 + 当前HP。经验：命中+10/击杀+30，100 升级，按 growth% 每项属性独立掷点 +1。
- **转职**：T1 职业 10 级 + 科技"晋升仪式"→ 整备界面可晋升为 promotesTo（T2）。
- **科技树** `data/tech.json`：`{id,name,icon,cost,requires[],effect:{stat,mod},unlockClass,description}`；unlockClass="T2" 特指解锁晋升，其余为职业 id。科技点：胜利 +5、击杀 +1。
- **持久化**：军队状态（单位实例/编队/科技/科技点/神器库存）存 localStorage `sow_army`。

## 随从特性与传说随从（新增）

- `data/traits.json`：`{id,name,icon,rarity(common|rare),effect:{stat,mod},flag,description}`。单位实例创建时随机获得 1 条 common（25% 概率追加第 2 条）；传说随从 2 rare + 1 common。
- 特性效果：stat 修正进 squad.eff()；flag 进部队 flag 并集（技能+特性+神器）。
- items.json 的 artifact 新增 `flag` 字段：move_plus/heal_boost/hit_plus/lifedrain/vanguard/doubles，作为全队 flag 生效。
- **传说随从**：招募 tab 顶部轮换位——随机职业（已解锁 T1）、Lv.8、2 rare + 1 common 特性、2000 金，名字橙色显示；每次战役胜利后刷新候选人。

## 兵种机动与地形（M2/M3 新增）

- units.json 新增字段：`canter`（骑兵系，lord/scout——攻击/待机后可用完剩余移动力再行动一次，路径按实际地形 cost 计）、`flying`（dragon——移动无视地形 cost 恒 1，可穿越水面/墙，可停水面但不可停墙格）。
- 弓手（weapon=bow）最小射程 2：不能攻击相邻 1 格目标（`squad.rangeMin()`，作用于菜单/预测/AI 的目标过滤与攻击范围显示）。
- 地形分类（realmap.js，按决定格 tile 分）：森林（bush flag 或 A2 块 2，回避+10 防御+1）、山地（A2 块 3，回避+20 防御+1 cost 2）、高地（A2 块 7，弓手站上去射程+1，对象 `highGround: true`）、要塞（室内 tileset 的 A4/A5 地板，回避+10 防御+2）、水面（不可通行的 A1 格）/墙（其余不可通行格）。手绘 ch1 的 t/g 字符映射同步。
- 有效射程统一走 `squad.rangeMaxEff(terrainAt)`（高地弓 +1）；地形回避经 `ctx.terrainAvo` 已进入命中公式与预测面板。
- V 键切换敌方危险范围覆盖层（全部敌部队移动+攻击并集，淡红）；选中时自动隐藏，敌方回合自动关闭。

## 武器槽 / 自定义地图 / 竞技场（收尾包 C 新增）

- **武器槽**：单位实例新增 `weapon` 字段 (item id, null=职业默认)；武器库存 `weaponStock: {id: 数量}`。装备/购买扣库存，卸下回库存；职业武器类型必须匹配 (`item.weapon === def.weapon`)。老存档实例按 squads.json `weapon_items` 映射补发。转职后类型不匹配自动卸下。战斗成员武器在 boot 时从实例构建，类型不匹配防呆回退职业默认。
- **自定义地图**：编辑器产出 `data/maps/<id>.json` (`format:'vxace'`, tileset_id, cols, rows, layers{z0,z1,z2}, squads, objective, seizePoint?, name?, intro?)。boot 时由 `realmap.loadCustomMap` 加载 (无 z3 阴影层)；无 squads 时自动摆位。选关界面「自定义」组来自 server.py `/api/list?dir=data/maps` (静态托管无此 API 时静默跳过)。
- **竞技场** (整备 tab)：报名费 200 金, 3 波连战 (fort 主题, 一波打到分出胜负), 敌等级 = 玩家平均等级 +0/+1/+2 (扁平加成)。每胜一场 +300 金 +全员 30 经验, 全胜 +1 科技点。不致命: 0 HP 成员留 1 HP。成员 HP 写回实例。

## Boss / 章节挑战 / 战中事件（收尾包 D 新增）

- **Boss**：units.json 的 `boss: true` 职业（warlord/archfiend/wyrm，另有 `fixedTraits` 固定特性 2 条）+ squads.json 的 boss_* 部队模板。order 每 10 的倍数章：自动摆位最强敌军替换为 Boss 队（按 order/10-1 轮换三 Boss），mapMeta.bossName 驱动开场横幅「Boss：xxx」。`squad.isBoss` = 成员含 boss 职业；详情页 Boss 职业名金色、威胁度红色。Boss 队全灭 → +500 金 + 随机神器进库存，胜利横幅「Boss 讨伐！」。
- **章节挑战目标**（mapMeta.bonus）：Boss 章=击杀 Boss；其余按 order%3 轮换（0=10 回合内获胜 / 1=无部队阵亡 / 2=seize 图 5 回合内占领否则 10 回合内）。回合面板下方小字显示；达成 +300 金，胜利横幅「★ 挑战达成」。`sow_cleared` 改为 {id:{done,bonus}}（旧数组格式自动迁移），选关 ✓ 金=挑战达成、灰=仅通关。
- **战中事件**：第 2 回合玩家阶段，剧情行 >12 的章播放第 9-12 行（#interlude 半屏对话条，非阻塞，点击关闭）。seize/survive 图第 3 回合敌方阶段刷 1 支 risen_pack（北半随机可通行格，smack.wav，横幅「敌方增援！」）。
