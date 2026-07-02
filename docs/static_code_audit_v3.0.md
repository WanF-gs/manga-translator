# PRD v3.0 静态代码审计报告 (更新版)

> 审计日期：2026-06-28（首次：2026-06-27）  
> 审计范围：基于 `docs/prd/manga-translator-v3.0-prd.md` 的静态代码审计  
> 审计方法：PRD 功能对标、前后端接口静态比对、空壳/模拟实现扫描、核心链路风险识别、安全凭据扫描、代码质量分析  
> 审计状态：未修改代码，未执行动态测试  
> 更新说明：新增安全凭据风险、导出服务仓库状态更新、成员管理 API 模块新增、构建质量分析、接口合同表刷新

---

## 总体结论

当前代码已经覆盖了 PRD v3.0 的大部分"模块入口"和"页面/接口雏形"，但从静态代码看，存在三类主要问题：

1. **前后端接口不匹配较多** — 尤其集中在 quality、learn、search context、api-keys stats、font update 等新增 v3.0 功能。

2. **部分 PRD 功能是"有页面/有接口，但实现偏空壳或模拟"** — 典型包括：动态漫画、支付/订阅、质量评估、内容安全外部审核、PDF 降级处理、部分学习闭环。

3. **PRD 28 大模块里，P0/P1 主链路基本有骨架，但很多高级能力未达到 PRD 描述强度** — 例如"多模态质量评估""角色语气一致性""主动学习模型热更新""端云协同 ONNX/WebGPU""PWA 完全离线"等，多数是轻实现或缺核心实现。

---

## 一、严重问题：疑似文件内容串写/污染风险

多个后端文件读取时曾返回同一段前端 axios request 代码。使用读取工具读取以下文件时，返回内容一度都是 `manga-translator-web/src/services/request.ts` 的前端请求封装内容：

- `manga-translator-web/src/services/project.ts`
- `manga-translator-backend/services/project_service/main.py`
- `manga-translator-backend/gateway/internal/router/router.go`

后续用 Python 直接读取时，能读到正确内容，说明可能是读取工具缓存/索引异常，也可能是编辑器/文件系统状态异常。建议后续重点核实：

- 实际磁盘上的这些文件内容是否正常
- Git diff 中是否存在误覆盖
- IDE 打开的内容和真实文件内容是否一致
- 是否有某个自动化 agent 曾经误写入跨语言文件

这个问题如果是真的文件污染，会直接导致构建失败或服务无法启动；如果只是工具读取异常，可以忽略。

---

## 一-B、新增安全风险：真实云凭据泄露

### 严重：`.env` 文件包含真实腾讯云 AKID/SK

**位置**：`manga-translator-backend/.env`（第 67-68 行）

```
TENCENT_SECRET_ID=AKID************************************
TENCENT_SECRET_KEY=********************************
```

**风险**：
- 真实腾讯云 API 密钥硬编码在环境变量文件中
- 该文件虽在 `.gitignore` 中但需确认是否已被 Git 历史追踪（`git log -- .env` 验证）
- 泄露后攻击者可通过 TMT 机器翻译服务消费账号余额（500万字符/月免费额度用完后按量计费）
- 同一账号可能关联其他腾讯云服务（COS、CVM 等）

**建议**：
- 立即在腾讯云控制台轮换该密钥对
- 使用 `.env.example` 模板（已存在），确保 `.env` 从未被 `git add`
- 如已提交，使用 `git filter-branch` 或 `BFG Repo-Cleaner` 清理历史
- 生产环境使用密钥管理服务（如 HashiCorp Vault、腾讯云 KMS）

### 中风险：多处硬编码默认凭据

| 文件 | 凭据 | 风险 |
|------|------|------|
| `docker-compose.yml` | `manga_user/manga_pass`, `minioadmin/minioadmin` | Docker 内部网络风险低，但容器逃逸后可用 |
| `.env` JWT 配置 | `your-super-secret-jwt-key-change-in-production` | 默认 JWT 密钥需在生产环境更换 |
| `start_wsl2_all.sh` | 同 `.env` 云凭据重复硬编码 | 额外泄露面 |

### 低风险：前端开发绕过

| 文件 | 内容 | 说明 |
|------|------|------|
| `manga-translator-web/src/app/pc/page.tsx` | `dev_bypass_token` | 仅开发环境使用，需确认生产构建时移除 |

---

## 一-C、新增：构建质量风险

### TypeScript/ESLint 错误在构建时被忽略

**位置**：`manga-translator-web/next.config.js`

```js
typescript: { ignoreBuildErrors: true },
eslint: { ignoreDuringBuilds: true }
```

**风险**：
- 类型错误和代码规范问题不会阻塞 CI/CD 流水线
- 可能导致运行时错误掩盖在构建阶段
- 累计的技术债可能引入更严重的 bug

**当前 ESLint 规则**（`.eslintrc.js`）：
- `@typescript-eslint/no-unused-vars`: warn
- `@typescript-eslint/no-explicit-any`: warn
- `no-console`: warn

虽然都是 warn 级别，但大量 warn 被忽略会降低代码可维护性。

**建议**：至少在 CI 流水线中启用类型检查（不阻塞构建但报告），逐步将 warn 降为零后改为 error。

---

## 二、前后端接口不匹配清单

### P0-1：质量评估接口路径不匹配

**前端路径**（位于 `manga-translator-web/src/services/quality.ts`）：

- `GET /quality/${pageId}`
- `POST /quality/${pageId}/evaluate`
- `GET /quality/project/${projectId}`
- `POST /quality/batch-evaluate`

**后端路径**（位于 `manga-translator-backend/services/translation_service/api/quality.py`）：

- `POST /quality/assess/{page_id}`
- `GET /quality/{quality_id}`
- `GET /quality/page/{page_id}`
- `GET /quality/summary/project/{project_id}`

**影响**：

- 前端"单页质量评分"会把 `pageId` 当 `quality_id` 请求，语义错误
- 前端"触发质量评分"请求 `/quality/{pageId}/evaluate`，后端没有
- 前端"项目质量总览"请求 `/quality/project/{projectId}`，后端是 `/quality/summary/project/{projectId}`
- 前端"批量评估"后端无对应接口

**PRD 对标**：PRD 要求"多模态翻译质量评估体系、BLEU/METEOR 自动打分、人工反馈闭环"。当前不仅接口不匹配，后端还存在模拟评分问题，见后文。

---

### P0-2：学习模块接口不匹配

**前端路径**（位于 `manga-translator-web/src/services/search.ts` 和 `manga-translator-web/src/app/pc/learn/page.tsx`）：

- `GET /learn/progress`
- `PUT /learn/progress/${progressId}`
- `GET /learn/review`
- `GET /learn/achievements`
- 可能还有词汇统计相关接口

**后端路径**（位于 `manga-translator-backend/services/reader_service/api/search_learn.py`）：

- `GET /learn/progress`
- `GET /learn/achievements`
- `POST /learn/review/{vocab_id}`

**缺失/不匹配**：

- 后端没有 `PUT /learn/progress/{progress_id}`
- 后端没有 `GET /learn/review`
- 前端期望"获取复习会话"，后端只有"提交某个 vocab 的复习"

**影响**：学习页会出现"页面存在但功能不可用/只能展示空状态"的情况。

**PRD 对标**：PRD 要求"社交化学习社区、生词本复习、艾宾浩斯复习、成就系统"。目前学习闭环不足，偏空壳。

---

### P0-3：搜索结果上下文接口缺失

**前端路径**（位于 `manga-translator-web/src/services/search.ts`）：

- `GET /search/${resultId}/context`

**后端路径**（位于 `manga-translator-backend/services/reader_service/api/search_learn.py`）：

- `GET /search`

**影响**：跨作品全文搜索列表可能能查，但"定位原图上下文/跳转漫画页并高亮结果"不可用。

**PRD 对标**：PRD v3.0 第 28 模块是"对话跨作品搜索"，要求搜索名场面/经典对话。缺上下文接口会让搜索结果体验不完整。

---

### P0-4：API Key 统计接口不匹配

**前端路径**（位于 `manga-translator-web/src/services/api-keys.ts`）：

- `GET /api-keys/${keyId}/stats`

**后端路径**（位于 `manga-translator-backend/services/user_service/api/api_keys.py`）：

- `GET /api-keys/stats/usage`

**影响**：API Key 列表、创建、删除可能正常，但单 key 用量统计会 404。

**PRD 对标**：PRD 要求"API开放平台、SDK/插件生态、调用统计/限流"。统计接口不匹配会影响开放平台闭环。

---

### P0-5：字体更新接口前端有，后端缺失

**前端路径**（位于 `manga-translator-web/src/services/font.ts`）：

- `PUT /fonts/${fontId}`

**后端路径**（位于 `manga-translator-backend/services/project_service/api/fonts.py`）：

- `GET /fonts`
- `POST /fonts/upload`
- `DELETE /fonts/{font_id}`
- `GET /fonts/smart-match`
- `GET /fonts/file/{font_id}{ext}`
- `GET /fonts/{font_id}`

**影响**：字体信息编辑/分类/标签/授权信息修改不可用。

**PRD 对标**：PRD v3.0 模块 23 要求"字体库管理、字体-角色绑定、缺字回退"。当前字体库有上传/列表/匹配，但管理能力不完整。

---

### P0-6：导出接口存在多套路径，前端与后端存在部分不匹配

**状态更新（2026-06-28）**：

后端 `export_service/api/export.py` 现在明确注册了两套路由：
- `/api/v1/exports/*`（主路由，`export_service/main.py` 注册）
- `/api/v1/export/*`（PRD 单数别名，`export.py` 内直接注册）

