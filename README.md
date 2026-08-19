# K3 SLG Test

Symphony of War 风格小队制战棋 demo（Three.js + 原版素材，VX Ace autotile 正确渲染）。

- **游戏**: [index.html](https://lychees.github.io/k3slgtest/) — `?map=rm004` 真实地图模式 / 默认 ch1 手绘模式
- **编辑器**: [editor.html](https://lychees.github.io/k3slgtest/editor.html) — 关卡/部队/单位/技能/物品编辑器（GitHub Pages 上「保存到服务器」不可用，请用「下载 JSON」）

## 本地运行

```bash
python server.py 8931
# 游戏 http://localhost:8931/index.html  编辑器 http://localhost:8931/editor.html
```

## 文档

- `SPEC.md` — 架构与数据规范
- `VXACE_ASSETS.md` — RPG Maker VX Ace 素材使用规则（依据 mkxp-z 源码整理）

## 测试

```bash
node test_logic.mjs   # 战斗/寻路/AI 逻辑测试
```
