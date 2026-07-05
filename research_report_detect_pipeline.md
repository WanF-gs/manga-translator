# 漫画翻译全链路诊断报告

## 概述

对一次完整的漫画翻译流程（检测→OCR→翻译→擦除→渲染）进行端到端分析，识别出 **4 个关键问题**，其中 2 个为 P0 级（影响核心可用性），1 个为 P1（影响用户体验），1 个为 P2（性能相关）。

## 测试数据流水线

| 阶段 | 输入量 | 输出量 | 耗时 | 丢失率 |
|------|--------|--------|------|--------|
| CTD 文字检测 | N/A | 26 区域 | ~8s | — |
| 合并+NMS | 26 | 25 | — | 3.8% |
| **文本内容验证** | **25** | **6** | — | **76%** |
| image-service 存储 | 6 | 6 | — | 0% |
| OCR 识别 | 6 | 3 文本 | 1.6s | 50% |
| 翻译 | 3 | 3 | 6.0s | 0% |
| 擦除 | 3 | 3 | 20.6s | 0% |
| 渲染 | 3 | 3 | 0.3s | 0% |

**从 CTD 的 26 个原始检测到最终只有 3 个被渲染——整体丢失率高达 88.5%。**

---

## 问题 1（P0）：文本内容验证过滤过于激进（25→6）

### 位置
`manga-translator-backend/services/ai_gateway/service/detector.py:1374-1406`
函数 `_verify_text_content()` (行 334-451)

### 现象
Phase 4.5 文本验证从 25 个候选区域中拒绝了 19 个（76% 拒绝率），仅保留 6 个。被拒绝的区域中包含明显的合理文字区域：
- `(205,208) 42x72` — 42×72 像素是典型的语音气泡文字区域
- `(175,225) 18x60` — 窄长形，可能是日文竖排文字
- `(230,302) 28x60` — 合理的文字区域尺寸
- `(206,158) 39x39` — 正方形，可能是拟声词/效果字
- `(93,30) 78x46` — 宽幅，可能是旁白框

### 根本原因
`_verify_text_content()` 使用了 6 个级联检测特征（实心填充率、暗像素比、边缘密度、连通分量分析、对比度、投影结构），采用 **AND 逻辑**：只要任一特征不通过，整个区域就被拒绝。对于漫画而言过于严格，因为漫画文字具有以下特点：
- 气泡背景可能渐变的（对比度低）
- 文字字号可能极小（连通分量少）
- 可能有反转文字（白字黑底）
- 艺术字体可能不规则分布

### 解决方案
**快速修复**：将文本验证从"必须全部通过"改为"评分制"——当 6 个特征中有 3 个以上通过时即保留。修改 `_verify_text_content()` 返回类型为 `(bool, float, dict)`，增加各特征分数的单独输出，在调用处（行 1396-1399）改为宽松判断。

**根本修复**：将 `TEXT_EDGE_DENSITY_MIN` 从 0.0005 降至 0.0002，将 `TEXT_CONTRAST_MIN` 从 0.15 降至 0.08，将 `TEXT_H_STD_MIN` 从 0.05 降至 0.03。这些阈值在 v11 已多次放宽，但仍不足以覆盖漫画的多样性。

---

## 问题 2（P0）：OCR 阶段区域丢失（6→3）

### 位置
`manga-translator-backend/services/image_service/service/ocr_service.py`
及前端调用逻辑

### 现象
AI Gateway 检测返回了 6 个区域，但 AI Gateway 日志显示 "OCR completed: 3 regions, 1561ms, 3 workers"——只有一半的区域被送到 OCR 引擎。从日志来看，`ocr_engine.py` 只收到了 3 个区域请求。

### 根本原因分析
有两种可能：

**可能性 A**：image-service 的 OCR API 端点只向前端返回的部分区域执行 OCR。前端可能在 detect 后只选择了前 3 个可见的区域传给 OCR 端点。需检查 `manga-translator-backend/services/image_service/api/ocr.py` 中区域筛选逻辑。

**可能性 B**：6 个区域中有 3 个在存储到数据库时 boundary 字段为空或无效，导致 OCR 时被跳过。

### 解决方案
1. 检查 OCR API 端点的区域筛选逻辑，确保所有 detect 返回的区域都被送到 OCR
2. 增加 OCR 阶段跳过日志，记录每个被跳过区域的 region_id 和跳过原因
3. 确认前端 detect 回调逻辑是否对区域做了不必要的过滤

