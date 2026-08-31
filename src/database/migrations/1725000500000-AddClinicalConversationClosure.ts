import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalConversationClosure1725000500000 implements MigrationInterface {
  name = 'AddClinicalConversationClosure1725000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "clinicalConversationClosedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" ADD COLUMN IF NOT EXISTS "clinicalConversationClosedBy" varchar(255)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "clinicalConversationClosedBy"`);
    await queryRunner.query(`ALTER TABLE "clinical_escalations" DROP COLUMN IF EXISTS "clinicalConversationClosedAt"`);
  }
}
