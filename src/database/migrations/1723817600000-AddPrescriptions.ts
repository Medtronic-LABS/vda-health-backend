import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPrescriptions1723817600000 implements MigrationInterface {
  name = 'AddPrescriptions1723817600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "prescriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "patientRef" varchar NOT NULL, "prescriptionId" varchar NOT NULL, "prescriptionDate" TIMESTAMP, "prescriberName" varchar, "sourceDocumentId" varchar NOT NULL, "filename" varchar NOT NULL, "checksum" varchar NOT NULL, "extractedText" text NOT NULL, "medications" jsonb NOT NULL DEFAULT '[]', "extractionStatus" varchar NOT NULL DEFAULT 'REVIEW_REQUIRED', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_prescriptions_id" PRIMARY KEY ("id"))`);
    await q.query('CREATE INDEX "IDX_prescriptions_tenant_patient" ON "prescriptions" ("tenantId", "patientRef")');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE "prescriptions"'); }
}
