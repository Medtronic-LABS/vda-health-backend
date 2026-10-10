import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMobileRefreshSessions1727000800000 implements MigrationInterface {
  name = 'CreateMobileRefreshSessions1727000800000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "mobile_refresh_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "userId" uuid NOT NULL, "familyId" uuid NOT NULL, "tokenHash" varchar(64) NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "expiresAt" timestamptz NOT NULL, "revokedAt" timestamptz, "replacedById" uuid, CONSTRAINT "PK_mobile_refresh_sessions" PRIMARY KEY ("id"), CONSTRAINT "UQ_mobile_refresh_token_hash" UNIQUE ("tokenHash"), CONSTRAINT "FK_mobile_refresh_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE, CONSTRAINT "FK_mobile_refresh_user" FOREIGN KEY ("userId") REFERENCES "mobile_users"("id") ON DELETE CASCADE)`);
    await queryRunner.query('CREATE INDEX "IDX_mobile_refresh_user" ON "mobile_refresh_sessions" ("userId")');
    await queryRunner.query('CREATE INDEX "IDX_mobile_refresh_family" ON "mobile_refresh_sessions" ("familyId")');
    await queryRunner.query('CREATE INDEX "IDX_mobile_refresh_expiry" ON "mobile_refresh_sessions" ("expiresAt")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "mobile_refresh_sessions"');
  }
}
