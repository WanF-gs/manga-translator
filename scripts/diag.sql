\echo '=== [1] Vocabulary language distribution ==='
SELECT language, COUNT(*) as cnt FROM vocabularies GROUP BY language ORDER BY cnt DESC;

\echo '=== [2] Project source_lang distribution ==='
SELECT source_lang, COUNT(*) as cnt FROM projects GROUP BY source_lang ORDER BY cnt DESC;

\echo '=== [3] OCR text samples (first 5, check for Japanese kana) ==='
SELECT left(original_text, 80) as sample FROM text_regions WHERE original_text IS NOT NULL AND original_text != '' LIMIT 5;

\echo '=== [4] Vocabulary word samples ==='
SELECT word, language, left(definition, 40) as def FROM vocabularies LIMIT 5;

\echo '=== [5] Achievement counts ==='
SELECT 'achievements' as tbl, COUNT(*) FROM achievements
UNION ALL
SELECT 'user_achievements', COUNT(*) FROM user_achievements;

\echo '=== [6] Learning progress user count ==='
SELECT COUNT(DISTINCT user_id) as users, COUNT(*) as total FROM learning_progress;

\echo '=== DONE ==='