---

## 问题 3（P0）：渲染中文乱码（●●●●）

### 位置
`manga-translator-backend/services/image_service/service/render_service.py:75-157`
字体加载函数 `_find_font()` 和 `_get_font()`

### 现象
翻译后的中文文本在渲染图上显示为 ●●●● 符号（tofu character），而非实际中文字符。

### 根本原因
`PIL.ImageFont.load_default()` 是 Pillow 的默认后备字体，它不支持 CJK（中日韩）字符。当以下两个条件同时满足时会出现此问题：

1. `_find_font()` 在 `FONT_SEARCH_PATHS` 中都找不到 CJK 字体
2. 代码回退到 `load_default()`，该字体只能渲染 ASCII 字符

关键链路分析：
- `FONT_DIR` 环境变量指向 `manga-translator-backend/fonts/`（该目录包含 `NotoSansSC-Regular.otf`）
- 但 `FONT_SEARCH_PATHS` 中的路径是相对于 Python 进程工作目录解析的
- `settings.FONT_DIR` 来自环境变量，但在某些启动方式下可能未正确传递
- `/usr/share/fonts/truetype/noto/` 在 WSL 中只包含 `NotoColorEmoji.ttf`，没有 CJK 字体
- `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` 存在但没有在 `CJK_FONT_CANDIDATES` 列表中

### 解决方案

**方案 A（立即生效）**：在 `CJK_FONT_CANDIDATES` 列表最前面添加 `wqy-zenhei.ttc`：
```python
CJK_FONT_CANDIDATES = [
    "wqy-zenhei.ttc",  # WSL 系统自带中文字体
    "NotoSansSC-Regular.otf", ...
]
```

**方案 B（根本修复）**：在 `FONT_SEARCH_PATHS` 开头显式添加 `/usr/share/fonts/truetype/wqy/` 路径。

**方案 C（兜底）**：当 `load_default()` 被调用时，添加日志警告并尝试在 `/usr/share/fonts/` 下进行最后的递归搜索加载任意 CJK 字体。

---

## 问题 4（P1）：擦除质量不佳（36.3/100）

### 位置
image-service 擦除日志

### 现象
```
Page 307be272: Erase quality 36.3/100 below threshold, marked as needs_repair.
Failed regions: ['1856c143...', '739f25bf...', '2b4bd3a8...']
```

所有 3 个区域的擦除质量均低于 50/100 阈值。

### 根本原因
LaMa ONNX 擦除模型对于复杂漫画背景（网点、纹理）的补全效果有限。`manga-translator-backend/services/ai_gateway/service/detector.py:772-775` 中的 bubble detection 没有正确利用边界信息来提供更精确的擦除 mask。

### 解决方案
1. 增加擦除区域 margin 的自动扩展（当前 margin=2px 可能不够）
2. 考虑使用更激进的 inpaint 策略（扩大待擦除区域）
3. 对于被标记为 `needs_repair` 的区域，在渲染时使用半透明底色背景覆盖残留

---

## 问题 5（P2）：文字检测效率低（25→6 验消耗）

### 现象
文本验证阶段对 25 个区域逐一执行 6 个特征检测（Canny 边缘 + Otsu 二值化 + connectedComponents + 投影分析），其中 19 个最终被拒绝——即 76% 的计算被浪费。

### 解决方案
将文本验证移至更前的位置，在合并和 NMS 之前就执行一轮快速预筛选（仅使用暗像素比 + 尺寸检查），减少后续阶段的计算量。

---

## 优先级修复顺序

1. **立即修复**：问题 1（文本验证放宽）+ 问题 3（添加 wqy-zenhei 字体支持）
2. **本轮修复**：问题 2（OCR 区域丢失排查）
3. **下轮优化**：问题 4（擦除质量）+ 问题 5（性能优化）

---

## 修复后的预期效果

修复问题 1-3 后，预计效果：
- 文字检测：26→18-20 个区域（放宽验证但保留基本的噪声过滤）
- OCR 识别：18-20 个区域全部获得文本
- 翻译：18-20 条中文翻译
- 渲染：18-20 个区域正常渲染中文（字体正确）
- 整体覆盖率：从 11.5% 提升到约 70-77%
