# 🚗 Ryde Multi-Agent Autonomous Dispute Resolution System

> Tencent Cloud AI CAN DO IT Hackathon Singapore 2026

本项目采用前后端分离/同仓架构：

- **`frontend/`**: 基于 Next.js \+ React \+ TypeScript \+ Tailwind CSS 的模拟法庭 UI 界面。  
- **`backend/`**: 基于 Python 的 Multi-Agent 编排器、Agent 逻辑与工具接口。  
- **`shared/`**: 前后端共享的数据契约（JSON Schemas / TypeScript Types）。

---

## 🛠️ 后端 Python 虚拟环境 (`venv`) 使用指南

为了避免不同开发者电脑上的 Python 全局依赖发生冲突，**所有后端开发与依赖安装必须在 `venv`（虚拟环境）中进行**。

> ⚠️ **注意**：`venv/` 文件夹已被写进 `.gitignore`，**千万不要上传到 GitHub**！我们只通过 `requirements.txt` 同步第三方依赖。

---

### 1\. 首次拉取项目（或换新电脑）配置步骤

当你第一次克隆（`git clone`）项目到本地后，请按以下步骤操作：

#### 🔹 Windows (PowerShell) 用户：

\# 1\. 进入 backend 目录

cd backend

\# 2\. 创建本地独立的虚拟环境

python \-m venv venv

\# 3\. 激活虚拟环境 (若提示权限错误，先运行: Set-ExecutionPolicy Unrestricted \-Scope Process)

.\\venv\\Scripts\\Activate.ps1

\# 4\. 一键安装项目所需的所有依赖

pip install \-r requirements.txt

#### 🔹 macOS / Linux 用户：

\# 1\. 进入 backend 目录

cd backend

\# 2\. 创建本地独立的虚拟环境

python3 \-m venv venv

\# 3\. 激活虚拟环境

source venv/bin/activate

\# 4\. 一键安装项目所需的所有依赖

pip install \-r requirements.txt

> 💡 **激活成功的标志**：终端命令行最左侧会出现 **`(venv)`** 前缀！

---

### 2\. 日常开发工作流 (Daily Workflow)

每次打开终端准备编写/运行 `backend` 代码时：

#### Step 1: 激活 `venv`

- **Windows**: `cd backend` \-\> `.\venv\Scripts\Activate.ps1`  
- **macOS/Linux**: `cd backend` \-\> `source venv/bin/activate`

#### Step 2: 如果你安装了新的 Python 依赖库

如果你使用 `pip install <package_name>` 安装了新的库（例如 `pip install fastapi`），**请务必更新 `requirements.txt`**：

pip freeze \> requirements.txt

然后提交 `requirements.txt` 到 GitHub，这样其他队友 `git pull` 后只需运行 `pip install -r requirements.txt` 就能同步更新。

#### Step 3: 退出虚拟环境（可选）

当你开发完毕或需要切换项目时：

deactivate

---

## 💻 前端开发启动指南 (`frontend/`)

\# 1\. 进入 frontend 目录

cd frontend

\# 2\. 安装 Node 依赖

npm install

\# 3\. 启动本地开发服务器

npm run dev

打开浏览器访问 `http://localhost:3000` 即可预览 UI。

---

## 📂 项目目录结构概览

ryde-ai-court/

├── shared/         \# 前后端共享类型定义 (types.ts / schemas.json)

├── frontend/       \# Next.js 前端 UI 界面

└── backend/        \# Python 后端

    ├── orchestrator/  \# P1: 状态机与工作流编排

    ├── agents/        \# P2: 乘客/司机/法官 Agent Prompt

    ├── tools/         \# P3: 路线校验/多模态/EXIF 鉴伪 API

    └── requirements.txt

## 📂 DEMO CASE 1: DISP-001.json

司机绕路 2.3 公里导致费用超标，$3.25 SGD 被自动退回乘客账户，信心得分 0.94，走 FULLY_AUTOMATED 0 人工通道。

## 📂 DEMO CASE 2: DISP-003.json

司机索赔 $100 清洁费，但 EXIF 多模态审计发现照片拍照时间比行程结束晚了 1 小时 20 分钟（时间戳不符）且疑似循环使用旧图。欺诈风险标记为 HIGH，成功触发 Escalation 人工转接通道（ESCALATED_HUMAN_REVIEW）。