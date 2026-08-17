import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1723816800000 implements MigrationInterface {
  name = 'InitialSchema1723816800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable vector extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    // Create tenants
    await queryRunner.query(`
      CREATE TABLE tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        domain VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    // Create users
    await queryRunner.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        "externalId" VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_users_tenant ON users("tenantId");`,
    );

    // Create consent_artifacts
    await queryRunner.query(`
      CREATE TABLE consent_artifacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        "subjectId" VARCHAR(255) NOT NULL,
        "consentVersion" VARCHAR(50) NOT NULL,
        scopes TEXT[] NOT NULL,
        language VARCHAR(10) NOT NULL,
        "deliveryMode" VARCHAR(50) NOT NULL,
        "retentionInfo" JSONB NOT NULL,
        status VARCHAR(50) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "withdrawnAt" TIMESTAMP WITH TIME ZONE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_consent_tenant ON consent_artifacts("tenantId");`,
    );

    // Create consent_events
    await queryRunner.query(`
      CREATE TABLE consent_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "consentArtifactId" UUID NOT NULL REFERENCES consent_artifacts(id) ON DELETE CASCADE,
        "eventType" VARCHAR(50) NOT NULL,
        timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_consent_events_artifact ON consent_events("consentArtifactId");`,
    );

    // Create sessions
    await queryRunner.query(`
      CREATE TABLE sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        "externalId" VARCHAR(255) NOT NULL,
        "subjectAbhaRef" VARCHAR(255) NOT NULL,
        speaker VARCHAR(50) NOT NULL,
        "assistContextId" VARCHAR(255),
        "consentArtifactId" UUID NOT NULL REFERENCES consent_artifacts(id) ON DELETE RESTRICT,
        "localeHint" VARCHAR(10),
        "deviceClass" VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        "idleExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "absoluteExpiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "closedAt" TIMESTAMP WITH TIME ZONE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_sessions_tenant ON sessions("tenantId");`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_sessions_consent ON sessions("consentArtifactId");`,
    );

    // Create conversation_turns
    await queryRunner.query(`
      CREATE TABLE conversation_turns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "sessionId" UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        "turnNumber" INT NOT NULL,
        "correlationId" VARCHAR(255) NOT NULL,
        speaker VARCHAR(50) NOT NULL,
        "subjectRef" VARCHAR(255) NOT NULL,
        "inputText" TEXT,
        "outputText" TEXT,
        "responseType" VARCHAR(50) NOT NULL,
        intent VARCHAR(100),
        "selectedAgent" VARCHAR(100),
        latency INT NOT NULL,
        "safetyStatus" VARCHAR(50) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX idx_turns_session ON conversation_turns("sessionId");`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_turns_correlation ON conversation_turns("correlationId");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE conversation_turns;`);
    await queryRunner.query(`DROP TABLE sessions;`);
    await queryRunner.query(`DROP TABLE consent_events;`);
    await queryRunner.query(`DROP TABLE consent_artifacts;`);
    await queryRunner.query(`DROP TABLE users;`);
    await queryRunner.query(`DROP TABLE tenants;`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector;`);
  }
}
