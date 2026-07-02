-- v3 migration: missing columns on existing tables
-- These were defined in 03_v3_migration.sql but never executed

ALTER TABLE text_regions ADD COLUMN IF NOT EXISTS boundary_mode VARCHAR(10) NOT NULL DEFAULT 'rect'
    CHECK (boundary_mode IN ('rect', 'polygon', 'bezier'));

ALTER TABLE text_regions ADD COLUMN IF NOT EXISTS character_id UUID;

ALTER TABLE text_regions ADD COLUMN IF NOT EXISTS search_vector tsvector;
