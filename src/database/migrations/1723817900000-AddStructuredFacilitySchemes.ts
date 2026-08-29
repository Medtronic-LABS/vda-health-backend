import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStructuredFacilitySchemes1723817900000 implements MigrationInterface {
  name = 'AddStructuredFacilitySchemes1723817900000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "facilities" ALTER COLUMN "sourceDocumentId" DROP NOT NULL');
    await q.query('ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "specialityCodes" jsonb');
    await q.query('ALTER TABLE "facilities" ADD COLUMN IF NOT EXISTS "sourceUpdatedAt" TIMESTAMP WITH TIME ZONE');
    await q.query('CREATE INDEX IF NOT EXISTS "IDX_facilities_tenant_facility_code" ON "facilities" ("tenantId", "facilityId")');
    await q.query('CREATE TABLE IF NOT EXISTS "facility_schemes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "facilityId" uuid NOT NULL REFERENCES "facilities"("id") ON DELETE CASCADE, "scheme" varchar NOT NULL, "status" varchar, "source" varchar, "sourceUrl" varchar, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_facility_schemes_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_facility_schemes_tenant_facility_scheme" UNIQUE ("tenantId", "facilityId", "scheme"))');
    await q.query('CREATE INDEX IF NOT EXISTS "IDX_facility_schemes_tenant_scheme" ON "facility_schemes" ("tenantId", "scheme")');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE IF EXISTS "facility_schemes"'); }
}
