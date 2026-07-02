# 漫画文字检测中的过分割与欠分割问题：行业与顶级项目方案研究报告

**日期**: 2026年6月30日  
**查询**: 对话气泡文字检测中，如何平衡过分割（一句话被切成多个气泡）与欠分割（多个密集对话被合并成一个气泡）？

---

## 执行摘要

当前项目的文字检测采用 CTD (Comic Text Detector) 模型输出 + 距离基凝聚聚类合并 + NMS 去重的后处理管线。核心问题在于合并阶段使用单一固定距离阈值 (`MERGE_DISTANCE_RATIO=0.05`) 来处理所有文本行，无法自适应不同密度的排版场景——稀疏对话需要较远的合并距离，密集对话则需要保持分隔。顶级开源项目 manga-image-translator 和 comic-text-detector 通过**多维几何特征判定**（非单阈值）、**语义级行间距分析**（基于字体大小的自适应阈值）、以及**多粒度检测融合**（块级+行级+掩码级）来解决这一矛盾。

---

## 背景

用户在两次测试中遇到了两个相反的问题：

1. **第一次（过分割）**: 同一句话的文字被 CTD 模型检测为两个独立的文本区域，最终呈现为两个对话气泡。
2. **第二次（欠分割，调参后）**: 调整参数后，多个原本独立的密集对话被合并成了一个大的文本区域。

这两种情况的根本原因是：当前系统的后处理管线用一个固定的距离阈值来处理所有排版密度场景，缺乏对文字排版语义的理解。

---

## 当前系统分析

当前项目的检测管线（位于 `detector.py`）流程如下：

```
CTD模型检测 → 气泡检测(补充) → 凝聚聚类合并 → 气泡裁剪 → NMS去重 → 文本验证 → 类型分类
```

**合并阶段的关键参数**（`_merge_nearby_boxes` 方法）：

| 参数 | 值 | 说明 |
|------|-----|------|
| `MERGE_DISTANCE_RATIO` | 0.05 | 合并距离 = 图像对角线 × 0.05 |
| 垂直对齐额外距离 | ×2.0 | x 中心偏差 < 较宽框宽度的 30% |
| `MERGE_EXPAND_RATIO` | 0.02 | 合并后外扩 2% |

**问题所在**: 合并判断仅依赖两个条件——(1) 欧几里得距离是否小于对角线×0.05，(2) x 中心是否对齐。这相当于用一个绝对距离做二分类，无法感知文字的排版密度。在密集对话场景（如多人争吵、快速对话切换），相同的像素距离可能跨多个气泡；在稀疏场景（如大面板中的孤立对话），同一气泡内的文字行距离可能比密集场景中的气泡间距还大。

**CTD 模型本身的局限**: 当前使用的 `comictextdetector.pt.onnx` 是 YOLO+DBNet 混合模型，其 DBNet 分割头输出的是像素级文本掩码，通过 `findContours` 提取轮廓。DBNet 本身倾向于输出连续的文字掩码，但当文字行间存在明显的空白间隙时（如日文竖排中的行间距、或者网点纸干扰），阈值化后的二值掩码会被打断，产生过分割。调整 `MASK_THRESH`（当前 0.15）可以改变掩码的连贯性，但会带来掩码膨胀的副作用。

**CTD 的 `MASK_THRESH` 参数**（在 `ctd_detector.py` 中）：当前设为 0.15（可通过 `CTD_MASK_THRESH` 环境变量调整）。降低该值会让更多像素被判定为文字区域，掩码更膨胀，更容易连接相邻文字行（减少过分割），但也会导致非文字噪声被误检，以及在不同气泡之间的空白区域被填充（导致欠分割）。将阈值从默认值调低可能就是用户第二次测试中密集对话被合并的原因。

---

## 行业顶级方案对照

### 方案一：manga-image-translator 的多维几何合并

manga-image-translator 是 GitHub 上最流行的开源漫画翻译工具（9k+ stars），其文本区域合并模块 `textline_merge.py` 使用 **O(n²) 逐对比较** 而非固定距离阈值：

**精细合并检查** (5 个条件全部满足才合并)：

1. **多边形距离** < `2 × min_font_size`（以字体大小为参考，而非图像对角线）
2. **字体大小比例** < 1.5（字号差异不能太大——大标题不和小注释合并）
3. **宽高比差异** < 2（形状约束）
4. **边缘对齐检测**: 水平文字检测左/右边缘是否对齐，垂直文字检测上/下边缘是否对齐
5. **旋转角度差异** < 15°（角度一致性）

**关键差异**: 合并距离是**相对于字体大小**的，而非相对于图像尺寸。这意味着在同一个页面中，大文字区域（如标题）使用较大的合并距离，小文字区域（如小声嘀咕）使用较小的合并距离，实现了**自适应合并**。

