/**
 * SkillApp React Router 7 路由配置
 * 由 M-05 SkillApp 生成器自动生成，填充 {{ROUTES}} 占位符
 */

import React, { Suspense } from 'react';
import {
  createHashRouter,
  RouterProvider,
  Navigate,
  Outlet,
} from 'react-router-dom';

// ============================================================================
// 1. 动态导入业务页面组件
// ============================================================================
// AI Provider 生成的每个页面都通过动态 import() 加载
// 这样可以：
// 1. 减少首屏加载时间
// 2. 支持运行时的热更新（替换页面模块）
// 3. 按需加载，降低内存占用

const ImportPage = React.lazy(() => import('../app/pages/ImportPage'));
const ConfigPage = React.lazy(() => import('../app/pages/ConfigPage'));
const PreviewPage = React.lazy(() => import('../app/pages/PreviewPage'));
// {{ROUTES}} — 代码生成器在此处插入更多动态导入

// ============================================================================
// 2. 加载中占位组件
// ============================================================================

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="mb-4">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
        <p className="text-gray-500">加载中...</p>
      </div>
    </div>
  );
}

// ============================================================================
// 3. 布局组件（应用框架）
// ============================================================================

function AppLayout() {
  return (
    <div className="flex flex-col h-screen">
      {/* 应用顶部导航栏（可选，由 AI Provider 生成） */}
      <header className="bg-blue-600 text-white px-4 py-3">
        <h1 className="text-lg font-semibold">{{APP_NAME}}</h1>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto">
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </main>

      {/* 应用底部状态栏（可选） */}
      <footer className="bg-gray-100 border-t px-4 py-2 text-sm text-gray-600">
        <div className="flex justify-between">
          <span>Ready</span>
          <span>v{{APP_VERSION}}</span>
        </div>
      </footer>
    </div>
  );
}

// ============================================================================
// 4. 路由表定义
// ============================================================================
// 路由配置格式规范（由代码生成器遵守）：
//
// 每条路由的构造方式：
// {
//   path: string,                    // 路由路径（如 '/import'）
//   element: React.lazy(() => import('...')),  // 动态导入的页面组件
//   index?: boolean,                 // 是否为默认路由
// }

const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <ImportPage />,
      },
      {
        path: '/import',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <ImportPage />
          </Suspense>
        ),
      },
      {
        path: '/config',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <ConfigPage />
          </Suspense>
        ),
      },
      {
        path: '/preview',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PreviewPage />
          </Suspense>
        ),
      },
      // {{ROUTES}} — 代码生成器在此处插入更多路由配置

      // 404 处理
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
];

// ============================================================================
// 5. 创建路由实例并导出
// ============================================================================

const router = createHashRouter(routes, {
  future: {
    v7_startTransition: true,
  },
});

export default router;
