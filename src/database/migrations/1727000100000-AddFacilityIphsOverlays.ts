import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds state-scoped IPHS metadata without changing source facility records.
 * Backfill evidence is restricted to hospitalType and emergencyAvailable.
 */
export class AddFacilityIphsOverlays1727000100000 implements MigrationInterface {
  name = 'AddFacilityIphsOverlays1727000100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "facility_iphs_overlays" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "facilityId" uuid NOT NULL REFERENCES "facilities"("id") ON DELETE CASCADE,
        "state" varchar NOT NULL,
        "iphsLevel" varchar NOT NULL DEFAULT 'UNKNOWN',
        "iphsClassification" varchar NOT NULL DEFAULT 'UNKNOWN',
        "iphsServices" jsonb NOT NULL DEFAULT '{"status":"NOT_VERIFIED","services":[]}'::jsonb,
        "emergencyCapability" varchar NOT NULL DEFAULT 'UNKNOWN',
        "referralLevel" varchar NOT NULL DEFAULT 'UNKNOWN',
        "iphsSource" varchar NOT NULL DEFAULT 'IPHS 2022',
        "iphsVerified" boolean NOT NULL DEFAULT false,
        "classificationBasis" varchar,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_facility_iphs_overlays_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_facility_iphs_overlays_tenant_facility_state"
          UNIQUE ("tenantId", "facilityId", "state")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facility_iphs_overlays_tenant_state_level"
      ON "facility_iphs_overlays" ("tenantId", "state", "iphsLevel")
    `);
    await queryRunner.query(`
      INSERT INTO "facility_iphs_overlays" (
        "tenantId", "facilityId", "state", "iphsLevel", "iphsClassification",
        "iphsServices", "emergencyCapability", "referralLevel", "iphsSource",
        "iphsVerified", "classificationBasis", "active"
      )
      SELECT
        f."tenantId",
        f.id,
        UPPER(REPLACE(TRIM(f.state), ' ', '_')),
        CASE
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-SHC', 'SHC', 'SUB HEALTH CENTRE', 'SUB-HEALTH CENTRE', 'UHWC', 'URBAN HEALTH AND WELLNESS CENTRE') THEN 'HWC_SHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-PHC', 'PHC', 'PRIMARY HEALTH CENTRE', 'HWC-UPHC', 'UPHC', 'URBAN PRIMARY HEALTH CENTRE') THEN 'HWC_PHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('CHC', 'UCHC', 'COMMUNITY HEALTH CENTRE', 'FRU CHC', 'FRU-CHC', 'FRU UCHC', 'FRU-UCHC', 'NON-FRU CHC', 'NON FRU CHC') THEN 'CHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('SDH', 'SUB DISTRICT HOSPITAL', 'SUB-DISTRICT HOSPITAL') THEN 'SDH'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('DH', 'DISTRICT HOSPITAL') THEN 'DH'
          ELSE 'UNKNOWN'
        END,
        CASE
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-SHC', 'SHC', 'SUB HEALTH CENTRE', 'SUB-HEALTH CENTRE') THEN 'HWC_SHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('UHWC', 'URBAN HEALTH AND WELLNESS CENTRE') THEN 'UHWC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-PHC', 'PHC', 'PRIMARY HEALTH CENTRE') THEN 'HWC_PHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-UPHC', 'UPHC', 'URBAN PRIMARY HEALTH CENTRE') THEN 'HWC_UPHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('FRU CHC', 'FRU-CHC', 'FRU UCHC', 'FRU-UCHC') THEN 'FRU_CHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('NON-FRU CHC', 'NON FRU CHC') THEN 'NON_FRU_CHC'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('CHC', 'UCHC', 'COMMUNITY HEALTH CENTRE') THEN 'CHC_NOT_SUBCLASSIFIED'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('SDH', 'SUB DISTRICT HOSPITAL', 'SUB-DISTRICT HOSPITAL') THEN 'SDH'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('DH', 'DISTRICT HOSPITAL') THEN 'DH'
          ELSE 'UNKNOWN'
        END,
        '{"status":"NOT_VERIFIED","services":[]}'::jsonb,
        CASE
          WHEN f."emergencyAvailable" IS TRUE THEN 'SOURCE_REPORTED_CAPABLE'
          WHEN f."emergencyAvailable" IS FALSE THEN 'SOURCE_REPORTED_NOT_CAPABLE'
          ELSE 'UNKNOWN'
        END,
        CASE
          WHEN UPPER(TRIM(f."hospitalType")) IN ('HWC-SHC', 'SHC', 'SUB HEALTH CENTRE', 'SUB-HEALTH CENTRE', 'UHWC', 'URBAN HEALTH AND WELLNESS CENTRE', 'HWC-PHC', 'PHC', 'PRIMARY HEALTH CENTRE', 'HWC-UPHC', 'UPHC', 'URBAN PRIMARY HEALTH CENTRE') THEN 'PRIMARY'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('CHC', 'UCHC', 'COMMUNITY HEALTH CENTRE', 'FRU CHC', 'FRU-CHC', 'FRU UCHC', 'FRU-UCHC', 'NON-FRU CHC', 'NON FRU CHC', 'SDH', 'SUB DISTRICT HOSPITAL', 'SUB-DISTRICT HOSPITAL') THEN 'SECONDARY'
          WHEN UPPER(TRIM(f."hospitalType")) IN ('DH', 'DISTRICT HOSPITAL') THEN 'DISTRICT'
          ELSE 'UNKNOWN'
        END,
        'IPHS 2022',
        false,
        CASE
          WHEN NULLIF(TRIM(f."hospitalType"), '') IS NULL THEN NULL
          ELSE 'hospitalType:' || UPPER(TRIM(f."hospitalType"))
        END,
        true
      FROM "facilities" f
      WHERE UPPER(REPLACE(TRIM(f.state), ' ', '_')) IN ('HARYANA', 'HIMACHAL_PRADESH')
      ON CONFLICT ("tenantId", "facilityId", "state") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "facility_iphs_overlays"');
  }
}
