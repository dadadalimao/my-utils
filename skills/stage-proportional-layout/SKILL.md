---
name: stage-proportional-layout
description: Builds responsive UI regions that scale like object-fit contain from a fixed design canvas (root, stageContainer, stage). Use when a panel must keep aspect ratio, overlay elements on a background image, or position children by design-draft coordinates without stretching.
---

# 设计稿等比舞台布局（Stage Layout）

## 要解决什么问题

有一块 UI 按**固定宽高比的设计稿**排版（例如 800×600），父容器却是**任意大小**的格子。

目标：

- 整块内容**完整显示**在格子里（类似图片 `object-fit: contain`）
- **不变形**，宽高调窗口时一起缩放
- 卡片、标注等**叠在底图上**，位置跟着舞台走

## 思路（一句话）

外层盒子占满父级 → 中间层铺满 → **舞台**按设计稿比例居中缩放；舞台里的坐标全部用**设计稿像素换算成百分比**。

```
┌─ root（占满父级，可裁切）─────────────┐
│  ┌─ stageContainer（100% 宽高）──┐   │
│  │     ┌─ stage（等比缩放）─┐    │   │
│  │     │  底图 + 叠加层    │    │   │
│  │     └──────────────────┘    │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## 结构（三层，缺一不可）

```html
<div class="root">
  <div class="stage-container">
    <div class="stage">
      <!-- 底图 -->
      <img class="bg" src="..." alt="" />
      <!-- 叠加层：卡片、标签、动效等 -->
      <div class="overlay-layer">...</div>
    </div>
  </div>
</div>
```

| 层 | 作用 |
|----|------|
| **root** | 占满父容器；`overflow: hidden`；外边距、内边距写在这里 |
| **stage-container** | `width/height: 100%`，给舞台提供定位参照 |
| **stage** | 设计稿画布：设 `aspect-ratio`，在容器内居中、等比缩放 |

类名可自定义，只要三层职责对应即可。

## 舞台核心样式

设设计稿宽为 `W`、高为 `H`（单位 px，仅作比例计算）：

```css
.root {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.stage-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.stage {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: 100%;
  margin: auto;
  aspect-ratio: W / H;
  container-type: size;
}
```

**原理**：`width/height: auto` + `max-width/max-height: 100%` + `aspect-ratio` + `margin: auto`，浏览器会选「能放进父级且不裁切」的最大尺寸。

### 常见错误

```css
/* ❌ 只拉高或只拉宽，无法 contain，容易裁切或留白异常 */
.stage {
  height: 100%;
  aspect-ratio: W / H;
}
```

## 子元素怎么摆

### 按设计稿坐标写百分比

设计稿上元素左上角 `(left, top)`，宽 `width`，舞台尺寸 `W × H`：

```css
.item {
  position: absolute;
  top: calc(top / H * 100%);
  left: calc(left / W * 100%);
  width: calc(width / W * 100%);
}
```

**规则**：横向除以 `W`，纵向除以 `H`，再乘 `100%`。子块自身有比例时加 `aspect-ratio`。

### 底图

```css
.bg {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}
```

### 叠加层

```css
.overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.overlay-layer .clickable {
  pointer-events: auto;
}
```

## 舞台内部的细调（可选）

`stage` 设置 `container-type: size` 后，可用容器查询单位：

```css
.gap {
  gap: calc(8 / H * 100cqh);
}
.label {
  max-width: calc(120 / W * 100cqw);
}
```

建议：**位置、大块尺寸**用 `%`（相对 stage）；**字号、小间距**用 `clamp()` 或 `cqw`/`cqh`。

## 父容器要求

父级需能分配高度，且允许子级收缩：

```css
.parent-slot {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

`root` 设 `height: 100%` 才能吃到 grid/flex 分下来的高度。

## 实施检查清单

- [ ] 拆出 root / stage-container / stage 三层
- [ ] stage 的 `aspect-ratio` 与设计稿一致
- [ ] 不用「单轴 100% 高度/宽度」撑满 stage
- [ ] 叠加元素坐标改为 `calc(设计稿px / W或H * 100%)`
- [ ] 避免在 stage 内对布局关键尺寸写死 `px`（边框 1px 等除外）
- [ ] 缩放浏览器窗口：不变形、不被父级裁掉关键内容

## 与其它方案对比

| 方案 | 适用 |
|------|------|
| **Stage 布局（本 skill）** | 固定设计稿、多图层叠加、大屏/驾驶舱格子 |
| `vw`/`vh` 直接布局 | 简单全屏元素，无精确叠图需求 |
| `transform: scale()` | 临时方案；文字易糊，交互热区需另算 |
