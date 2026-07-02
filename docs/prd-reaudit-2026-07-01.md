# 漫画翻译系统 v3.0 PRD 复核报告（2026-07-01）

> 在 2026-06-30 审计基础上，对 07-01 当日大量改动做的**代码级复核**。结论：当日工作填平了多个 P0/P1 大坑，整体完成度显著上升。

## 一、相较昨日审计的关键进展（已修复/新实现）

| 项 | 昨日状态 | 今日复核 | 证据 |
|----|----------|----------|------|
| DDL 4 项 Schema 缺口 | 缺失 | **已补齐** | `02_create_tables.sql` + `03_v3_migration.sql`：`erase_quality_score`、`boundary_mode`、`character_id`、`status(reviewing/needs_repair)` |
| §2.4.0 智能擦除引擎（SSIM质量分/分背景标准/needs_repair） | 未实现 | **已实现** | `image_service/inpaint_service.py`(SSIM+分类型阈值+自动标记)、`api/erase_quality.py` |
| §2.2.8 多边形选区输出 | 未实现 | **部分实现** | `detector.py` 真实 findContours/convexHull 输出 polygon；bezier 仍仅枚举无实现 |
| §2.6 画质增强（超分/扫描修复/上色） | 未实现 | **已实现** | `enhance_service.py`：Real-ESRGAN→waifu2x→Lanczos 三级；FFT 去莫尔纹；调色板上色 |
| §6.4 内容安全审核 | 未实现 | **已实现(有保留)** | 腾讯云 IMS/TMS，TC3-HMAC 签名；但 fail-open、非同步强制拦截 |
| 支付/订阅 | 纯模拟 | **真实(默认sandbox)** | 支付宝 RSA2 下单+异步通知验签；凭证缺失走 sandbox 免费发权益 |
| §2.28 动态漫 MP4 | 存根 | **真实合成** | `audio_dynamic.py` ffmpeg zoompan+libx264+AAC |
| §2.12 term_consistency | 固定0.85 | **真实计算** | `quality.py::_term_consistency` 对比术语库，无术语返回 None |
| §2.11.4 快捷键 H 隐藏选区 | 未实现 | **已实现** | `editorStore.toggleShowRegions` + `projects/[id]/page.tsx` 绑定 |
| 文字检测模型 | OpenCV 阈值 | **真实 CTD ONNX** | `ctd_detector.py` Comic Text Detector(YOLO+DBNet) |

## 二、仍未实现 / 存根（按优先级）

### P0 / 影响 MVP 完整度
- **§2.25 字体系统未打通**：`character.font_id` 渲染路径从不读取；缺字回退引擎(`text_layout.py`)是**死代码**无人调用；内置字体**无 seed 数据**。（Schema、UI 都在，链路断裂）
- §2.2.8 bezier 选区、mask ±2px 约束未验证。

### P1
- §2.4.3 AI 排版"多目标遗传算法"——实为**规则式缩字号+贪心去重叠**，无 GA/适应度函数（文档名与实现不符）。
- §2.3.3 全篇章连贯——实为**前 2 页尾部窗口**，无跨页对话合并。
- §6.4 UGC 敏感词本地过滤、PIPL 数据导出、账号注销 —— 未实现。
- §2.15 邀请链接(24h) —— 未实现（仅按 user_id 手动加成员）。
- §2.5.5 多语言版本同步导出 —— 未实现。
- §2.24 Python/JS SDK —— 未实现（`sdk/` 是无关 harness）。
- §2.26 新手引导 —— 静态 Modal；`sample-project` 页丢弃真实 API 结果，渲染硬编码 demoPages。
- §2.13.3 语气滑块(正式/亲和/攻击/可爱) —— 未实现（仅敬语等级滑块）。
- §2.21 GPU 智能调度 —— 未实现。

### P2
- §2.16 端云协同(ONNX.js/WebGPU) —— 前端零依赖，全云端。
- §2.17 主动学习微调+热更新 —— 未实现。
- §2.27 有声剧场：场景音效仅元数据(靠 Freesound 外链)、SRT 导出无、声音克隆仅 DB 字段。
- §2.28 动态漫气泡动画/微动/震动特效/水印/分享卡 —— 未实现。
- §2.7 假名/罗马音**行内注音渲染**、Anki(.apkg) 导出 —— 未实现（点词查询已实现）。
- 网盘导入、跨端二维码、排行榜、公开词典、语法解析、知识图谱、PS 插件 —— 未实现。
- 无障碍：仅高对比度主题；`prefers-reduced-motion`/`aria-live` 无。
- PWA：next-pwa 的 SW+离线可用；手写 push/background-sync 是**死代码**（被 next-pwa 覆盖）。

## 三、实现优于 PRD 的点（已回写 PRD）
1. §2.3.1 双引擎 → 实为**四级降级链**（DeepL/Google/腾讯/MyMemory）。
2. §2.2.1 检测 → 真实 **CTD ONNX 模型** + 多边形轮廓。
3. §2.6.1 超分 → **三级自适应降级**（Real-ESRGAN 动漫模型/waifu2x/Lanczos+线条锐化）。
4. §2.6.2 扫描修复 → FFT 频域去莫尔纹。
5. §2.28 动态漫 → P2~P3 却已有**真实 ffmpeg 视频合成**核心。

## 四、完成度评估（加权）

| 优先级 | 估算完成度 | 说明 |
|--------|-----------|------|
| P0（MVP） | ~90% | 主链路端到端跑通；仅字体链路打通、bezier 选区为残余缺口 |
| P1 | ~62% | 画质增强/内容安全/支付/协作已补；排版GA、跨页合并、新手引导、SDK、邀请链接欠缺 |
| P2 | ~40% | 动态漫/跨作品搜索/有声剧场部分落地；端云协同、主动学习、社区、上色深度不足 |
| P3 | ~5% | 基本未启动 |

**整体加权完成度 ≈ 72%**。核心产品（上传→检测→OCR→翻译→擦除→回填→导出→阅读）**完整可用**，7 个微服务均真实实现。差距集中在 P1/P2 高阶增值功能与若干"有 UI/Schema 无链路"的半成品。
