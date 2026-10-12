import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMobilePushDevices1727000900000 implements MigrationInterface {
  name = 'CreateMobilePushDevices1727000900000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "mobile_push_devices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "userId" uuid NOT NULL, "tokenHash" varchar(64) NOT NULL, "token" text NOT NULL, "platform" varchar(16) NOT NULL DEFAULT 'android', "disabledAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_mobile_push_devices" PRIMARY KEY ("id"), CONSTRAINT "UQ_mobile_push_token_hash" UNIQUE ("tokenHash"), CONSTRAINT "FK_mobile_push_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE, CONSTRAINT "FK_mobile_push_user" FOREIGN KEY ("userId") REFERENCES "mobile_users"("id") ON DELETE CASCADE)`);
    await queryRunner.query('CREATE INDEX "IDX_mobile_push_owner" ON "mobile_push_devices" ("tenantId", "userId")');
    await queryRunner.query(`CREATE TABLE "prescription_push_deliveries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "userId" uuid NOT NULL, "prescriptionId" uuid NOT NULL, "status" varchar(24) NOT NULL, "deviceId" uuid NOT NULL, "attempts" int NOT NULL DEFAULT 0, "nextAttemptAt" timestamptz NOT NULL DEFAULT now(), "deliveredAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "PK_prescription_push_deliveries" PRIMARY KEY ("id"), CONSTRAINT "UQ_prescription_push_delivery" UNIQUE ("prescriptionId", "status", "deviceId"), CONSTRAINT "FK_prescription_push_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE, CONSTRAINT "FK_prescription_push_user" FOREIGN KEY ("userId") REFERENCES "mobile_users"("id") ON DELETE CASCADE, CONSTRAINT "FK_prescription_push_device" FOREIGN KEY ("deviceId") REFERENCES "mobile_push_devices"("id") ON DELETE CASCADE, CONSTRAINT "FK_prescription_push_record" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE)`);
    await queryRunner.query('CREATE INDEX "IDX_prescription_push_due" ON "prescription_push_deliveries" ("nextAttemptAt") WHERE "deliveredAt" IS NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "prescription_push_deliveries"');
    await queryRunner.query('DROP TABLE "mobile_push_devices"');
  }
}
