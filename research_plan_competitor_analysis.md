# 研究计划：漫画翻译工具竞品分析

## 查询类型：Breadth-first
需要从多个维度独立搜索相似项目，然后聚合比较。

## 项目核心特征
- OCR文字检测（漫画气泡、拟声词、旁白等）
- 多模态AI翻译（上下文感知、角色语气一致）
- 背景修复/擦除（inpainting）
- 文字回填/排版（字体管理、智能匹配）
- 双语阅读器 + 学习功能
- 批量校对工作台
- API开放平台
- 有声剧场（角色分声TTS）
- 动态漫画（静态转动态）
- Web端 + PWA + 移动端

## 搜索方向（3个子代理并行）

### 子代理1：开源漫画翻译工具
搜索关键词：manga translation open source, comic translation tool github, OCR manga translator, manga inpainting AI
关注：MangaOCR、Ballon Translator、kitsune、Ichigo、comic-translate等项目

### 子代理2：商业漫画翻译平台/工具  
搜索关键词：manga translation platform online, AI comic translation service, manga translator app, comic localization tool
关注：商业产品如Manga Translator、各种在线平台

### 子代理3：同类AI管道技术项目
搜索关键词：scene text removal manga, Japanese OCR manga pipeline, multimodal comic translation, text erasure inpainting manga
关注：技术架构相似的工具，即使不完全是漫画翻译

## 需要提取的信息
- 项目名称、网址
- 功能对比（OCR/翻译/修复/回填/阅读器）
- 技术栈
- 开源/商业
- 活跃度
- 与本项目的相似度评分

## 综合策略
1. 子代理优先使用web_search搜索
2. 补充使用GitHub MCP搜索开源仓库
3. 聚合所有发现，按相似度排序
4. 生成对比表格和最终报告
