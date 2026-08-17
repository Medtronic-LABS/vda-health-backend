import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateConversationTurns1723817000000 implements MigrationInterface {
  name = 'UpdateConversationTurns1723817000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversation_turns ADD COLUMN "status" VARCHAR(50) NOT NULL DEFAULT 'PROCESSING';
      ALTER TABLE conversation_turns ADD COLUMN "idempotencyKey" VARCHAR(255);
      ALTER TABLE conversation_turns ADD COLUMN "conversationRetentionGranted" BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE conversation_turns ADD COLUMN "processingStartedAt" TIMESTAMP WITH TIME ZONE;
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_turns_idempotency" ON conversation_turns ("idempotencyKey");
    `);

    await queryRunner.query(`
      ALTER TABLE conversation_turns ADD CONSTRAINT "uq_session_turn" UNIQUE ("sessionId", "turnNumber");
    `);

    await queryRunner.query(`
      ALTER TABLE conversation_turns ADD CONSTRAINT "uq_session_idempotency" UNIQUE ("sessionId", "idempotencyKey");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE conversation_turns DROP CONSTRAINT "uq_session_idempotency";`,
    );
    await queryRunner.query(
      `ALTER TABLE conversation_turns DROP CONSTRAINT "uq_session_turn";`,
    );
    await queryRunner.query(`DROP INDEX "IDX_turns_idempotency";`);
    await queryRunner.query(`
      ALTER TABLE conversation_turns DROP COLUMN "processingStartedAt";
      ALTER TABLE conversation_turns DROP COLUMN "conversationRetentionGranted";
      ALTER TABLE conversation_turns DROP COLUMN "idempotencyKey";
      ALTER TABLE conversation_turns DROP COLUMN "status";
    `);
  }
}