**粗筛检查**: 快速排除明显不兼容的文本行对，减少计算量。

**方向感知**: 合并时会根据文字方向（水平/垂直）选择合适的边缘进行对齐检测。竖排文字检测上下对齐，横排文字检测左右对齐。

### 方案二：comic-text-detector 的多粒度 TextBlock 形成

comic-text-detector 是目前最先进的漫画文本检测模型，其 "块+行+掩码" 三粒度设计天然解决了分割粒度问题。

**TextBlock 形成阶段** (`group_output` 函数):

1. **空间关联**: 每条文本行按最高 IoU 分配给对应的文本框，重叠不足的标记为"散落"
2. **方向检测** (`examine_textblk`): 分析几何特征计算垂直/水平向量、旋转角、字体大小
3. **不连续性分割（解决欠分割）**: **间隙 > 2×font_size 时强制分割块**——这是最关键的设计。即使两个文字区域在空间上相邻，只要它们之间的间距超过了文字高度的两倍，就被判定为不同的对话
4. **相邻合并（解决过分割）**: 字体大小、方向相似且距离近的散落行合并
5. **阅读顺序排序**: 4×3 网格排序保证正确的阅读顺序

**掩码精炼的作用**: comic-text-detector 的掩码精炼模块使用颜色聚类和 Otsu 阈值方法，从像素级分割掩码中精确提取文字边界。这有效避免了网点纸、渐变色、高光等干扰物导致的分割断裂或膨胀。

**三头架构的本质优势**: UNet 分割头提供像素级连续性，DBNet 检测头定位文本行边界，YOLO 检测头感知宏观文本块。三个头输出的融合天然地在不同粒度上平衡了过分割和欠分割。

### 方案三：学术界的语义分割方法

CVPR 2024 的 "The Manga Whisperer" (Sachdeva & Zisserman) 和 ECCV 2020 Workshop 的 "Unconstrained Text Detection in Manga" (Del Gobbo & Herrera) 都采用 **U-Net 风格的像素级语义分割** 来检测文本。

**优势**: 卷积网络天然保持空间连续性，不会像轮廓检测那样在间隙处断裂。全卷积输出的分割图能够平滑地表示文字区域的边界，避免了基于离散轮廓提取方法的碎片化问题。

CVPR 2025 的 "Advancing Manga Analysis" (Xie et al.) 更是为 Manga109 数据集提供了像素级分割标注，包括文字、字符、面板、气泡的精确掩码，推动漫画分析从粗粒度边界框走向精确分割。

### 方案四：传统 CV 的气泡检测方法

SIFT-OCR Manga Translation System 采用传统计算机视觉方法：
- **形态学操作** 合并碎片化的文字前景
- **MeanShift 聚类** 聚合空间上接近的文字像素
- **泛洪填充 (Flood Fill)** 填充气泡内部区域，确保完整的对话气泡边界

这种方法不依赖深度学习模型，适合资源受限场景，但在处理复杂背景和彩色 Webtoon 时效果有限。

---

## 综合分析：核心发现

### 1. 单阈值是根本问题

当前系统使用**图像对角线 × 固定比值**作为合并距离，这是过分割和欠分割无法同时解决的根源。同一画面中，不同气泡内的文字间距可能不同，同一气泡内的行间距也可能不同，必须引入**排版语义感知的自适应阈值**。

### 2. 字体大小是最关键的自适应锚点

manga-image-translator 和 comic-text-detector 都将合并判断建立在对**字体大小的感知**之上。字体大小作为锚点的合理性在于：
- 同一对话气泡内的文字通常字号一致
- 同一画面中标题、对话、旁白的字号差异明显
- 行间距与字号高度相关（通常为 1.2-1.8 倍字号）

### 3. 多粒度检测优于单粒度

comic-text-detector 的块级+行级+掩码级三粒度设计证明了：不同粒度的特征互相补充。宏判断（块级 YOLO）确定"这里有几个对话"；细粒度（行级 DBNet）确保"每个字都不漏"；像素级（UNet 分割）提供"精确到像素的边界"。当前项目仅在一个粒度（轮廓级）上工作，信息损失严重。

### 4. 不连续性分析是关键的分割依据

comic-text-detector 的"间隙 > 2×font_size 即分割"规则是一个简洁而有效的欠分割对策。它把"是否分割"的决策权交给了排版本身的规律——行间距，这是最自然的线索。

### 5. 掩码精炼可以缓解原始检测的质量问题

comic-text-detector 的颜色聚类+Otsu 掩码精炼流程能有效处理深底浅字/浅底深字、网点纸干扰、拟声词文字等漫画特有的复杂情况。当前项目的文本内容验证模块（六维特征分析）已经走在正确的方向上，但缺乏掩码级的 pixel-perfect 精炼能力。

