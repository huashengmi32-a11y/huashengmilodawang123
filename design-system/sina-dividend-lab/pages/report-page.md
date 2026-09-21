# 页面级适配：数据报告页

本文件覆盖 `MASTER.md` 中面向营销首页的部分，记录本站点（`site/index.html`）的实际落地方案。

## 一、对 MASTER 的取舍

| 项目 | MASTER 建议 | 本站点落地 | 说明 |
| --- | --- | --- | --- |
| Pattern | Enterprise Gateway（视频 Hero、行业方案、客户 Logo） | 报告页结构：关键指标 → 五步流程 → 数据工作台 → 质量报告 → 交付清单 | 交付物是数据过程与结果的说明页，营销版式不适用 |
| Style | Minimalism & Swiss Style | 完全采用 | 网格化、强层级、留白克制，适合数据密集型阅读 |
| Color | Primary `#1E40AF`、Secondary `#3B82F6`、Accent `#D97706`、Background `#F8FAFC`、Card `#FFFFFF`、Muted `#E9EEF6`、Border `#DBEAFE` | 采用，另补充语义状态色 | 状态色用于「实施 / 预案 / 不分配」与问题级别 |
| Typography | Fira Code + Fira Sans | 采用，中文回退 `Microsoft YaHei` | 金额、日期、编号等数字统一走 Fira Code，等宽对齐便于比对 |
| Key Effects | 200–250ms 微交互、清晰字阶 | 采用，仅保留 200ms 过渡 | 无滚动动画、无装饰性动效 |
| Density | 8/10 紧凑 | 采用 4/8/12/16/24/32/48 间距刻度 | 表格行高 9px 内边距，一屏可见更多记录 |
| Motion | Scroll Reveal（300–400ms） | 不采用滚动入场动画 | 报告页以阅读为主，动效收益低；`prefers-reduced-motion` 下所有过渡降为 0.01ms |

## 二、相对 MASTER 的两处调整

1. **正文颜色**：MASTER 的 `--color-foreground` 为 `#1E3A8A`，长段落使用该色偏蓝。
   正文改用 `#0F172A`，标题与链接继续使用 Primary 系，对比度更高且阅读更稳。
2. **装饰元素**：未使用渐变、光斑、3D 插图等装饰，把视觉预算留给表格与图表。

## 三、无障碍与质量约束（已用 Playwright 用例锁定）

- 正文与次要文字对比度 ≥ 4.5:1，大号数字 ≥ 3:1（WCAG AA）。
- 主要交互控件高度 ≥ 44px，且互不重叠。
- 提供跳到主内容链接、可见焦点样式、`aria-sort` 表头、可聚焦图表柱。
- 关键容器无文字溢出或裁切；吸顶导航不遮挡锚点标题。
- 响应式断点：1024px、768px；375px 宽度下无整体横向溢出。

## 四、反模式检查

- 不使用 emoji 充当图标（统一内联 Lucide 风格描边图标）。
- 卡片仅用于重复出现的指标项、表格容器与图表面板，页面版块为整幅色带，不做卡片套卡片。
- 表格必须可筛选与排序（MASTER 的 Avoid 项：No filtering）。
