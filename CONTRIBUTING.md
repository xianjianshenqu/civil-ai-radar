# 贡献指南

## 开发环境

```bash
npm install
npm run dev        # 前端 127.0.0.1:5173
npm run dev:api    # 后端 127.0.0.1:8791
```

Node.js 22+（建议 24+，依赖内置 `node:sqlite`）。

## 提交前自查

- `npm run test:all` 通过；新增测试文件时同步加进 `package.json` 的 `test:all`（CI 会跑同一命令）。
- `npm run build` 成功；涉及演示数据时再跑 `npm run test:radar-data`。
- 涉及 `worker/`、`scripts/prepare-sites-build.mjs` 时跑 `npm run test:sites`。

## 数据红线

README「数据边界与产品原则」一节是这个项目的硬约束，PR 中请不要放松：

- 机器输出（评分、机器整理、模型翻译标注）不写「已核验／可破冰／编辑置顶」，采集条目保持待复核。
- 关键词与名单命中只是计分线索，不构成单位参与的证据。
- 不抓取公告正文全文；遵守目标站 robots.txt；未知字段保持未知，不编造日期、指标或引语。

## 提交与 PR

- 提交信息用中文、动词开头，说明改了什么（例：`修复：采购公告重复链接`、`前端：设置页按需加载`）。
- PR 会自动跑单元测试、数据校验、构建与 Sites 检查（`.github/workflows/ci.yml`）。
- 新增采集信源前先读 [docs/COLLECTORS.md](docs/COLLECTORS.md)：需要先核验 robots.txt、HTTPS 与实际可达性，并记录验证结论。