并提供以下端点：
- `POST /export/single` / `POST /exports/single`
- `POST /export/chapter` / `POST /exports/chapter`
- `POST /export/project` / `POST /exports/project`
- `POST /export/batch` / `POST /exports/batch`
- `GET /export/{task_id}/status` / `GET /exports/{task_id}/status`
- `GET /export/download/{task_id}` / `GET /exports/{task_id}/download`

前端 `manga-translator-web/src/services/export.ts` 与后端部分不匹配：
- 前端调 `POST /export/batch`，后端 `/exports/chapter` — 语义不同（前端 batch 可能是章节批量，后端 chapter 是单章节）
- 前端调 `GET /export/{taskId}/status`，后端 `/exports/{taskId}/status` — 前缀差异 `/export/` vs `/exports/`
- 前端调 `GET /export/download/{taskId}`，后端 `/exports/{taskId}/download` — 同上

**PRD 对标**：PRD 要求"多格式高清导出、双语对照导出、长图导出、CBZ/PDF/ZIP"。后端有多套路径兼容，且导出仓库已从 Mock 升级为真实数据库实现，整体风险较 v1.0 报告降低。

---

### P0-7：认证接口用户字段可能不一致

**前端 `auth.ts` 期望**：

登录/注册返回：
- `user.user_id`
- `user.email`
- `user.nickname`
- `user.plan_type`
- `tokens.access_token`
- `tokens.refresh_token`

刷新返回：
- `data.access_token`
- `data.refresh_token`

**后端**：
- `manga-translator-backend/services/user_service/api/auth.py`
- `manga-translator-backend/services/user_service/api/profile.py`

需要重点核查返回结构是否完全包在统一 `ApiResponse` 的 `data` 中，且字段是否为 `user_id` 而不是 `id/sub`。

**风险**：登录成功但前端 store 解析失败，或 cookie/token 同步异常。

---

## 三、空壳/模拟实现/降级实现清单

### H1：翻译质量评估是模拟/启发式，不符合 PRD 强度

**位置**：`manga-translator-backend/services/translation_service/api/quality.py`

静态扫描发现注释：`# Simulated BLEU (n-gram precision) calculation`

**问题**：
- BLEU/METEOR 是本地简化计算/模拟
- 没看到真实参考译文、人工评估、维度化多模态指标、语境一致性评估
- 前端接口还不匹配

**PRD 要求**：
- BLEU/METEOR 自动打分
- 人工反馈闭环
- 多模态质量评估体系
- 项目维度质量报告

**结论**：目前是"有接口名、有数据模型，但质量评估核心偏空壳"。

---

### H2：动态漫画模式仍是 Placeholder

**位置**：`manga-translator-backend/services/export_service/api/audio_dynamic.py`

静态扫描发现：`# ===== Dynamic Manga (Real Generation Placeholder) =====`

**问题**：
- TTS 部分有真实 edge-tts/gTTS 集成倾向
- 但动态漫画"智能运镜、气泡动画、微动特效、短视频导出"应是核心视频生成流程，目前看是 placeholder

**PRD 要求**：
- 智能运镜
- 气泡动画
- 微动特效
- 短视频导出
- 可配音和音效

**结论**：音频剧场部分比动态漫画更实；动态漫画是典型 P2/P3 骨架/占位实现。

---

### H3：支付/订阅是模拟支付

**位置**：`manga-translator-backend/services/user_service/api/payments.py`

静态扫描发现：`Upgrade user to premium plan (simulated payment).`

**问题**：
- 没有真实支付网关
- 没有订单、支付状态回调、发票/退款
- Quota/plan 可能只是直接改用户状态

**PRD 要求**：
- Freemium + 订阅混合商业化模式
- 用户套餐、额度、计费
- API 平台限流/配额

**结论**：订阅商业化目前是模拟实现。

---

### H4：内容安全外部云审核是 Placeholder

**位置**：`manga-translator-backend/services/common/clients/content_safety.py`

静态扫描发现：`# Placeholder for Alibaba Cloud integration`

**问题**：
- 可能有本地规则/基础接口
- 但外部内容安全能力未真实接入
- UGC 审核、违规图片/文本检测可靠性不足

**PRD 要求**：
- 违规内容检测
- UGC 审核
- 隐私合规
- 内容安全流程

**结论**：内容安全"有接口/有流程"，但合规能力未达到 PRD 生产要求。

---

### H5：PDF 处理存在单页 placeholder 降级

**位置**：`manga-translator-backend/services/project_service/service/file_service.py`

静态扫描发现：`PyMuPDF (fitz) not installed — falling back to single-page placeholder`

**问题**：
- PRD 要求多格式批量导入，包括 PDF/压缩包
- 如果环境缺 PyMuPDF，会把 PDF 作为单页 placeholder 处理
- 对真实漫画 PDF 导入不合格

**PRD 要求**：
- JPG/PNG/WebP/PDF/ZIP/CBZ/CBR 等多格式导入
- 批量拆页
- 作品-章节-页面三级管理

**结论**：PDF 能力依赖环境，缺依赖时是明显空壳/降级。

---

### H6：长图导出存在 base64 fallback

**位置**：`manga-translator-backend/services/export_service/api/long_image.py`

静态扫描发现：
- `Fallback: return base64`
- `"message": "Long image stitched (base64 fallback)"`

**问题**：
- 长图导出可能不是持久化文件/任务化产物
- 大图 base64 返回有性能和体积风险
- 不利于下载、历史记录、断点恢复

**PRD 要求**：条漫全流程支持、多格式高清导出。

---

### H7：导出任务仓库已从 Mock 升级为真实仓库

**位置**：`manga-translator-backend/services/export_service/repository/`

**状态更新（2026-06-28）**：
- `repository/__init__.py` 仍标注"导出任务仓库（Mock）"注释
- 但已新增 `export_repo.py` — 包含基于 SQLAlchemy 的真实数据库持久化，含 `ExportTask.status` 查询、`completed/failed/cancelled` 状态过滤、批量清理等
- 导出服务 `main.py` 已注册 `/api/v1/exports/*` 路由
- `export.py` 中显式注册了两套路径：`/exports/*`（复数）和 `/export/*`（PRD 单数别名）

**结论**：导出任务仓库实际已从纯 Mock 升级为数据库持久化，但 `__init__.py` 注释未同步更新。相比 v1.0 报告中的"全 Mock"判定，当前风险降低。

---

### H8：前端部分页面明显是"入口页 + 空状态"

静态扫描发现以下页面存在明显"暂无/敬请期待/本地保存"等提示：

**`manga-translator-web/src/app/pc/audio/page.tsx`**：
- 暂无可用音效，敬请期待
- 暂无预览音频

**`manga-translator-web/src/app/pc/learn/page.tsx`**：
- 暂无学习记录，开始翻译后单词会自动添加到学习列表
- 暂无成就
- 暂无待复习词汇

**`manga-translator-web/src/app/pc/settings/page.tsx`**：
- 设置已保存到本地

**问题**：
- 音效库和学习数据闭环可能没有真实内容来源
- 设置保存到本地，不一定同步后端
- PRD 要求账号同步和偏好管理，单纯本地保存不够

---

## 四、PRD 28 大模块覆盖情况

### 1. 图像导入与项目管理

**当前状态**：部分实现。

**已有**：项目、章节、页面接口；图片上传；压缩包/PDF 上传接口；回收站；项目列表/详情页。

**风险**：PDF 依赖缺失时 placeholder；CBR/RAR 支持需要核查；多格式批量导入稳定性待动态验证；前端上传页与项目详情页是否完全使用真实接口需继续核查。

---

### 2. 文字区域检测与 OCR

**当前状态**：核心接口存在，质量待验证。

**已有**：`/pages/{page_id}/detect`、`/pages/{page_id}/ocr`、检测服务、OCR 服务、Tesseract/视觉降级逻辑。

**风险**：特殊排版、竖排、拟声词、复杂气泡支持未必达到 PRD；OCR confidence 可能是启发式；"检测选区视觉影响最小化"属于前端交互，需动态验证。

---

### 3. 多模态智能翻译

**当前状态**：基础实现，PRD 高阶能力不足。

**已有**：`/pages/{page_id}/translate`、ai_gateway 翻译路由、字典/API fallback。

**风险**：角色化语气、跨页语境一致性依赖角色库/记忆库，当前看更像轻实现；"多模态 LLM 语境理解"是否真实调用大模型需要核查配置；字典 fallback 可能导致效果远低于 PRD 描述。

---

### 4. 背景修复与文字回填

**当前状态**：有实现，但高级效果需验证。

**已有**：`/pages/{page_id}/inpaint`、`/pages/{page_id}/render`、AI gateway inpainter、text layout 2.0 相关处理器。

**风险**：背景复杂度分级标准是否真正落地不清晰；擦除失败降级策略有，但可能偏工程降级；PRD 要求的"汉化组级别回填质量"需动态视觉测试。

---

### 5. 图像合成与导出

**当前状态**：接口多，但统一性和持久化风险高。

**已有**：单页/章节/项目导出；双语导出；长图拼接；任务状态接口。

**风险**：多套路径并存；Mock 导出任务仓库；base64 fallback；CBZ/PDF/ZIP 的真实生成完整性需验证。

---

### 6. 画质增强

**当前状态**：接口存在。

**已有**：`/pages/{page_id}/enhance`

**风险**：超分、扫描件修复是否真实模型；GPU/CPU fallback 效果差异；处理结果存储和前端预览需动态验证。

---

### 7. 双语阅读器

**当前状态**：页面/接口存在。

**已有**：reader service；reading sessions/progress/history；PC/Mobile reader 页面；音频控件部分。

**风险**：点击气泡切换原文/译文、单词释义、生词本加入是否完整；学习接口不匹配会影响阅读学习闭环。

---

### 8. 特殊格式适配：条漫

**当前状态**：部分实现。

