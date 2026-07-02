#!/bin/bash
PGPASSWORD=manga_pass psql -h localhost -p 5433 -U manga_user -d manga_translator -t -A -c "SELECT preprocessing_result FROM pages WHERE page_id='4c4bdc06-a1d4-459d-8b24-d34afeace602'" 2>/dev/null
