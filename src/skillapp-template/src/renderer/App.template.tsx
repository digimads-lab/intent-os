/**
 * SkillApp 根 App 组件
 * 由 M-05 SkillApp 生成器自动生成
 * 挂载 React Router，作为整个应用的根组件
 */

import React from 'react';
import { RouterProvider } from 'react-router-dom';
import router from './router';

/**
 * App 根组件
 * 职责：挂载路由系统，提供全局上下文
 */
export default function App() {
  return <RouterProvider router={router} />;
}