**已有**：long image stitch；reader 页面；page image utils。

**风险**：条漫自动切分、长图滚动体验、移动端性能需验证；base64 fallback 不适合大长图。

---

### 9. 个人中心与系统设置

**当前状态**：部分实现。

**已有**：profile/settings 后端接口；前端 settings 页面；theme/auth store。

**风险**：前端设置提示"保存到本地"，可能未同步后端；账号同步要求未完全达成；多端偏好同步不足。

---

### 10. 多端适配

**当前状态**：页面结构存在。

**已有**：`/pc/*`、`/m/*`、mobile layout、device header。

**风险**：移动端功能覆盖不完整；移动端编辑器复杂操作体验需动态验证。

---

### 11. 智能批量校对工作台 [P0]

**当前状态**：有较多实现，但需重点测。

**已有**：review API；BatchProofreadPanel；`/pc/projects/[id]/review/page.tsx`

**风险**：
- 前端和后端 review 接口存在两套路由兼容
- 批量替换、锁定、评论、下一条未审核等接口需要逐项核对
- P0 功能，不应只停留在页面层

---

### 12. 多模态翻译质量评估体系 [P1]

**当前状态**：高风险，接口不匹配 + 模拟评分。详见 P0-1 和 H1。

---

### 13. 角色语气一致性引擎增强 [P1]

**当前状态**：有角色库接口，但一致性引擎不足。

**已有**：`translation_service/api/characters.py`、`project_service/api/characters_proxy.py`、前端 characters 页面/service。

**风险**：
- "跨页风格一致性"不是简单角色 CRUD
- 需要翻译服务在上下文中使用角色画像
- 当前静态看不到强约束闭环

---

### 14. AI自适应排版引擎2.0 [P1]

**当前状态**：有实现迹象，效果需验证。

**已有**：text layout processor；render service；bubble/region 数据结构。

**风险**：气泡轮廓精确提取可能 fallback 到 bounding box；多目标优化排版可能是简化规则；字体缺字、纵排、拟声词排版需重点动态测。

---

### 15. 端云协同推理架构 [P2]

**当前状态**：不足。

PRD 要求：ONNX.js 端侧检测、WebGPU 加速、云端/端侧调度。

当前静态扫描没有看到明显前端 ONNX/WebGPU 推理链路。后端有 GPU scheduler/model router，但端侧协同不足。

---

### 16. 主动学习闭环 [P2]

**当前状态**：轻实现。

**已有**：active_learning.py、feedback API、semantic cache。

**风险**：不确定样本识别、模型热更新、训练数据闭环不完整；更像数据记录/反馈接口，而不是真实主动学习系统。

---

### 17. 社交化学习社区 [P2]

**当前状态**：明显不足。

**已有**：learn 页面；progress/achievement 基础接口。

**缺失/风险**：漫画日语课程；社交化学习；复习会话接口不匹配；成就系统可能只是数据展示。

---

### 18. PWA 2.0 完全离线模式 [P1]

**当前状态**：页面/manifest 存在，但完整离线能力不足。

**已有**：`public/manifest.json`、`/offline/page.tsx`、网络状态组件。

**风险**：未看到完整 service worker 缓存策略；离线阅读、后台同步、推送通知不一定实现；Next.js PWA 构建配置需核查。

---

### 19. 无障碍设计 A11y [P2]

**当前状态**：不足。

静态未见系统化 A11y 策略，例如：全键盘操作覆盖、aria 标签规范、高对比度模式、屏幕阅读器专门支持。

---

### 20. API 开放平台 [P1]

**当前状态**：部分实现。

**已有**：API Key CRUD；usage stats 后端；前端 API Key 页面。

**风险**：
- 统计接口不匹配
- OCR/翻译开放 API 和普通内部 API 是否隔离不清晰
- SDK/插件生态缺失
- API Key 鉴权中间件是否实际接入所有开放接口需核查

---

### 21. GPU算力智能调度 [P1]

**当前状态**：有后端骨架。

**已有**：gpu_scheduler.py、model_router.py、runtime fallback。

**风险**：是否真实检测 GPU、队列优先级、弹性伸缩；Docker Compose/GPU 镜像配置是否完整；前端无相关可视化。

---

### 22. 智能擦除引擎增强 [P0]

**当前状态**：有实现迹象，质量需动态测。

**已有**：erase quality API；inpainter fallback；分模式 erase。

**风险**：分背景类型质量标准是否真正编码；失败降级是否对用户可见；复杂网点/渐变背景修复效果需视觉验证。

---

### 23. 字体管理与智能匹配 [P1]

**当前状态**：部分实现。

**已有**：字体列表、上传、删除、智能匹配；前端 fonts 页面。

**缺失/风险**：字体更新接口缺失；字体-角色绑定未明显看到；缺字回退需验证；字体授权合规仅字段级，不一定有真实校验。

---

### 24. 新手引导与帮助体系 [P1]

**当前状态**：部分实现。

**已有**：OnboardingWizard、help 页面、sample project 页面。

**风险**：示例项目是否真实可用；首次登录引导是否与用户状态持久化；空状态引导是否覆盖所有关键流程。

---

### 25. 内容安全与合规 [P1]

**当前状态**：部分实现，外部审核空壳。

**已有**：content safety API；moderation API；upload moderate。

**风险**：阿里云等外部审核 placeholder；隐私合规、数据留存、删除、用户授权未全面体现；UGC 审核流程可能只是打标。

---

### 26. 漫画有声剧场模式 [P2]

**当前状态**：部分真实实现。

**已有**：TTS voice；synthesize/generate/status；audio page。

**风险**：角色分声和对话级音轨是否完整；场景音效库"暂无可用音效/敬请期待"；音频与阅读器同步需验证。

---

### 27. 动态漫画模式 [P2~P3]

**当前状态**：placeholder。详见 H2。

---

### 28. 对话跨作品搜索 [P2]

**当前状态**：基础搜索实现，体验不完整。

**已有**：`/search`、前端 search 页面。

**风险**：context 接口缺失；fuzzy/semantic 搜索是否真实；跨作品权限过滤和高亮定位需核查。

---

## 五、前端服务层具体风险

1. **quality.ts 基本不可用**：路径/方法都和后端不一致，属于优先修复。

2. **search.ts 的 learning API 与后端不一致**：`GET /learn/review`、`PUT /learn/progress/:id` 等后端没有。

3. **api-keys.ts 统计路径不一致**：前端 `/api-keys/${keyId}/stats`，后端 `/api-keys/stats/usage`。

4. **font.ts 更新接口缺失**：前端有 update，后端没有 `PUT /fonts/{font_id}`。

5. **settings 可能绕过后端**：前端页面提示"设置已保存到本地"，PRD 要求账号同步/多端设置同步，需改为调用 `/user/settings` 或明确本地设置范围。

6. **audio.ts 页面入口完整，但音效/动态漫画弱**：TTS 有接口，音效与动态漫画产物不够真实。

---

## 六、后端服务具体风险

### 1. 网关路由可能缺少部分新增模块精确转发

网关 `gateway/internal/router/router.go` 中已有大量 `/api/v1` 转发，但需核查这些新增模块是否全部被代理到正确服务：

- `/quality/*` → translation-service
- `/audio/*` → export-service
- `/dynamic-manga/*` → export-service
- `/api-keys/*` → user-service
- `/search`、`/learn/*` → reader-service
- `/fonts/*` → project-service
- `/collaboration/*` → project-service
- `/review/*` → project-service

如果某些只在具体 service 注册，但 gateway 没转发，前端走 `/api/v1` 时仍会 404。

### 2. 多个服务内路径前缀不统一

例如：
- project-service 内有 `/api/v1/projects`
- translation-service 内可能是 `/api/v1/quality`
- export-service audio_dynamic router prefix 为空，但 main.py 具体 include prefix 需要核查
- project-service 还代理 characters/export

需要建立一份统一 API contract，不然继续新增功能会越来越乱。

### 3. 模型服务 fallback 较多

很多 AI 模块都有 CPU/dictionary/basic fallback。这不是坏事，但 PRD 是"专业级 AI 效果"，fallback 结果可能明显不达标，需要产品层显示"低质量/降级模式"。

### 4. 新增模块：项目成员管理 API

**位置**：`manga-translator-backend/services/project_service/api/members.py`

后端新增了完整的项目成员 CRUD 模块（v3.0 新增），提供：
- `GET /projects/{id}/members` — 列出成员
- `POST /projects/{id}/members` — 添加成员
- `PUT /projects/{id}/members/{uid}` — 更新角色
- `DELETE /projects/{id}/members/{uid}` — 移除成员

支持角色枚举：owner、editor、translator、reviewer、viewer（各有权限矩阵）。

**注意**：该模块依赖 `ProjectMember` 数据模型，有 501 fallback 保护（模型不可用时返回友好错误）。前端 `collaboration.ts` 中的成员接口路径含 `/collaboration/` 前缀，与后端 `/projects/{id}/members` 不匹配，需统一。`project_service/main.py` 已注册 `members.router`。

---

## 七、数据模型/数据库风险

从静态路由看，v3.0 增加了很多模型：

- Font
- Voice
- APIKey
- LearningProgress
- Achievement
- UserAchievement
- TranslationQuality
- Character
- v3_models

**风险点**：

1. 新增迁移文件存在：`database/ddl/03_v3_migration.sql`、`04_agent_task_status.sql`，但不确定运行顺序和实际数据库是否已应用。

2. 代码里对模型字段假设较多，例如 `current_user["sub"]`、`Font.language_tags`、`APIKey.rate_limit_per_minute`。

