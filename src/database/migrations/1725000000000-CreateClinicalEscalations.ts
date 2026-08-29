import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClinicalEscalations1725000000000 implements MigrationInterface {
  name = 'CreateClinicalEscalations1725000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "clinical_escalations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL,
        "turnId" uuid NOT NULL, "subjectRefHash" varchar(255) NOT NULL,
        "correlationId" varchar(255) NOT NULL, "tier" varchar(2) NOT NULL,
        "clinicalCategory" varchar(100) NOT NULL, "ruleId" varchar(100) NOT NULL,
        "ruleVersion" varchar(50), "language" varchar(30), "sanitizedInputText" text,
        "patientSafeResponse" text, "status" varchar(30) NOT NULL DEFAULT 'OPEN',
        "reviewOutcome" varchar(30), "reviewerId" varchar(255), "reviewerNote" text,
        "reviewedAt" TIMESTAMP WITH TIME ZONE, "reviewHistory" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clinical_escalations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_clinical_escalations_tenant_status_created" ON "clinical_escalations" ("tenantId", "status", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_clinical_escalations_tenant_correlation" ON "clinical_escalations" ("tenantId", "correlationId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_clinical_escalations_turn" ON "clinical_escalations" ("turnId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "clinical_escalations"`);
  }
}
