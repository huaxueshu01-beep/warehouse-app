# 把仓库系统上传到 GitHub 教程

本教程教你怎么把 `G:/仓库网站` 这个项目（含 Cloudflare 版、EdgeOne 版、原始本地版）上传到 GitHub。
上传后有两个好处：① 代码有了版本备份；② 可以让 Cloudflare 用「Git 集成」自动部署（教程末尾附说明）。

---

## 一、确认 Git 已装

终端里执行：

```bash
git --version
```

能看到版本号（如 `git version 2.xx`）就说明已装好。本项目已经放好 `.gitignore`，无需再建。

---

## 二、在本地初始化仓库并提交

在 **项目根目录** `G:/仓库网站` 执行：

```bash
cd G:/仓库网站

# 1) 初始化本地仓库
git init

# 2) 把所有源码加入暂存区（.gitignore 会自动排除 node_modules / 数据库 / 记忆文件）
git add .

# 3) 提交
git commit -m "仓库系统初始版本（含 Cloudflare / EdgeOne 两套部署）"
```

> 检查会不会误传大文件：`git status` 看一下，应该**没有** `node_modules/`、`warehouse.db`、`.workbuddy-ai/`。

---

## 三、在 GitHub 上新建仓库（网页端，最稳）

1. 打开 https://github.com/new
2. 填 **Repository name**（例如 `warehouse-app`），随意起；
3. **Visibility** 选 `Private`（私有，推荐，只有你能看）或 `Public`；
4. **不要**勾选 "Add a README file" / "Add .gitignore" / "Choose a license" —— 本地已经有了，避免冲突；
5. 点 **Create repository**。

创建后会看到一个空仓库页面，里面有类似这样的地址（二选一）：

- HTTPS：`https://github.com/你的用户名/warehouse-app.git`
- SSH：`git@github.com:你的用户名/warehouse-app.git`（需先配置 SSH key）

复制这个地址。

---

## 四、关联远程并推送

回到终端：

```bash
# 把 <仓库地址> 换成你刚复制的 URL
git remote add origin <仓库地址>

# 主线改名为 main（GitHub 现在默认 main）
git branch -M main

# 首次推送并设置跟踪
git push -u origin main
```

第一次推送会让你登录 GitHub（浏览器授权，或弹窗填账号密码 / Personal Access Token）。
看到 `main -> main` 和百分进度条跑完，就上传成功了。

去 GitHub 刷新页面，就能看到全部代码了。

---

## 五、以后更新代码

每次改完，提交并推送即可：

```bash
git add .
git commit -m "说明这次改了什么"
git push
```

---

## 六、（可选）用 GitHub Desktop 代替命令行

不想敲命令的话：

1. 下载安装 GitHub Desktop：https://desktop.github.com/
2. File → Add Local Repository → 选 `G:/仓库网站`
3. 左下角填 Summary（如 `初始版本`），点 Commit
4. 点 **Publish repository**，填名字、选 Public/Private，点 Publish
5. 之后点 Push 就能同步

---

## 七、（进阶）让 Cloudflare 自动部署

既然代码在 GitHub 上了，可以让 Cloudflare 每次 push 自动部署：

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → 选 **Pages** → **Connect to Git**
2. 授权并选中刚才的仓库 `warehouse-app`
3. 设置：
   - **Root directory（根目录）**：填 `cloudflare`（因为 `index.html` 和 `functions/` 都在这里）
   - **Build command（构建命令）**：留空
   - **Build output directory（输出目录）**：填 `.`
4. 部署变量里绑定 D1：在 Pages 项目 **Settings → Functions → D1 数据库绑定** 加一个 `DB` → 选 `warehouse`
5. 点 **Save and Deploy**

以后 `git push` 一下，Cloudflare 就自动重新部署，连 `wrangler pages deploy` 都不用敲了。

---

## 常见问题

- **`git push` 提示用户名密码反复失败** → GitHub 已不支持账号密码，去 https://github.com/settings/tokens 建一个 **Fine-grained Personal Access Token**（勾 repo 权限），密码处粘贴这个 token。
- **提示 `remote origin already exists`** → 先 `git remote remove origin` 再重新 `git remote add origin <地址>`。
- **不小心把数据库传上去了** → `git rm --cached warehouse.db` 并从 `.gitignore` 确认已忽略，再提交；已推送的历史可以用 `git filter-repo` 清理（较重，一般私有仓库无所谓）。
- **SSH 地址 push 报权限拒绝** → 没配 SSH key，改用 HTTPS 地址最省事。

---

## 目录结构（会被上传的内容）

```
仓库网站/
├── .gitignore               # 已建好，排除依赖/数据库/记忆
├── public/index.html        # 前端源码（两套部署共用）
├── server.js / db.js        # 原始本地 Node 版（参考用）
├── package.json
├── cloudflare/              # Cloudflare 部署版（推荐）
│   ├── index.html
│   ├── wrangler.jsonc
│   ├── package.json
│   ├── 部署教程.md
│   └── functions/api/[[route]].js
└── edgeone/                 # EdgeOne 部署版（国内访问更稳）
    ├── index.html
    ├── package.json
    └── cloud-functions/api/[[default]].js
```

核心三步：**`git init` → 网页建仓库 → `git remote add origin` + `git push`**。