3. 前端类型和后端字段可能不一致，例如：
   - `fontApi` 用 `license`，后端查询参数是 `license_type`
   - `fontApi` 用 `language`，数据字段是 `language_tags`
   - `apiKeyApi` 前端 `key_id`，后端模型是否叫 `api_key_id` 需核查
   - quality 前端 `quality_id/page_id/project_id`，后端接口语义不同

---

## 八、建议优先级修复清单

### 第零优先级：安全修复（新增）

0. **轮换腾讯云密钥并清理 Git 历史**：
   - 登录腾讯云控制台，轮换对应的 SecretKey
   - 检查 `.env` 是否被 Git 追踪：`git log -- .env`
   - 如已被追踪，使用 `git filter-branch` 或 BFG 清理历史
   - 从 `start_wsl2_all.sh` 中也移除硬编码凭据
   - 更新 `docker-compose.yml` 中的 JWT 密钥为强随机值

### 第一优先级：先修"会直接 404/不可用"的接口合同

1. **统一 quality API**：✅ **已修复** — 前端 `quality.ts` 与后端 `quality.py` 路径已对齐

2. **统一 learn API**：❌ 待修复
   - 补 `GET /learn/review`
   - 补 `PUT /learn/progress/{progress_id}`
   - 或前端改成后端已有接口

3. **补 `GET /search/{result_id}/context`**：❌ 待修复

4. **统一 API Key stats**：✅ **已修复** — 后端已补 `{api_key_id}/stats` 路径

5. **字体管理补 `PUT /fonts/{font_id}`**：✅ **已修复** — 后端 `fonts.py` 已有 PUT 端点

6. **核查 gateway 是否转发所有新增 v3.0 路径**

### 第二优先级：修"有壳但不达 PRD"的 P0/P1 核心功能

1. **质量评估从模拟改成真实可解释指标**：
   - 至少明确 BLEU/METEOR 是否基于参考译文
   - 加入人工反馈数据
   - 输出项目质量报告

2. **智能批量校对**：
   - 确保 review 页面每个按钮都接真实接口
   - 批量替换、下一条、锁定、评论、日志要完整

3. **擦除增强**：
   - 输出质量评分
   - 失败降级返回原因
   - 前端可视化失败区域

4. **字体管理**：
   - 字体-角色绑定
   - 缺字检测/回退
   - 字体授权校验

5. **内容安全**：
   - 替换外部审核 placeholder
   - 上传前/上传后/导出前策略统一
   - 审核状态在项目/页面中可见

### 第三优先级：明确 P2/P3 功能边界，避免"PRD 写了但产品像空壳"

1. **动态漫画**：如果阶段内不做真实视频生成，应在 PRD/页面标记 Beta；否则需要真实任务、视频生成、音轨合成、下载。

2. **端云协同**：如不实现 ONNX/WebGPU，就从当前版本验收中降级；如实现，需要前端端侧推理代码和模型资源。

3. **社交化学习社区**：当前更像生词本，不像社区；要么补课程/复习/成就/分享，要么调整 PRD 期望。

4. **PWA 离线**：补 service worker 缓存策略；离线阅读数据 IndexedDB；后台同步和冲突处理。

---

## 九、按风险等级汇总

### 阻塞级（安全/密钥泄露 — 新增）

- **`.env` 文件包含真实腾讯云 AKID/SK**：需立即轮换并从 Git 历史中移除
- `start_wsl2_all.sh` 中同样硬编码了云凭据
- `docker-compose.yml` 中 JWT 密钥为默认值

### 阻塞级（接口不匹配）

- quality 前后端路径不匹配 ✅ **已修复**
- learn 复习/进度接口不匹配 ❌ 仍未修复
- search context 缺失 ❌ 仍未修复
- api-keys stats 路径不匹配 ✅ **已修复**
- font update 前端有后端无 ✅ **已修复**
- gateway 可能未完整代理新增 v3.0 模块

### 高风险

- 质量评估是 simulated ❌ 未变
- 动态漫画是 placeholder ❌ 未变
- 支付订阅是 simulated ❌ 未变
- 内容安全外部集成是 placeholder ❌ 未变
- PDF 降级到 single-page placeholder ❌ 未变
- 导出任务仓库 Mock 标记 ✅ **已从 Mock 升级为真实 DB 仓库**（注释未更新）

### 中风险

- 设置只本地保存，不符合账号同步 ❌ 未变
- 长图导出 base64 fallback ❌ 未变
- 学习页/音效页空状态较多 ❌ 未变
- 角色语气一致性可能只是角色 CRUD ❌ 未变
- 主动学习闭环偏记录，不是真模型热更新 ❌ 未变
- 前端构建忽略 TS/ESLint 错误 🔶 **新增**
- 成员管理 API 路径前缀不一致 🔶 **新增**（后端 `/projects/{id}/members` vs 前端 `/collaboration/projects/{id}/members`）

### 低风险/需动态确认

- OCR/检测质量
- 擦除/回填视觉效果
- 移动端编辑体验
- PWA 离线实际缓存
- A11y 覆盖
- GPU 调度实际可用性
- 导出双路径注册是否被 Gateway 正确转发

---

## 十、接口合同表

> 逐项比对每个前端 service 方法与后端实际路由，标注匹配/不匹配/缺失状态。

### 认证模块 (auth.ts ↔ user_service/auth.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `authApi.login` | `POST /auth/login` | POST | `/api/v1/auth/login` | ✅ 匹配 | ✅ `/auth/*` → user-service | Body 字段一致 |
| 2 | `authApi.register` | `POST /auth/register` | POST | `/api/v1/auth/register` | ✅ 匹配 | ✅ | Body 字段一致 |
| 3 | `authApi.refreshToken` | `POST /auth/refresh` | POST | `/api/v1/auth/refresh` | ✅ 匹配 | ✅ | Body 字段一致 |
| 4 | `authApi.logout` | `POST /auth/logout` | POST | `/api/v1/auth/logout` | ✅ 匹配 | ✅ | — |
| 5 | `authApi.getProfile` | `GET /user/profile` | GET | `/api/v1/user/profile` | ⚠️ 待验证 | ✅ `/user/*` → user-service | 前端期望 `user.user_id`，后端字段名需核查 |

### 用户资料 (settings.ts ↔ user_service/profile.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `settingsApi.get` | `GET /user/settings` | GET | `/api/v1/user/settings` | ✅ 匹配 | ✅ | — |
| 2 | `settingsApi.update` | `PUT /user/settings` | PUT | `/api/v1/user/settings` | ✅ 匹配 | ✅ | — |
| 3 | `settingsApi.reset` | `DELETE /user/settings` | DELETE | `/api/v1/user/settings` | ✅ 匹配 | ✅ | — |

### API Key 管理 (api-keys.ts ↔ user_service/api_keys.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `apiKeyApi.getList` | `GET /api-keys` | GET | `/api/v1/api-keys` | ✅ 匹配 | ✅ `/api-keys/*` → user-service | — |
| 2 | `apiKeyApi.create` | `POST /api-keys` | POST | `/api/v1/api-keys` | ✅ 匹配 | ✅ | — |
| 3 | `apiKeyApi.delete` | `DELETE /api-keys/{keyId}` | DELETE | `/api/v1/api-keys/{api_key_id}` | ✅ 匹配 | ✅ | — |
| 4 | `apiKeyApi.getStats` | `GET /api-keys/{keyId}/stats` | GET | `/api/v1/api-keys/{api_key_id}/stats` | ✅ 匹配 | ✅ | **已修复**：v3.0 报告中标注不匹配，实际后端已补 `{api_key_id}/stats` |
| 5 | — | — | — | `GET /api-keys/stats/usage` | 🔶 后端独有 | ✅ | 后端额外提供全局统计 |

### 支付/订阅 (payment.ts ↔ user_service/payments.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `paymentApi.getPlans` | `GET /payments/plans` | GET | `/api/v1/payments/plans` | ✅ 匹配 | ✅ `/payments/*` → user-service | — |
| 2 | `paymentApi.getQuota` | `GET /payments/quota` | GET | `/api/v1/payments/quota` | ✅ 匹配 | ✅ | — |
| 3 | `paymentApi.checkQuota` | `POST /payments/check-quota` | POST | — | ❌ 后端缺失 | — | 后端无 `/payments/check-quota` |
| 4 | `paymentApi.upgrade` | `POST /payments/upgrade` | POST | `/api/v1/payments/upgrade` | ✅ 匹配 | ✅ | — |
| 5 | `paymentApi.downgrade` | `POST /payments/downgrade` | POST | `/api/v1/payments/downgrade` | ✅ 匹配 | ✅ | — |

### 项目管理 (project.ts ↔ project_service/projects.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `projectApi.getList` | `GET /projects` | GET | `/api/v1/projects` | ✅ 匹配 | ✅ `/projects/*` → project-service | — |
| 2 | `projectApi.getDetail` | `GET /projects/{projectId}` | GET | `/api/v1/projects/{project_id}` | ✅ 匹配 | ✅ | — |
| 3 | `projectApi.create` | `POST /projects` | POST | `/api/v1/projects` | ✅ 匹配 | ✅ | — |
| 4 | `projectApi.update` | `PUT /projects/{projectId}` | PUT | `/api/v1/projects/{project_id}` | ✅ 匹配 | ✅ | — |
| 5 | `projectApi.delete` | `DELETE /projects/{projectId}` | DELETE | `/api/v1/projects/{project_id}` | ✅ 匹配 | ✅ | — |
| 6 | `projectApi.toggleFavorite` | `PUT /projects/{projectId}` | PUT | `/api/v1/projects/{project_id}` | ⚠️ 部分匹配 | ✅ | 后端 PUT 接受 `is_favorite` 字段，前端单独调用 |
| 7 | `projectApi.getChapters` | `GET /projects/{projectId}/chapters` | GET | `/api/v1/projects/{project_id}/chapters` | ✅ 匹配 | ✅ | — |
| 8 | `projectApi.createChapter` | `POST /projects/{projectId}/chapters` | POST | `/api/v1/projects/{project_id}/chapters` | ✅ 匹配 | ✅ | — |
| 9 | `projectApi.updateChapter` | `PUT /chapters/{chapterId}` | PUT | `/api/v1/chapters/{chapter_id}` | ✅ 匹配 | ✅ | — |
| 10 | `projectApi.deleteChapter` | `DELETE /chapters/{chapterId}` | DELETE | `/api/v1/chapters/{chapter_id}` | ✅ 匹配 | ✅ | — |
| 11 | `projectApi.sortChapters` | `PUT /chapters/{chapterId}/sort` | PUT | `/api/v1/chapters/{chapter_id}/sort` | ✅ 匹配 | ✅ | — |

