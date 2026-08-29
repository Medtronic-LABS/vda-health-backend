import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRagEvaluationTraces1723818100000 implements MigrationInterface {
  name = 'AddRagEvaluationTraces1723818100000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "rag_evaluation_traces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "query" text NOT NULL, "normalizedQuery" text, "intent" varchar, "agent" varchar, "language" varchar, "domain" varchar, "state" varchar, "providerType" varchar, "retrievedChunkCount" integer NOT NULL DEFAULT 0, "retrievalLatencyMs" integer NOT NULL DEFAULT 0, "sources" jsonb NOT NULL DEFAULT '[]', "chunks" jsonb NOT NULL DEFAULT '[]', "response" text, "contextPrecision" double precision, "contextRecall" double precision, "faithfulness" double precision, "answerRelevancy" double precision, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_rag_evaluation_traces" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_rag_evaluation_traces_tenant_created" ON "rag_evaluation_traces" ("tenantId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_rag_evaluation_traces_tenant_intent" ON "rag_evaluation_traces" ("tenantId", "intent")`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "rag_evaluation_traces"`); }
}
