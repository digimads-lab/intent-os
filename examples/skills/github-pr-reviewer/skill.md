---
name: github-pr-reviewer
version: 1.0.0
description: Review GitHub Pull Requests — analyze code changes, summarize diffs, and provide structured feedback
author: jimmyshi
entryPoint: src/index.ts
capabilities:
  - net.fetch
dependencies: []
---

# GitHub PR Reviewer

一个用于 Review GitHub Pull Request 的 IntentOS Skill。

## 功能

- 获取 PR 的基本信息（标题、描述、作者、状态）
- 分析 diff 内容，列出文件变更清单
- 提供结构化的 Code Review 意见

## 使用方式

在 IntentOS 中基于此 Skill 生成 SkillApp 后，输入 GitHub PR URL 即可自动 Review。
