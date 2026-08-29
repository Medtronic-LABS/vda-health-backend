import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalEscalationResponseContext1725000200000 implements MigrationInterface {
  name = 'AddClinicalEscalationResponseContext1725000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "originalResponseContext" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "originalResponseContext"`);
  }
}
