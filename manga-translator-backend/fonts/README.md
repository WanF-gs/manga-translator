# CJK 字体文件目录

此目录用于存放文字渲染所需的中日韩字体文件。

## 推荐字体（免费可商用）

### 思源黑体 (Source Han Sans) - 推荐首选

| 语言变体 | 文件名 | 下载链接 |
|---------|--------|---------|
| 简体中文 | `SourceHanSansSC-Regular.otf` | [GitHub Releases](https://github.com/adobe-fonts/source-han-sans/releases) |
| 简体中文 | `SourceHanSansSC-Bold.otf` | 同上 |
| 日文 | `SourceHanSans-Regular.otf` | 同上 |
| 日文 | `NotoSansJP-Regular.otf` | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+JP) |
| 韩文 | `NotoSansKR-Regular.otf` | [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Sans+KR) |

## 快速获取

### 方式一：下载 SourceHanSansSC 子集（推荐，~15MB）

```bash
# Linux/macOS
wget https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/CN/SourceHanSansSC-Regular.otf -P ./fonts/

# Windows PowerShell
Invoke-WebRequest -Uri "https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/CN/SourceHanSansSC-Regular.otf" -OutFile "./fonts/SourceHanSansSC-Regular.otf"
```

### 方式二：使用 Noto Sans CJK（更完整，支持所有 CJK 字符）

```bash
# 可使用包管理器安装
# Ubuntu/Debian:
apt-get install -y fonts-noto-cjk

# 或下载单个字体:
wget https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf -P ./fonts/
```

### 方式三：Windows 系统字体（开发环境）

在 Windows 开发环境中，`render_service.py` 会自动从 `C:/Windows/Fonts` 搜索：
- `simsun.ttc` (宋体)
- `msyh.ttc` (微软雅黑)

## Docker 部署

Docker 容器中，`fonts/` 目录会被挂载到容器的 `/app/fonts/`。

在 Dockerfile 中也可直接安装系统字体包：

```dockerfile
# 在 image_service/Dockerfile 中添加:
RUN apt-get update && apt-get install -y fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
```

## 字体查找优先级

`render_service.py` 的字体搜索路径（按优先级）：
1. `FONT_DIR` 环境变量 (默认 `/app/fonts`)
2. `/usr/share/fonts`
3. `/usr/local/share/fonts`
4. `services/image_service/service/fonts/`
5. `C:/Windows/Fonts` (Windows 开发环境)

## 验证

```bash
# 检查字体是否可被 Pillow 找到
python -c "
from PIL import ImageFont
for f in ['SourceHanSansSC-Regular.otf', 'NotoSansCJK-Regular.ttc']:
    try:
        font = ImageFont.truetype(f'/app/fonts/{f}', 16)
        print(f'OK: {f}')
    except:
        print(f'MISSING: {f}')
"
```
