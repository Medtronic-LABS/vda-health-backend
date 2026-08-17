import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditEvents1723816900000 implements MigrationInterface {
  name = 'AddAuditEvents1723816900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenantId" uuid NOT NULL,
        "subjectAbhaRefHash" varchar(255) NOT NULL,
        "speaker" varchar(50),
        "actingPrincipal" varchar(255) NOT NULL,
        "correlationId" varchar(255) NOT NULL,
        "action" varchar(100) NOT NULL,
        "entityName" varchar(100) NOT NULL,
        "entityId" varchar(255),
        "details" jsonb,
        "hmacKeyId" varchar(50) NOT NULL,
        "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_events_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_events_tenantId" ON "audit_events" ("tenantId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_events_subjectAbhaRefHash" ON "audit_events" ("subjectAbhaRefHash")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_audit_events_correlationId" ON "audit_events" ("correlationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_events_correlationId"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_events_subjectAbhaRefHash"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_events_tenantId"`);
    await queryRunner.query(`DROP TABLE "audit_events"`);
  }
}
