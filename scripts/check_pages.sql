SELECT
  pr.name AS project_name,
  pr.source_lang,
  pr.user_id,
  c.title AS chapter_title,
  p.page_id,
  p.status,
  p.created_at
FROM pages p
JOIN chapters c ON c.chapter_id = p.chapter_id
JOIN projects pr ON pr.project_id = c.project_id
WHERE p.status IN ('translated', 'rendered', 'completed')
ORDER BY p.created_at DESC
LIMIT 20;
