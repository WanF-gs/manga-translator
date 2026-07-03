SELECT status, COUNT(*) AS cnt
FROM pages
GROUP BY status
ORDER BY cnt DESC;
