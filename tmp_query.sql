PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -c "SELECT page_id, original_url FROM pages LIMIT 3;"
