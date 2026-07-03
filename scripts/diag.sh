#!/bin/bash
# Run this from WSL2: bash /mnt/c/Users/WanFi/Desktop/大三实训/demo_04/scripts/diag.sh

echo "=== Diagnostics for Manga Translator ==="
echo ""

# Try to find and connect to PostgreSQL
echo "[1] Finding PostgreSQL..."

# Try docker-based psql first
if command -v docker &> /dev/null; then
    echo "  Docker available, using docker exec..."
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT 'PG_OK' as status;" 2>&1 | head -5
    
    echo ""
    echo "[2] Vocabulary language distribution:"
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT language, COUNT(*) as cnt FROM vocabularies GROUP BY language ORDER BY cnt DESC;" 2>&1
    
    echo ""
    echo "[3] Project source_lang distribution:"
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT source_lang, COUNT(*) as cnt FROM projects GROUP BY source_lang ORDER BY cnt DESC;" 2>&1
    
    echo ""
    echo "[4] OCR text samples (check for kana):"
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT left(original_text, 80) as sample FROM text_regions WHERE original_text IS NOT NULL AND original_text <> '' LIMIT 5;" 2>&1
    
    echo ""
    echo "[5] Vocabulary word samples:"
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT word, language, left(definition, 40) as def FROM vocabularies LIMIT 5;" 2>&1
    
    echo ""
    echo "[6] Achievements count:"
    docker exec manga-postgres-1 psql -U manga_user -d manga_translator -c "SELECT 'ach' as tbl, COUNT(*) as cnt FROM achievements UNION ALL SELECT 'user_ach', COUNT(*) FROM user_achievements;" 2>&1
    
    echo ""
    echo "[7] manga-ocr check:"
    docker exec manga-ai-gateway python3 -c "try:
    from manga_ocr import MangaOcr
    print('manga-ocr: AVAILABLE')
except Exception as e:
    print('manga-ocr: NOT AVAILABLE -', str(e)[:80])
" 2>&1

elif command -v psql &> /dev/null; then
    echo "  psql available locally, trying..."
    export PGPASSWORD=manga_pass
    psql -h localhost -U manga_user -d manga_translator -c "SELECT language, COUNT(*) FROM vocabularies GROUP BY language ORDER BY 2 DESC;" 2>&1
    psql -h localhost -U manga_user -d manga_translator -c "SELECT source_lang, COUNT(*) FROM projects GROUP BY source_lang ORDER BY 2 DESC;" 2>&1
    psql -h localhost -U manga_user -d manga_translator -c "SELECT left(original_text, 80) FROM text_regions WHERE original_text IS NOT NULL AND original_text <> '' LIMIT 5;" 2>&1
    psql -h localhost -U manga_user -d manga_translator -c "SELECT word, language, left(definition, 40) FROM vocabularies LIMIT 5;" 2>&1
    psql -h localhost -U manga_user -d manga_translator -c "SELECT 'ach' as tbl, COUNT(*) FROM achievements UNION ALL SELECT 'user_ach', COUNT(*) FROM user_achievements;" 2>&1
else
    echo "  ERROR: Neither docker nor psql found in WSL2."
    echo "  Try running: sudo apt install postgresql-client"
fi

echo ""
echo "=== Diagnostics complete ==="