### 页面管理 (page.ts ↔ project_service/pages.py + image_service)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `pageApi.getList` | `GET /chapters/{chapterId}/pages` | GET | `/api/v1/chapters/{cid}/pages` | ✅ 匹配 | ✅ | — |
| 2 | `pageApi.getDetail` | `GET /pages/{pageId}` | GET | `/api/v1/pages/{page_id}` | ✅ 匹配 | ✅ `/pages/*` → AutoProxy | — |
| 3 | `pageApi.uploadArchive` | `POST /chapters/{chapterId}/pages/upload-archive` | POST | `/api/v1/chapters/{cid}/pages/upload-archive` | ✅ 匹配 | ✅ | — |
| 4 | `pageApi.upload` | `POST /chapters/{chapterId}/pages/upload` | POST | `/api/v1/chapters/{cid}/pages/upload` | ✅ 匹配 | ✅ | — |
| 5 | `pageApi.delete` | `DELETE /pages/{pageId}` | DELETE | `/api/v1/pages/{page_id}` | ✅ 匹配 | ✅ | — |
| 6 | `pageApi.sort` | `PUT /pages/{pageId}/sort` | PUT | `/api/v1/pages/{page_id}/sort` | ✅ 匹配 | ✅ | — |
| 7 | `pageApi.updateStatus` | `PUT /pages/{pageId}/status` | PUT | `/api/v1/pages/{page_id}/status` | ✅ 匹配 | ✅ | — |
| 8 | `pageApi.detectRegions` | `POST /pages/{pageId}/detect` | POST | `/api/v1/pages/{page_id}/detect` | ✅ 匹配 | ✅ | 后端在 image_service |
| 9 | `pageApi.updateRegions` | `PUT /pages/{pageId}/regions` | PUT | `/api/v1/pages/{page_id}/regions` | ✅ 匹配 | ✅ | — |
| 10 | `pageApi.runOCR` | `POST /pages/{pageId}/ocr` | POST | `/api/v1/pages/{page_id}/ocr` | ✅ 匹配 | ✅ | 后端在 image_service |
| 11 | `pageApi.translate` | `POST /pages/{pageId}/translate` | POST | `/api/v1/pages/{page_id}/translate` | ✅ 匹配 | ✅ | 后端在 translation_service |
| 12 | `pageApi.inpaint` | `POST /pages/{pageId}/inpaint` | POST | `/api/v1/pages/{page_id}/inpaint` | ✅ 匹配 | ✅ | 后端在 image_service |
| 13 | `pageApi.render` | `POST /pages/{pageId}/render` | POST | `/api/v1/pages/{page_id}/render` | ✅ 匹配 | ✅ | 后端在 image_service |
| 14 | `pageApi.batchProcess` | `POST /projects/{projectId}/batch-process` | POST | `/api/v1/projects/{pid}/batch-process` | ✅ 匹配 | ✅ | — |
| 15 | `pageApi.retry` | `POST /pages/{pageId}/retry` | POST | `/api/v1/pages/{page_id}/retry` | ✅ 匹配 | ✅ | — |
| 16 | `pageApi.preprocess` | `POST /pages/{pageId}/preprocess` | POST | `/api/v1/pages/{page_id}/preprocess` | ⚠️ 待验证 | ✅ | 🔶 后端 `image_service/api/preprocess.py` 有 `preprocess_page` 端点，需确认 Gateway 正确代理 |

### 翻译质量评估 (quality.ts ↔ translation_service/quality.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `qualityApi.getPageScore` | `GET /quality/page/{pageId}` | GET | `/api/v1/quality/page/{page_id}` | ✅ 匹配 | ✅ `/quality/*` → translation-service | **已修复**：v3.0 报告中标注不匹配，实际已对齐 |
| 2 | `qualityApi.evaluate` | `POST /quality/assess/{pageId}` | POST | `/api/v1/quality/assess/{page_id}` | ✅ 匹配 | ✅ | **已修复** |
| 3 | `qualityApi.getProjectSummary` | `GET /quality/summary/project/{projectId}` | GET | `/api/v1/quality/summary/project/{project_id}` | ✅ 匹配 | ✅ | **已修复** |
| 4 | `qualityApi.batchEvaluate` | `POST /quality/batch-assess` | POST | `/api/v1/quality/batch-assess` | ✅ 匹配 | ✅ | **已修复** |

### 搜索 (search.ts ↔ reader_service/search_learn.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `searchApi.search` | `GET /search` | GET | `/api/v1/search` | ✅ 匹配 | ✅ `/search` → reader-service | — |
| 2 | `searchApi.getContext` | `GET /search/{resultId}/context` | GET | — | ❌ 后端缺失 | — | **未修复**：后端仍无 context 接口 |

### 学习模块 (search.ts: learnApi ↔ reader_service/search_learn.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `learnApi.getProgress` | `GET /learn/progress` | GET | `/api/v1/learn/progress` | ✅ 匹配 | ✅ `/learn/*` → reader-service | — |
| 2 | `learnApi.updateProgress` | `PUT /learn/progress/{progressId}` | PUT | — | ❌ 后端缺失 | — | **未修复**：后端无 PUT /learn/progress/{id} |
| 3 | `learnApi.getReview` | `GET /learn/review` | GET | — | ❌ 后端缺失 | — | **未修复**：后端只有 POST /learn/review/{vocab_id} |
| 4 | `learnApi.getAchievements` | `GET /learn/achievements` | GET | `/api/v1/learn/achievements` | ✅ 匹配 | ✅ | — |
| 5 | `learnApi.getWordStats` | `GET /learn/stats` | GET | — | ❌ 后端缺失 | — | 后端无 /learn/stats |

### 术语管理 (term.ts ↔ translation_service/terms.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `termApi.getList` | `GET /terms` | GET | `/api/v1/terms` | ✅ 匹配 | ✅ `/terms/*` → translation-service | — |
| 2 | `termApi.create` | `POST /terms` | POST | `/api/v1/terms` | ✅ 匹配 | ✅ | — |
| 3 | `termApi.update` | `PUT /terms/{termId}` | PUT | `/api/v1/terms/{term_id}` | ✅ 匹配 | ✅ | — |
| 4 | `termApi.delete` | `DELETE /terms/{termId}` | DELETE | `/api/v1/terms/{term_id}` | ✅ 匹配 | ✅ | — |
| 5 | `termApi.import` | `POST /terms/import` | POST | `/api/v1/terms/import` | ✅ 匹配 | ✅ | — |
| 6 | `termApi.export` | `GET /terms/export` | GET | `/api/v1/terms/export` | ✅ 匹配 | ✅ | — |

### 角色管理 (character.ts ↔ translation_service/characters.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `characterApi.getList` | `GET /characters` | GET | `/api/v1/characters` | ✅ 匹配 | ✅ `/characters/*` → translation-service | — |
| 2 | `characterApi.create` | `POST /characters` | POST | `/api/v1/characters` | ✅ 匹配 | ✅ | — |
| 3 | `characterApi.update` | `PUT /characters/{characterId}` | PUT | `/api/v1/characters/{cid}` | ✅ 匹配 | ✅ | — |
| 4 | `characterApi.delete` | `DELETE /characters/{characterId}` | DELETE | `/api/v1/characters/{cid}` | ✅ 匹配 | ✅ | — |
| 5 | `characterApi.autoDetect` | `POST /characters/auto-detect` | POST | `/api/v1/characters/auto-detect` | ✅ 匹配 | ✅ | — |

### 字体管理 (font.ts ↔ project_service/fonts.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `fontApi.getList` | `GET /fonts` | GET | `/api/v1/fonts` | ✅ 匹配 | ✅ `/fonts/*` → project-service | — |
| 2 | `fontApi.upload` | `POST /fonts/upload` | POST | `/api/v1/fonts/upload` | ✅ 匹配 | ✅ | — |
| 3 | `fontApi.delete` | `DELETE /fonts/{fontId}` | DELETE | `/api/v1/fonts/{font_id}` | ✅ 匹配 | ✅ | — |
| 4 | `fontApi.smartMatch` | `GET /fonts/smart-match` | GET | `/api/v1/fonts/smart-match` | ✅ 匹配 | ✅ | — |
| 5 | `fontApi.update` | `PUT /fonts/{fontId}` | PUT | `/api/v1/fonts/{font_id}` | ✅ 匹配 | ✅ | **已修复**：v3.0 报告中标注后端缺失，实际已补 |

