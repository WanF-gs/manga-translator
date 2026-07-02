#!/usr/bin/env python3
"""
模型权重下载脚本 — 下载所有运行时所需的模型文件。

下载内容:
1. Real-ESRGAN anime (17MB) — 漫画专用超分辨率模型
2. BRISQUE 质量评估模型 (1MB) — 无参考图像质量评分
3. Real-ESRGAN 通用模型 (64MB) — 回退超分辨率模型（可选）

使用方法:
    python scripts/download_models.py [--all]

环境变量:
    MODELS_DIR — 模型存储目录 (默认: ~/.cache/manga-translator/models)
"""

import os
import sys
import urllib.request
import hashlib
from pathlib import Path

# 模型存储目录
MODELS_DIR = Path(os.getenv("MODELS_DIR", os.path.expanduser("~/.cache/manga-translator/models")))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ==============================
# 模型定义
# ==============================
MODELS = [
    {
        "name": "Real-ESRGAN anime x4plus 6B",
        "filename": "RealESRGAN_x4plus_anime_6B.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
        "size_mb": 17,
        "required": True,
        "description": "漫画/动漫专用4x超分辨率，RRDBNet 6-block架构",
        "env_var": "REALESRGAN_ANIME_MODEL",
    },
    {
        "name": "BRISQUE model (LIVE)",
        "filename": "brisque_model_live.yml",
        "url": "https://raw.githubusercontent.com/opencv/opencv_extra/master/testdata/cv/quality/brisque_model_live.yml",
        "size_mb": 0.5,
        "required": True,
        "description": "BRISQUE无参考质量评估的训练模型参数",
        "env_var": "BRISQUE_MODEL_PATH",
    },
    {
        "name": "BRISQUE range (LIVE)",
        "filename": "brisque_range_live.yml",
        "url": "https://raw.githubusercontent.com/opencv/opencv_extra/master/testdata/cv/quality/brisque_range_live.yml",
        "size_mb": 0.1,
        "required": True,
        "description": "BRISQUE无参考质量评估的分数范围参数",
        "env_var": "BRISQUE_RANGE_PATH",
    },
    {
        "name": "Real-ESRGAN general x4plus",
        "filename": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "size_mb": 64,
        "required": False,
        "description": "通用4x超分辨率（回退模型，可选下载）",
        "env_var": None,
    },
]


def download_file(url: str, dest: Path, description: str = "") -> bool:
    """Download a file with progress reporting."""
    try:
        print(f"  Downloading: {description or url}")
        print(f"    → {dest}")
        
        # Create a progress reporter
        def report_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            if total_size > 0:
                percent = min(100, downloaded * 100 / total_size)
                mb_done = downloaded / (1024 * 1024)
                mb_total = total_size / (1024 * 1024)
                print(f"\r    {percent:.0f}% ({mb_done:.1f}/{mb_total:.1f} MB)", end="", flush=True)
        
        urllib.request.urlretrieve(url, str(dest), reporthook=report_progress)
        print()  # newline after progress
        
        if dest.stat().st_size < 1000:
            print(f"    ⚠️  Downloaded file is too small ({dest.stat().st_size} bytes), may be corrupted")
            return False
        
        return True
    except Exception as e:
        print(f"    ❌ Failed: {e}")
        return False


def verify_model(path: Path) -> bool:
    """Check if model file exists and has reasonable size."""
    if not path.exists():
        return False
    return path.stat().st_size > 1000


def set_env_var_hint(model: dict):
    """Print environment variable configuration hint."""
    if model.get("env_var"):
        path = MODELS_DIR / model["filename"]
        if path.exists():
            print(f"   ⚙️  设置环境变量: export {model['env_var']}={path}")
            # Also write to .env file
            env_file = Path(os.getcwd()) / ".env"
            if env_file.exists():
                content = env_file.read_text(encoding="utf-8", errors="replace")
                var_line = f"{model['env_var']}={path}\n"
                if var_line.strip().split('=')[0] not in content:
                    with open(env_file, "a", encoding="utf-8") as f:
                        f.write(f"\n# 模型路径 — 由 download_models.py 自动添加\n")
                        f.write(var_line)
                    print(f"   ✅ 已写入 .env: {var_line.strip()}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Download AI model weights")
    parser.add_argument("--all", action="store_true", help="Download ALL models (including optional)")
    parser.add_argument("--force", action="store_true", help="Force re-download even if exists")
    args = parser.parse_args()
    
    print("=" * 55)
    print(f"  模型权重下载器")
    print(f"  存储目录: {MODELS_DIR}")
    print("=" * 55)
    
    success_count = 0
    skip_count = 0
    fail_count = 0
    env_hints = []
    
    for model in MODELS:
        if not model["required"] and not args.all:
            continue
        
        dest = MODELS_DIR / model["filename"]
        
        if verify_model(dest) and not args.force:
            size_mb = dest.stat().st_size / (1024 * 1024)
            print(f"\n✅ {model['name']} ({size_mb:.1f}MB) — 已存在，跳过")
            skip_count += 1
            if model.get("env_var"):
                set_env_var_hint(model)
            continue
        
        print(f"\n📦 {model['name']} ({model['size_mb']}MB)")
        print(f"   {model['description']}")
        
        success = download_file(model["url"], dest, model["name"])
        
        if success:
            size_mb = dest.stat().st_size / (1024 * 1024)
            print(f"   ✅ 下载完成 ({size_mb:.1f}MB)")
            success_count += 1
            if model.get("env_var"):
                set_env_var_hint(model)
        else:
            print(f"   ❌ 下载失败")
            fail_count += 1
    
    # Summary
    print("\n" + "=" * 55)
    print(f"  结果: ✅ {success_count} 下载 | ⏭️ {skip_count} 已存在 | ❌ {fail_count} 失败")
    print("=" * 55)
    
    if success_count > 0 or skip_count > 0:
        print("\n📋 环境变量配置提示:")
        print(f'   export MODELS_DIR="{MODELS_DIR}"')
        print(f'   export REALESRGAN_ANIME_MODEL="{MODELS_DIR / "RealESRGAN_x4plus_anime_6B.pth"}"')
        print(f'   export BRISQUE_MODEL_PATH="{MODELS_DIR / "brisque_model_live.yml"}"')
        print(f'   export BRISQUE_RANGE_PATH="{MODELS_DIR / "brisque_range_live.yml"}"')
    
    if fail_count > 0:
        print("\n⚠️  部分模型下载失败。请检查网络连接后重试：")
        print("   python scripts/download_models.py --force")
        sys.exit(1)


if __name__ == "__main__":
    main()
