import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalEscalationConversationTurns1725000400000 implements MigrationInterface {
  name = 'AddClinicalEscalationConversationTurns1725000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversation_turns" ADD COLUMN IF NOT EXISTS "clinicalEscalationId" uuid`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_conversation_turns_clinical_escalation" ON "conversation_turns" ("clinicalEscalationId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_clinical_escalation_turn_idempotency" ON "conversation_turns" ("clinicalEscalationId", "idempotencyKey") WHERE "clinicalEscalationId" IS NOT NULL AND "idempotencyKey" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_clinical_escalation_turn_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversation_turns_clinical_escalation"`);
    await queryRunner.query(`ALTER TABLE "conversation_turns" DROP COLUMN IF EXISTS "clinicalEscalationId"`);
  }
}