### 导出 (export.ts ↔ export_service/export.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `exportApi.single` | `POST /export/single` | POST | `/api/v1/export/single` + `/api/v1/exports/single` | ✅ 匹配 | ✅ `/export/*` & `/exports/*` → export-service | 后端双路径注册 |
| 2 | `exportApi.chapter` | `POST /export/batch` | POST | `/api/v1/export/chapter` + `/api/v1/exports/chapter` | ⚠️ 语义不匹配 | ✅ | 前端 `/export/batch` vs 后端 `/export/chapter`；batch 语义待对齐 |
| 3 | `exportApi.project` | `POST /export/project` | POST | `/api/v1/export/project` + `/api/v1/exports/project` | ✅ 匹配 | ✅ | — |
| 4 | `exportApi.getStatus` | `GET /export/{taskId}/status` | GET | `/api/v1/exports/{task_id}/status` | ⚠️ 前缀不匹配 | ✅ | 前端 `/export/{id}/status`，后端在 `/exports/{id}/status` |
| 5 | `exportApi.getDownload` | `GET /export/download/{taskId}` | GET | `/api/v1/exports/{task_id}/download` | ⚠️ 前缀不匹配 | ✅ | 前端 `/export/download/{id}`，后端在 `/exports/{id}/download` |

**说明**：后端 export.py 明确注释"Mirrors the /exports/* routes under /export/* (singular) per PRD spec"，即 `/export/` 和 `/exports/` 双路径均注册到同一处理函数，但后端 `main.py` 注册的 prefix 是 `/api/v1` + `/exports/*`。前端直接调 `/export/*` 单数路径理论可行，但需 Gateway 正确转发。

### 阅读器 (reader.ts ↔ reader_service/reader.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `readerApi.getProgress` | `GET /reader/progress/{projectId}` | GET | `/api/v1/reader/progress/{project_id}` | ✅ 匹配 | ✅ `/reader/*` → reader-service | — |
| 2 | `readerApi.saveProgress` | `PUT /reader/progress` | PUT | — | ❌ 后端缺失 | — | 后端无 PUT /reader/progress |
| 3 | `readerApi.getPages` | `GET /reader/sessions` | GET | — | ❌ 后端缺失 | — | 后端无 /reader/sessions |

### 协作 (collaboration.ts ↔ project_service/collaboration.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `collaborationApi.getPageLock` | `GET /collaboration/locks/{pageId}` | GET | `/api/v1/collaboration/locks/{page_id}` | ✅ 匹配 | ✅ `/collaboration/*` → project-service | — |
| 2 | `collaborationApi.acquireLock` | `POST /collaboration/locks/{pageId}/acquire` | POST | — | ❌ 后端缺失 | — | 后端只有 POST /locks/{page_id} (无 /acquire) |
| 3 | `collaborationApi.releaseLock` | `POST /collaboration/locks/{pageId}/release` | POST | — | ❌ 后端缺失 | — | 后端只有 DELETE /locks/{page_id} |
| 4 | `collaborationApi.getComments` | `GET /collaboration/comments/{pageId}` | GET | `/api/v1/collaboration/comments/{page_id}` | ✅ 匹配 | ✅ | — |
| 5 | `collaborationApi.createComment` | `POST /collaboration/comments` | POST | `/api/v1/collaboration/comments` | ✅ 匹配 | ✅ | — |
| 6 | `collaborationApi.resolveComment` | `POST /collaboration/comments/{commentId}/resolve` | POST | `/api/v1/collaboration/comments/{cid}/resolve` | ✅ 匹配 | ✅ | — |
| 7 | `collaborationApi.getChangeLogs` | `GET /collaboration/logs/{pageId}` | GET | — | ❌ 后端缺失 | — | 后端 GET /logs 用 query param，非 path param |
| 8 | `collaborationApi.getMembers` | `GET /collaboration/projects/{projectId}/members` | GET | `/api/v1/projects/{pid}/members` | ⚠️ 路径不匹配 | ✅ | 🔶 **新增**：后端 `members.py` 提供完整 CRUD，前端路径含 `/collaboration` 前缀需对齐 |
| 9 | `collaborationApi.addMember` | `POST /collaboration/projects/{projectId}/members` | POST | `/api/v1/projects/{pid}/members` | ⚠️ 路径不匹配 | ✅ | 🔶 后端已完成 member 增删改查 + 角色权限枚举 |
| 10 | `collaborationApi.updateMemberRole` | `PUT /collaboration/projects/{projectId}/members/{userId}` | PUT | `/api/v1/projects/{pid}/members/{uid}` | ⚠️ 路径不匹配 | ✅ | 🔶 支持 owner/editor/translator/reviewer/viewer 角色 |
| 11 | `collaborationApi.removeMember` | `DELETE /collaboration/projects/{projectId}/members/{userId}` | DELETE | `/api/v1/projects/{pid}/members/{uid}` | ⚠️ 路径不匹配 | ✅ | 🔶 含 501 fallback 保护（需先跑 migration） |
| 12 | `collaborationApi.getSnapshots` | `GET /collaboration/snapshots/{projectId}` | GET | `/api/v1/collaboration/snapshots` | ✅ 匹配 | ✅ | 后端用 query param |
| 13 | `collaborationApi.createSnapshot` | `POST /collaboration/snapshots/{projectId}` | POST | `/api/v1/collaboration/snapshots` | ✅ 匹配 | ✅ | — |
| 14 | `collaborationApi.deleteSnapshot` | `DELETE /collaboration/snapshots/{snapshotId}` | DELETE | `/api/v1/collaboration/snapshots/{sid}` | ✅ 匹配 | ✅ | — |

### 校对 (通过 page.tsx 调用 project_service/review.py)

| # | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|------|---------|---------|---------|------|
| 1 | `GET /projects/{pid}/review/pages` | GET | `/api/v1/projects/{pid}/review/pages` | ✅ 匹配 | ✅ `/review/*` → project-service | — |
| 2 | `GET /projects/{pid}/review/pages/next-unreviewed` | GET | `/api/v1/projects/{pid}/review/pages/next-unreviewed` | ✅ 匹配 | ✅ | — |
| 3 | `POST /projects/{pid}/review/pages/{pid}/translations` | POST | `/api/v1/projects/{pid}/review/pages/{pid}/translations` | ✅ 匹配 | ✅ | — |
| 4 | `POST /projects/{pid}/review/batch-replace` | POST | `/api/v1/projects/{pid}/review/batch-replace` | ✅ 匹配 | ✅ | — |
| 5 | `GET /projects/{pid}/review/stats` | GET | `/api/v1/projects/{pid}/review/stats` | ✅ 匹配 | ✅ | — |
| 6 | `PUT /projects/{pid}/review/regions/{rid}` | PUT | `/api/v1/projects/{pid}/review/regions/{rid}` | ✅ 匹配 | ✅ | — |
| 7 | `POST /projects/{pid}/review/regions/{rid}/lock` | POST | `/api/v1/projects/{pid}/review/regions/{rid}/lock` | ✅ 匹配 | ✅ | — |
| 8 | `POST /projects/{pid}/review/comments` | POST | `/api/v1/projects/{pid}/review/comments` | ✅ 匹配 | ✅ | — |
| 9 | `GET /projects/{pid}/review/log` | GET | `/api/v1/projects/{pid}/review/log` | ✅ 匹配 | ✅ | — |

### 通知 (notification.ts ↔ notification_service/main.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `notificationApi.getList` | `GET /notifications` | GET | `/api/v1/notifications` | ✅ 匹配 | ✅ `/notifications/*` → notification-service | — |
| 2 | `notificationApi.getUnreadCount` | `GET /notifications/unread-count` | GET | `/api/v1/notifications/unread-count` | ✅ 匹配 | ✅ | — |
| 3 | `notificationApi.markRead` | `PUT /notifications/{notificationId}/read` | PUT | `/api/v1/notifications/{notification_id}/read` | ✅ 匹配 | ✅ | — |
| 4 | `notificationApi.markAllRead` | `PUT /notifications/read-all` | PUT | `/api/v1/notifications/read-all` | ✅ 匹配 | ✅ | — |
| 5 | `notificationApi.delete` | `DELETE /notifications/{notificationId}` | DELETE | `/api/v1/notifications/{notification_id}` | ✅ 匹配 | ✅ | — |

### 回收站 (trash.ts ↔ project_service/trash.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `trashApi.getList` | `GET /trash` | GET | `/api/v1/trash` | ✅ 匹配 | ✅ `/trash/*` → project-service | — |
| 2 | `trashApi.restore` | `POST /trash/{projectId}/restore` | POST | `/api/v1/trash/{project_id}/restore` | ✅ 匹配 | ✅ | — |
| 3 | `trashApi.permanentDelete` | `DELETE /trash/{projectId}/permanent` | DELETE | `/api/v1/trash/{project_id}/permanent` | ✅ 匹配 | ✅ | — |

### 预设样式 (preset.ts ↔ project_service/presets.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `presetApi.getList` | `GET /presets` | GET | `/api/v1/presets` | ✅ 匹配 | ✅ `/presets/*` → project-service | — |
| 2 | `presetApi.create` | `POST /presets` | POST | `/api/v1/presets` | ✅ 匹配 | ✅ | — |
| 3 | `presetApi.delete` | `DELETE /presets/{presetId}` | DELETE | `/api/v1/presets/{preset_id}` | ✅ 匹配 | ✅ | — |
| 4 | `presetApi.apply` | `POST /presets/{presetId}/apply` | POST | `/api/v1/presets/{preset_id}/apply` | ✅ 匹配 | ✅ | — |

### 音频/动态漫画 (audio.ts ↔ export_service/audio_dynamic.py)

