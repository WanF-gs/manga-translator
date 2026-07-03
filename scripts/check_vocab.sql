SELECT 'vocab_count' AS metric, COUNT(*) AS value FROM vocabularies
UNION ALL
SELECT 'progress_count', COUNT(*) FROM learning_progress
UNION ALL
SELECT 'pages_translated', COUNT(*) FROM pages WHERE status IN ('translated', 'rendered', 'completed')
UNION ALL
SELECT 'pages_with_ocr', COUNT(*) FROM text_regions WHERE original_text IS NOT NULL AND original_text != ''
UNION ALL
SELECT 'distinct_users', COUNT(DISTINCT user_id) FROM projects;