---

## 具体改进建议

### 短期（参数级调整）

1. **将合并距离从绝对距离改为相对于字体大小的距离**：这是性价比最高的改动。在 `_merge_nearby_boxes` 中添加字体大小估计（可用框的高度作为近似），然后设置合并距离 = `max(1.5 × min_font_size, 绝对下限)`。

2. **添加不连续性分割检查**：合并后对得到的文本区域做行间距分析。如果内部存在间距 > 2×字体高度的间隙，则在该处分割。这解决了"合并过头"的问题。

3. **恢复 `MASK_THRESH` 为默认值，在合并阶段解决过分割**：而不是依赖降低掩码阈值来让检测器输出更膨胀的掩码。掩码膨胀性调整应该只用于解决检测遗漏，不应用于解决合并策略问题。

### 中期（策略级改进）

4. **引入方向感知的合并对齐检测**：当前代码中的垂直对齐额外 ×2.0 距离是一个好的开始，但应该像 manga-image-translator 那样，根据文字方向选择对应的对齐边缘（竖排检测上下对齐，横排检测左右对齐）。

5. **添加字体大小比例检查**：合并前比较两个候选区域的字号比例，超过 1.5 倍则拒绝合并。这可以防止大标题和小注释被错误合并。

### 长期（架构级改进）

6. **升级 CTD 模型到多粒度版本**：考虑使用完整的 comic-text-detector（而非仅 ONNX 推理的简化版），获得 YOLO 块级检测 + DBNet 行级检测 + UNet 分割掩码的三粒度输出。或者，将当前的 YOLO 检测头（如果有的话）输出也纳入管道，用于宏观块的初始分群。

7. **添加像素级掩码精炼**：在 text verification 之后，对每个区域做颜色聚类分析，精确裁剪文字边界。这能减少噪声干扰导致的分割错误。

---

## 结论

过分割和欠分割的根源在于用一个固定全局阈值去处理一个本质上局部的、依赖于排版密度的决策问题。manga-image-translator 和 comic-text-detector 通过将合并判断建立在字体大小（而非图像尺寸）之上，并通过不连续性分析、边缘对齐、字号比例等多维特征综合判断，成功地平衡了这两种错误。最关键的三点改进是：以字体大小为锚点的自适应合并距离、基于行间距的不连续性分割检查、以及多维度约束（不仅是距离，还有字号、角度、对齐）的合并判定。这些技术可以在现有代码框架内逐步引入，不需要彻底重写检测管道。

---

## 局限性

- 本报告的分析基于对开源代码的静态阅读和对学术论文的方法论理解，未进行定量对比实验来验证各参数调整对过分割和欠分割的实际影响程度。
- 不同漫画风格的排版差异巨大（日式竖排、美式横排、韩式 Webtoon 长条），本报告的改进建议偏向日式漫画场景，其他风格可能需要额外调整。
- 当前项目的 CTD 模型是 ONNX 导出版本，与原始 PyTorch 版本的 full pipeline 有功能差异，特别是缺少 YOLO 检测头的输出。

---

## 参考文献

1. [manga-image-translator 项目 | GitHub](https://github.com/zyddnys/manga-image-translator)
2. [manga-image-translator 文本区域合并 | DeepWiki](https://deepwiki.com/zyddnys/manga-image-translator/3.4-text-region-merging)
3. [comic-text-detector | GitHub](https://github.com/dmMaze/comic-text-detector)
4. [comic-text-detector 推理流程 | DeepWiki](https://deepwiki.com/dmMaze/comic-text-detector/4-inference-pipeline)
5. [comic-text-detector 掩码精炼 | DeepWiki](https://deepwiki.com/dmMaze/comic-text-detector/4.5-mask-refinement)
6. [BallonsTranslator | GitHub](https://github.com/dmMaze/BallonsTranslator)
7. [Deep CNN-based Speech Balloon Detection and Segmentation | arXiv:1902.08137](https://arxiv.org/abs/1902.08137)
8. [The Manga Whisperer | CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Sachdeva_The_Manga_Whisperer_Automatically_Generating_Transcriptions_for_Comics_CVPR_2024_paper.pdf)
9. [Unconstrained Text Detection in Manga | ECCV 2020 Workshop](https://link.springer.com/chapter/10.1007/978-3-030-67070-2_37)
10. [Advancing Manga Analysis | CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/papers/Xie_Advancing_Manga_Analysis_Comprehensive_Segmentation_Annotations_for_the_Manga109_Dataset_CVPR_2025_paper.pdf)
11. [SIFT-OCR Manga Translation System](https://jiachenren.github.io/sift-ocr/docs/final.html)
