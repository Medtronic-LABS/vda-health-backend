import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive provenance only. Historical turns cannot be attributed by text safely. */
export class AddReportTurnProvenance1727001100000 implements MigrationInterface {
  name = 'AddReportTurnProvenance1727001100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "conversation_turns" ADD COLUMN "reportId" uuid');
    await queryRunner.query('CREATE INDEX "IDX_conversation_turns_reportId" ON "conversation_turns" ("reportId")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_conversation_turns_reportId"');
    await queryRunner.query('ALTER TABLE "conversation_turns" DROP COLUMN "reportId"');
  }
}
