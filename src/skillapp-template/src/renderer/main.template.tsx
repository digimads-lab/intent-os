/**
 * SkillApp 渲染进程入口
 * 由 M-05 SkillApp 生成器自动生成
 * 负责将 React 应用挂载到 DOM
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';

// 挂载 React 应用到根节点
// index.html 必须包含 <div id="root"></div>
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
