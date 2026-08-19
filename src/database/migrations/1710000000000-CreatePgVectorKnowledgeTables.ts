import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePgVectorKnowledgeTables1710000000000 implements MigrationInterface {
  name = 'CreatePgVectorKnowledgeTables1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Enable pgvector extension if available
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    // 2. Create knowledge_documents table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" character varying(255) NOT NULL,
        "description" text,
        "source" character varying(255) NOT NULL,
        "sourceUrl" character varying(500),
        "version" character varying(50) NOT NULL DEFAULT '1.0',
        "language" character varying(20) NOT NULL DEFAULT 'hi',
        "domain" character varying(100) NOT NULL,
        "category" character varying(100) NOT NULL,
        "role" character varying(100),
        "state" character varying(100),
        "district" character varying(100),
        "status" character varying(50) NOT NULL DEFAULT 'UPLOADED',
        "effectiveDate" TIMESTAMP,
        "reviewDate" TIMESTAMP,
        "checksum" character varying(64),
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_documents" PRIMARY KEY ("id")
      );
    `);

    // 3. Create knowledge_chunks table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "documentId" uuid NOT NULL,
        "documentVersion" character varying(50) NOT NULL DEFAULT '1.0',
        "content" text NOT NULL,
        "chunkIndex" integer NOT NULL,
        "language" character varying(20) NOT NULL DEFAULT 'hi',
        "domain" character varying(100) NOT NULL,
        "category" character varying(100) NOT NULL,
        "role" character varying(100),
        "state" character varying(100),
        "district" character varying(100),
        "source" character varying(255) NOT NULL,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_knowledge_chunks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_knowledge_chunks_document" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      );
    `);

    // 4. Create knowledge_embeddings table with vector(384) column
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
          CREATE TABLE IF NOT EXISTS "knowledge_embeddings" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "chunkId" uuid NOT NULL,
            "embedding" vector(384) NOT NULL,
            "embeddingModel" character varying(100) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
            "embeddingDimension" integer NOT NULL DEFAULT 384,
            "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_knowledge_embeddings" PRIMARY KEY ("id"),
            CONSTRAINT "FK_knowledge_embeddings_chunk" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE
          );

          -- Create HNSW Cosine Similarity Index
          CREATE INDEX IF NOT EXISTS "idx_embeddings_hnsw_cosine"
            ON "knowledge_embeddings" USING hnsw ("embedding" vector_cosine_ops);
        ELSE
          -- Fallback text representation if pgvector extension is not pre-installed in DB
          CREATE TABLE IF NOT EXISTS "knowledge_embeddings" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "chunkId" uuid NOT NULL,
            "embedding" text NOT NULL,
            "embeddingModel" character varying(100) NOT NULL DEFAULT 'all-MiniLM-L6-v2',
            "embeddingDimension" integer NOT NULL DEFAULT 384,
            "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT "PK_knowledge_embeddings" PRIMARY KEY ("id"),
            CONSTRAINT "FK_knowledge_embeddings_chunk" FOREIGN KEY ("chunkId") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE
          );
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_embeddings";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_chunks";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_documents";`);
  }
}
