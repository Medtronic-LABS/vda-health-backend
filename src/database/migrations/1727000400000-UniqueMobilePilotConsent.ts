import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueMobilePilotConsent1727000400000 implements MigrationInterface {
  name = 'UniqueMobilePilotConsent1727000400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_mobile_pilot_active_consent"
      ON "consent_artifacts" ("tenantId", "subjectId", "consentVersion")
      WHERE "status" = 'ACTIVE' AND "consentVersion" = 'mobile-pilot-v1'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_mobile_pilot_active_consent"');
  }
}
