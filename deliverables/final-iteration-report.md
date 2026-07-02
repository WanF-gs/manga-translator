# 最终迭代交付说明（P0/P1 攻坚 + 工程债）

> 本轮目标：逐项解决 P0/P1，标注 P2，清理工程债。以下为落地清单与验证结论。

## 一、导出报错修复（最紧急）

**根因**：`export_service._upload_to_minio` 在 MinIO 失败时返回幽灵 URL `/uploads/exports/...` —— 文件从未落盘，且网关把 `/uploads/*` 路由到 image-service（未持有该文件），而导出产物应由 project-service 的 `/storage/*` 提供，三重路径错位导致下载 404。

**修复**：
- `export_service.py`：统一返回 `/storage/{bucket}/{object}`；主走 MinIO（导出前确保 bucket 存在）；MinIO 不可用时 `_write_local_fallback` 写入与 project-service 共享的存储卷；两条持久化路径都失败才 `raise`（任务诚实标记 failed，不再返回指向空文件的“成功”URL）。
- `docker-compose.yml`：export-service 补挂 `project_uploads:/tmp/manga-storage` 共享卷，使磁盘兜底对 project-service `/storage` 可见。

## 二、P0-A：API 开放平台鉴权 + 3 端点

- `common/core/api_key_auth.py`（新增）：`require_api_key(permission)` 依赖 —— 校验 `X-API-Key`（sha256，与创建端点一致）、is_active、过期、权限范围；真实累加 total_calls/monthly_calls/last_used_at。
- `user_service/api/external.py`（新增）：`POST /api/v1/external/{detect,ocr,translate}`，逐端点按权限鉴权，透传 AI 网关。
- 放行链路：Python `AuthenticationMiddleware` 与 Go 网关 `SkipPaths` 均放行 `/api/v1/external/`（改由 API Key 鉴权）；网关新增 `/external/*path → user-service` 路由。
- 验证：Python `py_compile` 通过；Go `go build ./...` 通过。

## 三、P0-B：质量评估诚实化

**问题**：`quality.py` 四项指标全是伪造 —— 自 BLEU 冒充 BLEU、METEOR=BLEU×1.12、语气=文本长度方差、术语=桩函数 `pass`；`set_human_score` 写不存在的列；前端逐页评分用 `Math.random()`。

**重写**（`quality.py`）：只报告可真实计算的信号，无法测量的返回 `null` 并标注：
- `ocr_confidence`（TextRegion.confidence 均值）、`coverage`（已译/总）、`mt_confidence`（长度比+未知字符率启发式，明确标注）、`term_consistency`（对照 TermEntry 真实校验，无适用术语则 null）、`bleu/meteor`（仅有 reference_translation 时算真实 BLEU，否则 null + `has_reference:false`）。
- `overall` = 可用真实信号加权平均（缺失项不计入，权重重归一化）。
- 删除写不存在列的 `set_human_score`（前端无引用）；修正项目汇总 `page→chapter→project` 关联（Page 无 project_id 列，旧查询本就错误）；返回真实逐页评分数组。
- 前端：`quality.ts` 类型 null-safe；`quality/page.tsx` 删除 `Math.random()`，改用 `summary.pages` 真实数据 + `N/A` 兜底。

## 四、P1-A：协作面板挂载

- `EditorRightPanel.tsx`：新增第 5 个「协作」Tab，`RightPanelMode` 增加 `collaboration`，懒加载挂载 `CollaborationPanel`（复用已有 `projectId`/`currentPageId`）。
- `CollaborationPanel.tsx`：对齐后端真实响应形状（lock `{locked,locked_by,expires_at}`、comments `{comments:[]}`、logs 分页 `{items:[]}`）；用 authStore 真实 user_id 替换硬编码 `'current-user'`。

## 五、P1-B：角色语气接入 prompt

- `multimodal_engine.py`：新增 `TONE_TYPE_DESC`（对应 Character.tone_type 全枚举）+ `build_character_tone_instruction(profile)`，从真实字段（tone_type/catchphrase/honorific_level/custom_tone_params）渲染中文语气指令，注入 PBP-VIS / vision / text-LLM 三处 system prompt。
- `translate.py`：修复引用不存在字段（`personality_desc`/`speech_style`）的 BUG，改用真实 Character 字段构建 `character_profile`。
- 贯通链路：`translate_page(character_profile=…) → context["character_profile"] → router → engine`。

## 六、P1-C：动态漫画状态真实化

**问题**：`status` 端点硬编码 `completed/100`，与真实生成脱钩；生成 worker 结果不落任何可读状态；video_url 落盘路径与返回 URL 不一致。

**修复**（`audio_dynamic.py`）：
- Redis 任务状态存储（`dynamic_manga:{task_id}`，24h 过期）：`queued → processing(5→20→50→80→100) → completed/failed`，记录真实 video_url、duration、error。
- `status` 端点读取真实记录；无记录返回 `unknown`（前端继续轮询，不误判完成）。
- 修正落盘兜底：写入共享存储卷并返回可下载的 `/storage/...`（与导出修复一致）。
- 前端 `audio.ts` 状态联合类型补 `queued/unknown`。

## 七、工程债与 P2 待办

| 项 | 位置 | 说明 | 级别 |
|---|---|---|---|
| region→character 关联缺失 | `common/models/text_region.py` | DB 已有 `character_id` 列，ORM 未同步；`_resolve_character_tone` 的 `speaker_label` 分支为死代码（已加 P2 注释）。补齐后可做**逐区域**语气（当前为页级） | P2 |
| API Key 哈希 bcrypt | `api_key_auth.py` / `api_keys.py` | PRD 要求 bcrypt，现为 sha256。切换需同步创建端点，且 bcrypt 不能按哈希直查，需改为 key_prefix 索引 + 逐一 verify（已加注释） | P2 |
| METEOR 真实实现 | `quality.py` | 需 wordnet；当前诚实返回 null 而非伪造 | P2 |
| 质量趋势 trend | `quality.py` summary | 需按时间分桶聚合；当前诚实留空 `[]` | P2 |
| API 调用日志/计费 | 开放平台 | PRD 要求 90 天调用日志与按次计费；当前仅累加计数，无独立日志表 | P2 |

## 验证摘要

- 后端：全部改动文件 `python -m py_compile` 通过；网关 `go build ./...` 通过。
- 前端：`tsc --noEmit` 对本轮改动文件无新增类型错误（残留 `audio/page.tsx:84`、`EditorRightPanel` 其它面板类型告警为**改动前既有基线问题**，非本轮引入）。
