-- Step: Add sales_agent role to users.role enum.
-- The existing roles (admin, carfax, filter, tlo, marketer) all live in
-- the file-pipeline / marketing world. Sales agents are the operators
-- who work the lead queue end-to-end (calls → BoS → funding → dispatch)
-- but never touch the import pipeline or marketing campaigns.
--
-- Leads visibility for sales agents is handled in /api/leads.php — the
-- "non-admin/non-marketer" branch already restricts to their assigned
-- rows, so a sales_agent automatically sees only their own pipeline.

ALTER TABLE users
  MODIFY COLUMN role ENUM(
    'admin','carfax','filter','tlo','marketer','sales_agent'
  ) NOT NULL DEFAULT 'admin';
