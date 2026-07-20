# 文章更新通道

以后新增 Markdown 或 PDF，只需要完成下面三步：

1. 把文件放进 `public/content/`。
2. 在 `content/articles.json` 里增加一条文章记录。
3. 提交并推送到 GitHub 的 `main` 分支。

`content/articles.json` 是唯一内容清单。文章列表、独立阅读页、首页更新日志和年度热力图都会读取它，不需要分别修改。

## 字段

- `slug`：文章唯一英文标识，只使用小写字母、数字和连字符。
- `kind`：`markdown` 或 `pdf`。
- `title`：展示标题。
- `summary`：列表与更新日志摘要。
- `publishedAt`：发布日期，格式为 `YYYY-MM-DD`；热力图使用这个日期。
- `category`：例如 `文章` 或 `复盘`。
- `source`：以 `/content/` 开头的文件路径。
- `pages`：PDF 可选页数。

推送后，GitHub Actions 会先检查清单和文件，再生成静态站并部署到 GitHub Pages。任何字段错误、重复 slug 或缺少文件都会让构建失败，避免发布残缺页面。
