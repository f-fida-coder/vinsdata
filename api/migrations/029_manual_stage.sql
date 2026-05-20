-- "Manual" source stage. Until now every lead landed via the upload
-- pipeline (generated → carfax → filter → tlo). The new manual-add
-- flow lets an admin / acquisition agent drop a lead in directly
-- from the CRM UI; those leads live under a synthetic file named
-- "Manual lead add" in a synthetic batch with source_stage='manual'.
--
-- Widening the two ENUM columns to include 'manual' is the only
-- schema change — the file / batch / vehicle rows are lazy-created
-- the first time someone uses the endpoint.

ALTER TABLE lead_import_batches
  MODIFY COLUMN source_stage ENUM('generated','carfax','filter','tlo','manual') NOT NULL;

ALTER TABLE files
  MODIFY COLUMN current_stage ENUM('generated','carfax','filter','tlo','manual') NOT NULL;

-- Manual batches have no underlying file_artifacts row. Relax the
-- NOT NULL on lead_import_batches.artifact_id so the manual-add path
-- can write a batch without inventing a synthetic artifact.
ALTER TABLE lead_import_batches
  MODIFY COLUMN artifact_id INT NULL;
