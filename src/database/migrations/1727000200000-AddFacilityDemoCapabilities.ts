import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds an isolated synthetic/manual capability layer; facility source rows are unchanged. */
export class AddFacilityDemoCapabilities1727000200000 implements MigrationInterface {
  name = 'AddFacilityDemoCapabilities1727000200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "facility_demo_capabilities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "facilityId" varchar NOT NULL,
        "facilityRecordId" uuid NOT NULL REFERENCES "facilities"("id") ON DELETE CASCADE,
        "state" varchar NOT NULL,
        "district" varchar NOT NULL,
        "areaLocality" varchar,
        "serviceCode" varchar NOT NULL,
        "serviceName" varchar NOT NULL,
        "availability" varchar NOT NULL DEFAULT 'UNKNOWN',
        "sourceType" varchar NOT NULL DEFAULT 'MANUAL_DEMO_MAPPING',
        "source" varchar NOT NULL DEFAULT 'VDA Pilot Facility Mapping',
        "verified" boolean NOT NULL DEFAULT false,
        "demoOnly" boolean NOT NULL DEFAULT true,
        "iphsLevel" varchar NOT NULL DEFAULT 'UNKNOWN',
        "classificationBasis" varchar,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_facility_demo_capabilities_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_facility_demo_capabilities_tenant_facility_service"
          UNIQUE ("tenantId", "facilityId", "serviceCode")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facility_demo_capabilities_tenant_state_level"
      ON "facility_demo_capabilities" ("tenantId", "state", "district", "iphsLevel")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_facility_demo_capabilities_facility_record"
      ON "facility_demo_capabilities" ("tenantId", "facilityRecordId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "facility_demo_capabilities"',
    );
  }
}
