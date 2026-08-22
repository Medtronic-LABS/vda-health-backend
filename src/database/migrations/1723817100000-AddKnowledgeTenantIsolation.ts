import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeTenantIsolation1723817100000
  implements MigrationInterface
{
  name = 'AddKnowledgeTenantIsolation1723817100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing pre-tenant demo rows are intentionally not readable once this
    // migration is applied; ownership must be explicit for all new knowledge.
    await queryRunner.query(
      `ALTER TABLE "knowledge_documents" ADD COLUMN IF NOT EXISTS "tenantId" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "tenantId" uuid;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_knowledge_documents_tenant" ON "knowledge_documents" ("tenantId");`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_knowledge_chunks_tenant" ON "knowledge_chunks" ("tenantId");`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_knowledge_document_tenant_checksum" ON "knowledge_documents" ("tenantId", "checksum") WHERE "checksum" IS NOT NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_knowledge_document_tenant_checksum";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_chunks_tenant";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_knowledge_documents_tenant";`);
    await queryRunner.query(`ALTER TABLE "knowledge_chunks" DROP COLUMN IF EXISTS "tenantId";`);
    await queryRunner.query(`ALTER TABLE "knowledge_documents" DROP COLUMN IF EXISTS "tenantId";`);
  }
}
