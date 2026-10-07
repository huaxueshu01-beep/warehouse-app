# Cloudflare Git 自动部署教程（Worker + GitHub，网页端一步步做）

目标：把 GitHub 上的 `warehouse-app` 仓库连到 Cloudflare，**`git push` 一下就自动重新部署**。全程在网页上操作，命令行可选。

> 前置：GitHub 仓库已存在（`huaxueshu01-beep/warehouse-app`），且 `cloudflare/` 目录已是新的 Worker 结构（含 `src/worker.js`、`public/index.html`、`wrangler.jsonc`）。

---

## 第 1 步：建 D1 数据库（控制台，最稳）

1. 打开 https://dash.cloudflare.com → 左侧 **Storage & Databases → D1 SQL**。
2. 点 **Create database**，Database name 填 `warehouse`，点 Create。
3. 进入该数据库，复制它的 **database_id**。
4. 在本地编辑器打开 `cloudflare/wrangler.jsonc`，把 `database_id` 那行换成真实 id 并保存。
5. 提交并推送到 GitHub：
   ```bash
   git add cloudflare/wrangler.jsonc
   git commit -m "fill D1 database_id"
   git push
   ```
   > Worker 的 Git 部署会读 `wrangler.jsonc` 里的 `d1_databases`（含 `database_id`），所以这一步**必须**填真实 id（和 Pages 不同，Pages 的 Git 部署忽略它）。

---

## 第 2 步：在 Cloudflare 连 GitHub 并建 Worker 项目（网页端）

1. 控制台左侧 **Workers & Pages** → 右上角 **Create** → 选 **Worker**（有的入口叫 Create application → Worker）。
2. 选择 **Connect to Git / Deploy from Git**。
3. 首次会要求授权 GitHub：点 **Authorize Cloudflare**，登录你的 GitHub（`huaxueshu01-beep`）并允许读取仓库。
4. 在仓库列表里点 **warehouse-app** → **Begin setup**。
5. 构建设置（这一步最关键）：

   | 项 | 填什么 |
   |---|---|
   | Root directory（根目录） | **`cloudflare`** ← 必须，否则找不到 `worker.js` / `public` / `wrangler.jsonc` |
   | Build command | **留空**（纯 JS Worker，无需构建） |
   | Deploy command | **留空**（用 wrangler.jsonc 的 `main` 自动部署） |
   | 变量 / 绑定 | 一般自动从 `wrangler.jsonc` 读取（`DB`、`ASSETS`）。若没自动出现，见第 3 步手动加 |

6. 点 **Save and Deploy**。

---

## 第 3 步（如需要）：手动确认 D1 绑定

如果部署后访问接口报 `D1 binding not found`：

1. 项目 → **Settings → Variables and Bindings**（有的版本叫 Bindings）。
2. **D1 database bindings → Add binding**：Variable name 填 **`DB`**，D1 database 选 **`warehouse`**。
3. Save，然后 **Redeploy**。

---

## 第 4 步：拿到网址，测试

部署跑完给一个地址，形如：

```
https://warehouse-cloudflare.<你的子域>.workers.dev
```

打开它：点 ＋ 加物品、取出、备份导出，确认能用。表会在**第一次访问时自动建好**。

---

## 第 5 步：以后怎么更新

本地改完代码，正常提交推送即可，Cloudflare 自动重新部署：

```bash
git add .
git commit -m "说明这次改了什么"
git push
```

去项目 → **Deployments** 能看到每次自动构建记录，也能一键回滚到旧版本。

---

## 常见问题

- **页面空白 / 404**：99% 是 Root directory 没填 `cloudflare`，或 `cloudflare/public/index.html` 不存在。回去改 Root directory 重新部署。
- **接口报 `D1 binding not found`**：第 3 步没加绑定，或变量名不是 `DB`。
- **改了代码没自动部署**：确认 push 到 `main` 分支；Deployments 看有没有触发构建。
- **国内访问慢/打不开**：免费版在中国大陆本身不稳（老问题），国内用户更推荐 `edgeone/` 版。

---

## 流程一览

```
GitHub 仓库 warehouse-app（cloudflare/ 子目录）
   │  Connect to Git, Root dir = cloudflare
   ▼
Cloudflare Worker 项目（读 wrangler.jsonc：main=src/worker.js, assets=./public, D1=DB）
   │  + D1 绑定 warehouse
   ▼
*.workers.dev 网址  ←── git push 自动重新部署
```
