-- Manual tier override.
--
-- Tier is normally auto-computed from the normalized payload (owner Age +
-- NumberOfOwners). An admin / agent can override the tier from the lead
-- drawer; once set the override sticks, even if the underlying data
-- changes. NULL = "use auto-computed tier".
--
-- Implemented in api/pipeline.php leadTierSqlExpression(): the SELECT/
-- WHERE expressions emit COALESCE(s.tier_override, computed_case_when).

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'lead_states'
       AND column_name = 'tier_override') = 0,
  "ALTER TABLE lead_states
     ADD COLUMN tier_override ENUM('tier_1','tier_2','tier_3') NULL DEFAULT NULL
     COMMENT 'NULL = use auto-computed tier; otherwise sticks'",
  "SELECT 'tier_override already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index so the override JOIN is cheap (most rows have NULL, so the index
-- is small and queries that filter to a specific tier_override hit it).
SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'lead_states'
       AND index_name = 'idx_ls_tier_override') = 0,
  "ALTER TABLE lead_states ADD INDEX idx_ls_tier_override (tier_override)",
  "SELECT 'idx_ls_tier_override already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
