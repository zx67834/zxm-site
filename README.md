# zxm 的小站

一个纯静态个人博客，包含 Markdown / PDF 阅读、伪终端、文章更新热力图和本地时间。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

本地地址默认是 `http://localhost:3000`，端口被占用时会自动选择其他端口。

## 更新文章

1. 将 Markdown 或 PDF 放入 `public/content/`。
2. 在 `content/articles.json` 增加文章记录。
3. 提交并推送到 GitHub 的 `main` 分支。

文章列表、独立阅读页、首页更新日志和年度热力图共用这份清单。完整字段说明见 `CONTENT_GUIDE.md`。

## 构建

```bash
npm run articles:check
npm run build
npm run build:pages
```

- `articles:check`：检查文章字段、重复 slug 和文件是否存在。
- `build`：验证本地 Vinext 构建。
- `build:pages`：生成 GitHub Pages 使用的纯静态站点。

推送 `main` 后，`.github/workflows/pages.yml` 会自动校验、构建并发布 GitHub Pages。
