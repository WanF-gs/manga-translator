SELECT
  pr.name AS project_name,
  pr.source_lang,
  pr.user_id,
  c.chapter_id,
  p.page_id,
  p.status,
  p.created_at,
  (SELECT COUNT(*) FROM text_regions tr WHERE tr.page_id = p.page_id AND tr.original_text IS NOT NULL) AS region_count
FROM pages p
JOIN chapters c ON c.chapter_id = p.chapter_id
JOIN projects pr ON pr.project_id = c.project_id
WHERE EXISTS (SELECT 1 FROM text_regions tr WHERE tr.page_id = p.page_id AND tr.original_text IS NOT NULL)
ORDER BY p.created_at DESC
LIMIT 20;
