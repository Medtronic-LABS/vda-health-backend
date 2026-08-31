import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalEscalationTeleconsultationFallback1725000300000 implements MigrationInterface {
  name = 'AddClinicalEscalationTeleconsultationFallback1725000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "teleconsultationOfferedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "teleconsultationRequestedAt" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "teleconsultationRequestedAt"`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "teleconsultationOfferedAt"`);
  }
}
