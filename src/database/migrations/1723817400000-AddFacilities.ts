import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFacilities1723817400000 implements MigrationInterface {
  name = 'AddFacilities1723817400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE TABLE "facilities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "facilityId" varchar NOT NULL, "name" varchar NOT NULL, "state" varchar, "district" varchar, "city" varchar, "locality" varchar, "address" text, "contactNumber" varchar, "hospitalType" varchar, "empanelmentType" varchar, "pmjayStatus" boolean, "latitude" numeric(10,7), "longitude" numeric(10,7), "emergencyAvailable" boolean, "supportedServices" jsonb, "sourceDocumentId" uuid NOT NULL, "sourceVersion" varchar, "sourceUrl" varchar, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_facilities_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_facilities_tenant_facility" UNIQUE ("tenantId", "facilityId"))');
    await q.query('CREATE INDEX "IDX_facilities_tenant_state_district" ON "facilities" ("tenantId", "state", "district")');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE "facilities"'); }
}
