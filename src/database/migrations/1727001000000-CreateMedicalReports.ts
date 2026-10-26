import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive storage; no existing patient or prescription rows are changed. */
export class CreateMedicalReports1727001000000 implements MigrationInterface {
  name = 'CreateMedicalReports1727001000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "medical_reports" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "tenantId" uuid NOT NULL,
      "patientRef" character varying NOT NULL,
      "consentArtifactId" uuid NOT NULL,
      "uploadConsentAt" timestamptz NOT NULL,
      "filename" varchar(160) NOT NULL,
      "mimeType" varchar(32) NOT NULL,
      "checksum" varchar(64) NOT NULL,
      "sourceFile" bytea NOT NULL,
      "extractedText" text,
      "extractedFacts" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "explanation" text,
      "extractionStatus" varchar(24) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_medical_reports" PRIMARY KEY ("id"),
      CONSTRAINT "FK_medical_reports_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_medical_reports_consent" FOREIGN KEY ("consentArtifactId") REFERENCES "consent_artifacts"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query('CREATE INDEX "IDX_medical_reports_owner" ON "medical_reports" ("tenantId", "patientRef", "createdAt")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "medical_reports"');
  }
}
