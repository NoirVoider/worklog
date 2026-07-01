# Worklog

macOS 原生工作日志应用 — 每天写 Markdown 日报，日历导航，本地文件存储。

## 安装

### Homebrew

```bash
brew tap noirvoider/worklog
brew install worklog
```

## 技术栈

Tauri v2 + React 19 + TypeScript + Tailwind CSS 4

## 开发

```bash
pnpm install
pnpm dev          # 浏览器模式 → http://localhost:1420
pnpm tauri:dev    # Tauri 桌面应用
pnpm tauri:build  # 打包 macOS 应用
pnpm test         # 运行测试
```

## 项目结构

```
src/              # React 前端
src-tauri/        # Tauri (Rust) 后端
```

## License

MIT
