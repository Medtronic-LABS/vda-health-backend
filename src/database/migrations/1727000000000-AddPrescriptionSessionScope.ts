import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPrescriptionSessionScope1727000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "sessionId" uuid'); await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_prescriptions_tenant_patient_session" ON "prescriptions" ("tenantId", "patientRef", "sessionId")'); }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP INDEX IF EXISTS "IDX_prescriptions_tenant_patient_session"'); await queryRunner.query('ALTER TABLE "prescriptions" DROP COLUMN IF EXISTS "sessionId"'); }
}
