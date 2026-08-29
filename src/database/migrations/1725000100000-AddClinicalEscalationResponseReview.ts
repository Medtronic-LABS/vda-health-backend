import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalEscalationResponseReview1725000100000 implements MigrationInterface {
  name = 'AddClinicalEscalationResponseReview1725000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "sessionId" uuid`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "originalPatientResponse" text`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "responseReviewDecision" varchar(30)`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "correctedPatientResponse" text`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "responseReviewerId" varchar(255)`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "responseReviewedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "clinical_escalations" SET "originalPatientResponse" = "patientSafeResponse" WHERE "originalPatientResponse" IS NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_clinical_escalations_session" ON "clinical_escalations" ("sessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_clinical_escalations_session"`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "responseReviewedAt", DROP COLUMN IF EXISTS "responseReviewerId", DROP COLUMN IF EXISTS "correctedPatientResponse", DROP COLUMN IF EXISTS "responseReviewDecision", DROP COLUMN IF EXISTS "originalPatientResponse", DROP COLUMN IF EXISTS "sessionId"`);
  }
}
