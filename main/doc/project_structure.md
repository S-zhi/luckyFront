# 项目代码结构文档

## 1. 项目概览
本项目是一个用于“本地 AI 模型管理与推理”的 Web 管理平台原型。
采用原生 HTML5, CSS3 和 JavaScript 开发，未使用重型前端框架（如 Vue/React），保持了轻量级和易于维护的特性。

设计风格采用 **Glassmorphism (毛玻璃)** 视觉风格，强调通透感、层级感和现代科技感。

## 2. 目录结构

```
/Users/wenzhengfeng/code/front/main/
├── index.html              # 主入口文件 (Layout Shell)
├── styles.css              # 全局样式表 (包含所有 Glassmorphism 样式)
├── readme.md               # 项目说明文件
├── doc/                    # 文档目录
│   └── project_structure.md # 本文档
└── pages/                  # 页面内容模块 (HTML 片段)
    ├── model-management.html   # 模型管理页面
    ├── dataset-management.html # 数据集管理页面
    ├── training-results.html   # 训练结果管理页面
    ├── model-training.html     # 模型训练配置页面
    ├── model-validation.html   # 模型验证配置页面
    ├── model-inference.html    # 模型推理页面
    ├── file-management.html    # 文件管理系统页面
    └── coming-soon.html        # "敬请期待"占位页面
```

## 3. 核心文件说明

### 3.1 `index.html` (App Shell)
*   **角色**: 单页应用 (SPA) 的外壳容器。
*   **包含内容**:
    *   `<head>`: 引入 Google Fonts (Inter) 和 FontAwesome 图标库。
    *   `<aside>`: 全局左侧导航栏，包含 Logo、用户信息及多级菜单。
    *   `<main id="main-content">`: 内容动态加载区域。
    *   `<script>`: 简单的路由逻辑，负责监听导航点击事件，并通过 `fetch` 动态加载 `pages/` 目录下的 HTML 片段插入到主内容区。

### 3.2 `styles.css` (Design System)
*   **设计语言**: Premium Glassmorphism。
*   **核心变量 (`:root`)**:
    *   `--primary-color`: `#3b82f6` (科技蓝)
    *   `--glass-bg`: `rgba(255, 255, 255, 0.7)` (高透玻璃背景)
    *   `--backdrop-blur`: `16px` (磨砂程度)
*   **主要组件**:
    *   `.card`: 玻璃质感卡片容器。
    *   `.btn`: 现代化按钮，带微交互效果。
    *   `.data-table`: 悬浮感数据表格。
    *   `.glass-background`: 带有动态流体渐变动画的全局背景。

### 3.3 `pages/` (Content Modules)
该目录下的文件不包含 `<html>`, `<head>`, `<body>` 标签，仅包含具体的页面内容（`<header>` + `.content-body`）。
*   **`model-training.html`**: 包含复杂的表单布局，用于配置训练参数（Epochs, Batch Size 等）。
*   **`coming-soon.html`**: 包含 CSS 动画演示和开发路线图 (Roadmap) 时间轴。

## 4. 技术实现细节

*   **动态加载 (SPA 模拟)**:
    使用原生 `fetch` API 获取 HTML 文本，配合 `innerHTML` 更新 DOM，实现无刷新页面切换。
    ```javascript
    async function loadPage(pageName) {
        const response = await fetch(`pages/${pageName}.html`);
        const html = await response.text();
        mainContent.innerHTML = html;
    }
    ```

*   **响应式布局**:
    使用 CSS Grid (`.grid-layout`) 和 Flexbox 实现灵活的排版，能够适应不同屏幕宽度。

*   **动画效果**:
    *   `@keyframes float`: 背景光斑的漂浮动画。
    *   `@keyframes fadeIn`: 页面切换时的淡入效果。
    *   `@keyframes spin`: 加载时的旋转动画。