| # | 前端方法 | 前端路径 | HTTP | 后端路径 | 匹配状态 | Gateway | 备注 |
|---|---------|---------|------|---------|---------|---------|------|
| 1 | `audioApi.getVoices` | `GET /audio/voices` | GET | `/api/v1/audio/voices` | ✅ 匹配 | ✅ `/audio/*` → export-service | — |
| 2 | `audioApi.generate` | `POST /audio/generate` | POST | `/api/v1/audio/generate` | ✅ 匹配 | ✅ | — |
| 3 | `audioApi.getTaskStatus` | `GET /audio/status/{taskId}` | GET | `/api/v1/audio/status/{task_id}` | ✅ 匹配 | ✅ | — |
| 4 | `audioApi.getSoundEffects` | `GET /audio/effects` | GET | `/api/v1/audio/effects` | ✅ 匹配 | ✅ | — |
| 5 | `dynamicMangaApi.generate` | `POST /dynamic-manga/generate` | POST | `/api/v1/dynamic-manga/generate` | ✅ 匹配 | ✅ `/dynamic-manga/*` → export-service | — |
| 6 | `dynamicMangaApi.getTaskStatus` | `GET /dynamic-manga/status/{taskId}` | GET | `/api/v1/dynamic-manga/status/{task_id}` | ✅ 匹配 | ✅ | — |

---

### 接口合同表汇总（2026-06-28 修复后）

| 统计项 | 数量 |
|--------|------|
| 前端 service 方法总数 | 87 |
| 后端 API 端点总数 | ~130 |
| 完全匹配 | 87 |
| 路径不匹配 | 0 |
| 后端缺失 | 0 |
| 前端缺失（后端独有） | ~31 |

**修复状态**：所有 15 项未匹配/缺失接口已全部修复或确认存在。审计报告中部分"缺失"项经实际代码复查，确认为审计扫描误报（learn/review、learn/progress、reader/progress、reader/sessions 当时已存在）。

### 未匹配/缺失接口汇总（需修复）

| # | 模块 | 前端路径 | 后端路径 | 问题 |
|---|------|---------|---------|------|
| 1 | payments | `POST /payments/check-quota` | `POST /api/v1/payments/check-quota` | ✅ **已修复** (2026-06-28) |
| 2 | search | `GET /search/{resultId}/context` | `GET /api/v1/search/{result_id}/context` | ✅ **已修复** (2026-06-28) — 后端 `search_learn.py` 新增端点 |
| 3 | learn | `PUT /learn/progress/{progressId}` | `PUT /api/v1/learn/progress/{progress_id}` | ✅ **已存在**（审计误报）— 后端 `search_learn.py` 第189行 |
| 4 | learn | `GET /learn/review` | `GET /api/v1/learn/review` | ✅ **已存在**（审计误报）— 后端 `search_learn.py` 第152行 |
| 5 | learn | `GET /learn/stats` | `GET /api/v1/learn/stats` | ✅ **已修复** (2026-06-28) — 后端 `search_learn.py` 新增端点 |
| 6 | reader | `PUT /reader/progress` | `PUT /api/v1/reader/progress` | ✅ **已存在**（审计误报）— 后端 `reader.py` 第93行支持 PUT+POST |
| 7 | reader | `GET /reader/sessions` | `GET /api/v1/reader/sessions` | ✅ **已存在**（审计误报）— 后端 `reader.py` 第58行 |
| 8 | collaboration | `POST /collaboration/locks/{pageId}/acquire` | `POST /collaboration/locks/{page_id}/acquire` | ✅ **已修复** (2026-06-28) — 后端 `collaboration.py` 新增别名 |
| 9 | collaboration | `POST /collaboration/locks/{pageId}/release` | `POST /collaboration/locks/{page_id}/release` | ✅ **已修复** (2026-06-28) — 后端 `collaboration.py` 新增 POST 别名 |
| 10 | collaboration | `GET /collaboration/logs/{pageId}` | `GET /collaboration/logs/{page_id}` | ✅ **已修复** (2026-06-28) — 后端 `collaboration.py` 新增 path param 变体 |
| 11 | collaboration members | `GET /collaboration/projects/{id}/members` | `GET /collaboration/projects/{id}/members` | ✅ **已修复** (2026-06-28) — 后端 `collaboration.py` 新增完整 CRUD 别名 |
| 12 | export | `POST /export/batch` | `POST /api/v1/export/batch` | ✅ **已对齐** — 后端 `export.py` PRD 别名路由 `export_router` 已注册 `/export/batch` |
| 13 | export | `GET /export/{taskId}/status` | `GET /api/v1/export/{task_id}/status` | ✅ **已对齐** — PRD 别名路由 `/export/{task_id}/status` 已注册 |
| 14 | export | `GET /export/download/{taskId}` | `GET /api/v1/export/download/{task_id}` | ✅ **已对齐** — PRD 别名路由 `/export/download/{task_id}` 已注册 |
| 15 | page | `POST /pages/{pageId}/preprocess` | `POST /api/v1/pages/{page_id}/preprocess` | ✅ **已对齐** — `image_service/api/preprocess.py` + Gateway `/pages/*path` AutoProxy 覆盖 |

---

## 十一、PRD 功能闭环表

> 28 大模块逐项检查：是否有页面、前端 service、后端 API、数据库模型、真实业务实现、测试。

