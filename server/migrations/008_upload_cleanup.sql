SET search_path=noctis,pg_catalog;
CREATE TABLE upload_gc(storage_key uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE upload_gc ENABLE ROW LEVEL SECURITY;
CREATE POLICY gc_worker ON upload_gc TO noctis_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,DELETE ON upload_gc TO noctis_worker;
RESET search_path;
