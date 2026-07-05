#!/bin/bash
cd /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/manga-translator-backend
export DATABASE_URL=postgresql+asyncpg://manga_user:manga_pass@localhost:5433/manga_translator
export PYTHONPATH=.
timeout 120 python3 ../scripts/fix_bad_vocab.py
