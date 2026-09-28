import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrescriptionWorkerReview1727000600000 implements MigrationInterface {
  name = 'AddPrescriptionWorkerReview1727000600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN "sourceMimeType" varchar(120)`);
    await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN "sourceFile" bytea`);
    await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN "verifiedMedications" jsonb`);
    await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN "verifiedInvestigations" jsonb`);
    await queryRunner.query(`CREATE INDEX "IDX_prescriptions_verification_worklist" ON "prescriptions" ("tenantId", "verificationStatus", "createdAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_prescriptions_active_verified_plan" ON "prescriptions" ("tenantId", "patientRef") WHERE "activePlan" = true AND "verificationStatus" = 'VERIFIED'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_prescriptions_active_verified_plan"`);
    await queryRunner.query(`DROP INDEX "IDX_prescriptions_verification_worklist"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verifiedInvestigations"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verifiedMedications"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "sourceFile"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "sourceMimeType"`);
  }
}
