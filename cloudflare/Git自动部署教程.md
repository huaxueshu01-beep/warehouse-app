# Cloudflare Git 自动部署教程（连 GitHub 仓库）

本教程教你把已经推到 GitHub 的 `warehouse-app` 仓库，接到 Cloudflare Pages，实现 **`git push` 一下就自动重新部署**。
前置：GitHub 仓库已存在（https://github.com/huaxueshu01-beep/warehouse-app ），且你有一个 Cloudflare 账号（免费即可）。

> 关键背景：咱们的代码在仓库的 **`cloudflare/` 子目录**（`index.html` 和 `functions/` 都在那里），所以 Cloudflare 的「根目录」必须填 `cloudflare`。
> 另外：`wrangler.jsonc` 里的 `database_id` 占位符**只在用命令行 `wrangler pages deploy` 时才需要填**；走 Git 集成时，数据库绑定在控制台里设，不用管那个占位符。

---

## 一、先建好 D1 数据库（如果还没建）

数据库 `warehouse` 必须存在，Cloudflare 才知道把 `DB` 绑到哪。

- **方式 A（命令行，推荐）**：
  ```bash
  npm install -g wrangler
  wrangler login
  wrangler d1 create warehouse
  ```
  记下输出的 `database_id`（Git 集成用不到它，但命令行部署用得到）。
- **方式 B（控制台）**：Cloudflare 控制台 → **Storage & Databases → D1 SQL → Create database**，名字填 `warehouse`，创建。

---

## 二、在 Cloudflare 连 GitHub 并建 Pages 项目

1. 打开 Cloudflare 控制台：https://dash.cloudflare.com
2. 左侧菜单 **Workers & Pages** → 右上角 **Create** → 选 **Pages** → 选 **Connect to Git**
3. 首次会要求授权 GitHub：点 **Authorize Cloudflare**，登录你的 GitHub 账号（huaxueshu01-beep），允许读取仓库
4. 在仓库列表里点 **warehouse-app** → **Begin setup**

---

## 三、构建设置（这一步最关键）

在设置页填：

| 项 | 填什么 |
|---|---|
| Framework preset | **None** |
| **Root directory（根目录）** | **`cloudflare`** ← 必须，否则找不到 index.html 和 functions |
| Build command（构建命令） | **留空** |
| Build output directory（输出目录） | **`.`** |

> 说明：Root directory 设为 `cloudflare` 后，Cloudflare 会去 `cloudflare/` 下找 `index.html`、`functions/`、`wrangler.jsonc`。输出目录 `.` 表示用该目录作为站点根。

填完点 **Save and Deploy**。

---

## 四、绑定 D1 数据库（让后端函数能访问数据库）

Git 集成不会自动读 `wrangler.jsonc` 里的绑定，要在控制台手动加：

1. 项目部署完后，进入项目 → **Settings** → **Functions**（有的版本叫 **Bindings**）
2. 找到 **D1 database bindings** → **Add binding**
   - Variable name（变量名）：填 **`DB`**（必须，代码里用 `context.env.DB`）
   - D1 database：选 **`warehouse`**
3. **Save**

> 如果这里选不到 `warehouse`，说明第一步的库没建好，回去把它建出来再绑。

---

## 五、完成，拿到网址

部署跑完会给你一个地址，形如：

```
https://warehouse-app.<你的子域>.pages.dev
```

打开它：点 ＋ 加物品、取出、备份导出，确认能用。数据库表会在**第一次访问时自动建好**，不用手动 migrate。

---

## 六、以后怎么更新

本地改完代码，正常提交推送即可，Cloudflare 自动重新部署：

```bash
git add .
git commit -m "说明这次改了什么"
git push
```

去 Cloudflare 项目 → **Deployments** 能看到每次自动构建的记录，也能一键回滚到旧版本。

---

## 七、常见问题

- **页面空白 / 404**：99% 是 Root directory 没填 `cloudflare`，或 `cloudflare/index.html` 不存在。回去 Project Settings 改 Root directory 重新部署。
- **函数报错 `DB is not defined` / D1 binding 找不到**：D1 绑定没加，或变量名不是 `DB`。回第四步检查。
- **改了代码没自动部署**：确认 push 到了 `main` 分支（Cloudflare 默认监听 main）；去 Deployments 看有没有触发构建。
- **国内访问慢/打不开**：Cloudflare 免费版在中国大陆本身不稳（老问题），国内用户更推荐 EdgeOne 版；海外或能走代理则没问题。

---

## 流程一览

```
GitHub 仓库 warehouse-app
   │  (Connect to Git, Root dir = cloudflare)
   ▼
Cloudflare Pages 项目
   │  + D1 绑定 DB → warehouse
   ▼
*.pages.dev 网址  ←── git push 自动重新部署
```