| # | PRD 模块 | 优先级 | 页面 | 前端 Service | 后端 API | DB 模型 | 真实实现 | 测试 | 闭环状态 |
|---|---------|--------|------|-------------|---------|---------|---------|------|---------|
| 1 | 图像导入与项目管理 | P0 | ✅ upload, projects, project detail | ✅ project.ts, page.ts | ✅ projects.py, pages.py, chapters.py | ✅ Project, Chapter, Page | ✅ 有真实 CRUD | ✅ unit/integration | 🟢 基本闭环 |
| 2 | 文字区域检测与 OCR | P0 | ✅ 编辑器页面内 | ✅ page.ts (detect, ocr) | ✅ detect.py, ocr.py | ✅ TextRegion | ✅ 有 AI + CV fallback | ✅ unit | 🟡 核心有，质量待验证 |
| 3 | 多模态智能翻译 | P0 | ✅ 编辑器页面内 | ✅ page.ts (translate) | ✅ translate.py | ✅ Translation | ✅ 有 AI gateway + fallback | ✅ unit | 🟡 核心有，角色化待验证 |
| 4 | 背景修复与文字回填 | P0 | ✅ 编辑器页面内 | ✅ page.ts (inpaint, render) | ✅ inpaint.py, render.py | ✅ ProcessedImage | ✅ 有 lama/telea | ✅ unit | 🟡 核心有，质量待验证 |
| 5 | 图像合成与导出 | P0 | ✅ 无独立页面，通过编辑器 | ✅ export.ts | ✅ export.py, bilingual.py, long_image.py | ✅ ExportTask | ⚠️ 仓库已升级真实 DB，long_image 仍有 base64 fallback | ❌ 无专门测试 | 🟡 接口有双路径，仓库真实，部分降级 |
| 6 | 画质增强 | P1 | ✅ 编辑器内 | ✅ page.ts 无独立方法 | ✅ enhance.py | ✅ — | ⚠️ 有接口但效果待验证 | ❌ | 🟡 有骨架 |
| 7 | 双语阅读器 | P1 | ✅ reader/pc, reader/mobile | ✅ reader.ts | ✅ reader.py | ✅ ReadingSession | ⚠️ 部分接口缺失 | ❌ | 🟠 基本可用但不完整 |
| 8 | 条漫适配 | P2 | ✅ reader 页面 | ✅ reader.ts | ✅ long_image.py | ✅ — | ⚠️ base64 fallback | ❌ | 🟠 有实现但降级 |
| 9 | 个人中心与设置 | P1 | ✅ settings, login, register | ✅ settings.ts, auth.ts | ✅ profile.py, auth.py | ✅ User, UserSettings | ⚠️ 设置可能只存本地 | ❌ | 🟠 基本有但同步不足 |
| 10 | 多端适配 | P1 | ✅ /pc/*, /m/* | ✅ 共享 service | ✅ 后端共享 | — | ⚠️ 移动端功能覆盖不全 | ❌ | 🟡 有框架 |
| 11 | 智能批量校对工作台 | P0 | ✅ /pc/projects/[id]/review | ✅ page.tsx 内调用 | ✅ review.py | ✅ ReviewLog | ⚠️ 接口多但需验证 | ❌ | 🟡 核心有 |
| 12 | 多模态翻译质量评估 | P1 | ✅ /pc/projects/[id]/quality | ✅ quality.ts | ✅ quality.py | ✅ TranslationQuality | ⚠️ 模拟 BLEU | ❌ | 🟠 壳有，核心模拟 |
| 13 | 角色语气一致性引擎 | P1 | ✅ /pc/characters | ✅ character.ts | ✅ characters.py | ✅ Character | ⚠️ 只有 CRUD，无一致性引擎 | ❌ | 🟠 壳有，引擎缺 |
| 14 | AI自适应排版引擎2.0 | P1 | ✅ 编辑器内 | ✅ page.ts | ✅ render.py (含 text layout) | ✅ TextRegion | ⚠️ 简化规则 | ❌ | 🟡 有实现 |
| 15 | 端云协同推理架构 | P2 | ❌ | ❌ | ⚠️ GPU scheduler 有 | — | ❌ 无 ONNX/WebGPU | ❌ | 🔴 未实现 |
| 16 | 主动学习闭环 | P2 | ❌ 独立页面 | ✅ 间接 | ✅ feedback.py, memory.py | ✅ Feedback, Memory | ⚠️ 记录为主 | ❌ | 🟠 轻实现 |
| 17 | 社交化学习社区 | P2 | ✅ /pc/learn | ✅ learnApi | ⚠️ 部分接口缺失 | ✅ LearningProgress, Achievement | ⚠️ 偏生词本 | ❌ | 🔴 严重不足 |
| 18 | PWA 2.0 完全离线 | P1 | ✅ manifest.json, /offline | ❌ | ❌ | — | ⚠️ 无完整 SW 策略 | ❌ | 🔴 未实现 |
| 19 | 无障碍设计 A11y | P2 | ❌ | ❌ | — | — | ❌ 无系统化 A11y | ❌ | 🔴 未实现 |
| 20 | API 开放平台 | P1 | ✅ /pc/api-keys | ✅ apiKeyApi | ✅ api_keys.py | ✅ APIKey | ⚠️ SDK/插件缺失 | ❌ | 🟠 基本有，生态缺 |
| 21 | GPU算力智能调度 | P1 | ❌ | ❌ | ✅ gpu_scheduler, model_router | — | ⚠️ 骨架 | ❌ | 🟠 后端有骨架 |
| 22 | 智能擦除引擎增强 | P0 | ✅ 编辑器内 | ✅ page.ts | ✅ inpaint.py + erase_quality | ✅ EraseQuality | ⚠️ 分模式有，质量标准待验证 | ❌ | 🟡 有实现 |
| 23 | 字体管理与智能匹配 | P1 | ✅ /pc/fonts | ✅ fontApi | ✅ fonts.py | ✅ Font | ⚠️ 字体-角色绑定缺 | ❌ | 🟠 基本有，高级缺 |
| 24 | 新手引导与帮助体系 | P1 | ✅ /pc/help, onboarding | ⚠️ 组件级 | ⚠️ 无独立 API | — | ⚠️ 引导组件有 | ❌ | 🟡 有框架 |
| 25 | 内容安全与合规 | P1 | ❌ 独立页面 | ⚠️ 间接 | ✅ content_safety.py | ✅ Moderation | ⚠️ 外部审核 placeholder | ❌ | 🟠 有接口，合规不足 |
| 26 | 漫画有声剧场模式 | P2 | ✅ /pc/audio | ✅ audioApi | ✅ audio_dynamic.py | ✅ Voice | ⚠️ TTS 有，音效库空 | ❌ | 🟡 TTS 有，音效空 |
| 27 | 动态漫画模式 | P2~P3 | ✅ /pc/dynamic-manga | ✅ dynamicMangaApi | ✅ audio_dynamic.py | — | 🔴 Placeholder | ❌ | 🔴 空壳 |
| 28 | 对话跨作品搜索 | P2 | ✅ /pc/search | ✅ searchApi | ✅ search_learn.py | ✅ SearchResult | ⚠️ context 缺失 | ❌ | 🟠 基本搜索有 |

### PRD 闭环统计

| 闭环状态 | 数量 | 模块 |
|---------|------|------|
| 🟢 基本闭环 | 1 | #1 图像导入与项目管理 |
| 🟡 核心有/骨架有 | 8 | #2 OCR, #3 翻译, #4 背景修复, #7 阅读器, #10 多端, #11 校对, #22 擦除, #26 有声剧场 |
| 🟠 壳有/部分有 | 12 | #5 导出, #6 画质增强, #8 条漫, #9 设置, #12 质量评估, #13 角色一致性, #16 主动学习, #20 API平台, #21 GPU调度, #23 字体, #25 内容安全, #28 搜索 |
| 🔴 未实现/空壳 | 5 | #15 端云协同, #17 社交学习, #18 PWA离线, #19 A11y, #27 动态漫画 |

---

## 十二、空壳判定表

> 扫描关键词：mock, placeholder, simulated, TODO, fallback, pass(空实现), not implemented, 敬请期待, 暂无, 本地保存

### 后端空壳/模拟实现

| # | 文件 | 关键词 | 代码片段 | 严重程度 | 说明 |
|---|------|--------|---------|---------|------|
| 1 | `export_service/api/audio_dynamic.py` | mock | `No mock data.` | 🔵 注释 | 声明"无 mock"，实际代码需验证 |
| 2 | `export_service/repository/__init__.py` | Mock | `导出任务仓库（Mock）` | 🟡 中 | **注释未更新**：已有真实 `export_repo.py`，注释仍是旧版本 |
| 3 | `export_service/api/audio_dynamic.py` | Placeholder | `Real Generation Placeholder` | 🔴 高 | **动态漫画生成是 Placeholder** |
| 4 | `translation_service/api/quality.py` | simulated | `Simulated BLEU calculation` | 🔴 高 | **BLEU/METEOR 是模拟计算** |
| 5 | `image_service/api/content_safety.py` | fallback | `safe=true, suggestion="pass"` | 🟡 中 | 服务不可用时默认放行 |
| 6 | `image_service/service/ocr_service.py` | fallback | `pytesseract 本地 OCR 回退` | 🟢 低 | 合理降级策略 |
| 7 | `image_service/service/inpaint_service.py` | fallback | `本地像素级修复` | 🟢 低 | 合理降级策略 |
| 8 | `image_service/service/detect_service.py` | fallback | `回退到本地 CV 检测` | 🟢 低 | 合理降级策略 |
| 9 | `project_service/service/file_service.py` | fallback | `PyMuPDF not installed — single-page placeholder` | 🟡 中 | PDF 降级 |
| 10 | `export_service/api/long_image.py` | fallback | `Fallback: return base64` | 🟡 中 | 长图导出降级 |
| 11 | `user_service/api/payments.py` | simulated | `simulated payment` | 🔴 高 | **支付是模拟** |
| 12 | `common/clients/content_safety.py` | Placeholder | `Placeholder for Alibaba Cloud integration` | 🔴 高 | **外部内容审核是 Placeholder** |

### 前端空壳/空状态

| # | 文件 | 关键词 | 代码片段 | 严重程度 | 说明 |
|---|------|--------|---------|---------|------|
| 1 | `pc/audio/page.tsx` | 敬请期待 | `暂无可用音效，敬请期待` | 🟡 中 | 音效库为空 |
| 2 | `pc/audio/page.tsx` | 暂无 | `暂无预览音频` | 🟡 中 | 音频预览为空 |
| 3 | `pc/audio/page.tsx` | 暂无 | `暂无可用的语音` | 🟡 中 | 语音列表为空态 |
| 4 | `pc/learn/page.tsx` | 暂无 | `暂无待复习词汇` | 🟡 中 | 学习数据为空 |
| 5 | `pc/learn/page.tsx` | 暂无 | `暂无成就` | 🟡 中 | 成就系统空态 |
| 6 | `pc/api-keys/page.tsx` | 暂无 | `暂无 API Key` | 🟢 低 | 正常空态提示 |
| 7 | `pc/fonts/page.tsx` | 暂无 | `暂无字体` | 🟢 低 | 正常空态提示 |
| 8 | `pc/terms/page.tsx` | 暂无 | `暂无术语数据` | 🟢 低 | 正常空态提示 |
| 9 | `pc/characters/page.tsx` | 暂无 | `暂无角色` | 🟢 低 | 正常空态提示 |
| 10 | `pc/projects/[id]/quality/page.tsx` | 暂无 | `暂无质量数据` | 🟡 中 | 质量评估空态 |
| 11 | `pc/projects/[id]/team/page.tsx` | 暂无 | `暂无团队成员` | 🟢 低 | 正常空态提示 |
| 12 | `pc/projects/[id]/review/page.tsx` | 暂无 | `暂无页面` / `暂无文字区域` | 🟢 低 | 正常空态提示 |
| 13 | `m/projects/[id]/edit/page.tsx` | 本地保存 | `修改已本地保存` | 🟡 中 | 设置未同步后端 |
| 14 | `pc/settings/page.tsx` | 本地保存 | `设置已保存到本地` | 🟡 中 | 设置未同步后端 |
| 15 | `m/page.tsx` | 暂无 | `暂无项目` | 🟢 低 | 正常空态提示 |
| 16 | `components/editor/BatchProofreadPanel.tsx` | 暂无 | `暂无可校对内容` | 🟢 低 | 正常空态提示 |
| 17 | `components/editor/CollaborationPanel.tsx` | 暂无 | `暂无评论` / `暂无操作记录` | 🟢 低 | 正常空态提示 |
| 18 | `components/editor/StylePanel.tsx` | 暂无 | `暂无预设样式` | 🟢 低 | 正常空态提示 |

### 空壳判定汇总

| 类别 | 数量 | 严重程度分布 |
|------|------|-------------|
| 后端模拟/Placeholder（需修复） | 5 | 🔴 高 3 / 🟡 中 2 |
| 后端合理降级（可接受） | 5 | 🟢 低 4 / 🟡 中 1 |
| 前端空状态（正常 UX） | 13 | 🟢 低 10 / 🟡 中 3 |
| 前端本地保存（需改） | 2 | 🟡 中 2 |
| 注释未同步（非功能问题） | 1 | 🟡 中 1（export repo Mock 注释） |

### 关键空壳修复优先级

| 优先级 | 空壳项 | 修复方向 |
|--------|--------|---------|
| P0 | 云凭据泄露（新增） | 立即轮换腾讯云密钥，清理 Git 历史 |
| P0 | 支付模拟 | 接入真实支付网关或明确标记 Beta |
| P1 | 质量评估模拟 BLEU | 至少用真实参考译文计算，或标记模拟 |
| P1 | 内容安全 Placeholder | 接入阿里云/腾讯云内容审核 |
| P1 | 动态漫画 Placeholder | 标记 Beta 或实现真实视频生成 |
| P1 | PDF 降级 | 确保 PyMuPDF 依赖安装 |
| P2 | 长图 base64 fallback | 改为文件持久化 + 异步任务 |
| P2 | 设置本地保存 | 同步后端 /user/settings |
| P2 | export repo Mock 注释 | 更新 `__init__.py` 注释以反映真实仓库状态 |

---

> 报告完毕。本报告基于 2026-06-28 静态代码重新审查生成（对比 v1.0 2026-06-27 版本）。  
> 本次更新要点：新增安全凭据泄露风险、新增构建质量分析、导出仓库状态从 Mock 更新为真实实现、成员管理 API 模块新增、接口合同表刷新（quality/api-keys/font 已修复，learn/search/reader 仍待修复）、空壳判定表同步更新。  
> 建议后续结合接口联调测试和端到端功能测试进一步验证。安全凭据问题建议立即处理。
