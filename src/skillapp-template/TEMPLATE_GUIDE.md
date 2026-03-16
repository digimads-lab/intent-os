# SkillApp 代码结构指南

## 目录结构
生成的 SkillApp 必须遵循以下目录结构：

```
{appDir}/
├── package.json          # 应用元数据和依赖
├── main.js               # Electron 主进程入口
├── preload.js            # preload 脚本（contextBridge）
└── src/
    ├── App.tsx            # React 根组件
    ├── router.tsx         # React Router 路由配置
    ├── pages/             # 页面组件目录
    │   └── {PageName}.tsx
    ├── components/        # 共享组件目录
    │   └── {ComponentName}.tsx
    └── styles/
        └── global.css     # 全局样式
```

## 技术要求
- 使用 React 18 + TypeScript
- 使用 Tailwind CSS 进行样式设计
- 主进程必须设置 contextIsolation: true, nodeIntegration: false, sandbox: true
- 渲染进程只能通过 window.intentOS API 访问系统功能

## 安全规范
- 所有 Node.js 功能必须通过 preload.js 中的 contextBridge 暴露
- 禁止在渲染进程中直接使用 require() 或 import Node.js 模块
- 禁止使用 eval()、Function() 等动态执行函数
- 所有外部链接必须通过 shell.openExternal() 在系统浏览器中打开

## 测试模式支持
main.js 必须支持 INTENTOS_TEST_MODE 环境变量：
- 当 INTENTOS_TEST_MODE=1 时，创建隐藏窗口（show: false）
- 页面加载完成后（did-finish-load）输出 "INTENTOS_READY" 到 stdout
- 5 秒后自动调用 app.quit() 退出

## Skill 调用约定
- 通过 window.intentOS.skills.call(skillId, method, params) 调用 Skill
- 所有 Skill 调用都是异步的，返回 Promise
- 需要处理权限拒绝的情况（PermissionDenied 错误）

## 样式约定
- 使用深色主题（slate 色系背景）
- 圆角边框（rounded-xl / rounded-2xl）
- 适当的间距（gap-4 / gap-6）
- 响应式布局（flex / grid）
