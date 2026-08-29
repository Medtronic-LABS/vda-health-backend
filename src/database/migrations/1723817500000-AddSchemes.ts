import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSchemes1723817500000 implements MigrationInterface {
  name = 'AddSchemes1723817500000';
  async up(q: QueryRunner): Promise<void> { await q.query('CREATE TABLE "schemes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "schemeId" varchar NOT NULL, "name" varchar NOT NULL, "description" text, "geographyScope" varchar NOT NULL, "state" varchar, "eligibilityCriteria" text, "benefitsDescription" text, "coverageInformation" text, "requiredDocuments" jsonb, "applicationProcess" text, "officialUrl" varchar, "helpline" varchar, "sourceDocumentId" uuid NOT NULL, "sourceVersion" varchar, "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_schemes_id" PRIMARY KEY ("id"), CONSTRAINT "UQ_schemes_tenant_scheme" UNIQUE ("tenantId", "schemeId"))'); await q.query('CREATE INDEX "IDX_schemes_tenant_state_active" ON "schemes" ("tenantId", "state", "active")'); }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE "schemes"'); }
}
