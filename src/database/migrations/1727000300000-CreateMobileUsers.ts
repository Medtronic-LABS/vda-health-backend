import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMobileUsers1727000300000 implements MigrationInterface {
  name = 'CreateMobileUsers1727000300000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "mobile_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "fullName" varchar(120) NOT NULL, "phone" varchar(10) NOT NULL, "pinHash" varchar(255) NOT NULL, "age" smallint NOT NULL, "gender" varchar(16) NOT NULL, "state" varchar(100) NOT NULL, "district" varchar(100) NOT NULL, "preferredLanguage" varchar(8) NOT NULL, "abhaNumber" varchar(50), "isActive" boolean NOT NULL DEFAULT true, "failedLoginAttempts" smallint NOT NULL DEFAULT 0, "lockedUntil" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_mobile_users" PRIMARY KEY ("id"), CONSTRAINT "UQ_mobile_users_phone" UNIQUE ("phone"), CONSTRAINT "FK_mobile_users_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE)`);
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_mobile_users_tenant" ON "mobile_users" ("tenantId")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "mobile_users"');
  }
}
