import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrescriptionVerificationFoundation1727000500000
  implements MigrationInterface
{
  name = 'AddPrescriptionVerificationFoundation1727000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "verificationStatus" varchar(32) NOT NULL DEFAULT 'UNVERIFIED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "verifiedBy" varchar(160)`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "verifierRole" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "verifiedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "verificationNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "planRevision" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "supersedesPrescriptionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "prescriptions" ADD COLUMN "activePlan" boolean NOT NULL DEFAULT false`,
    );
    // Legacy extraction approval is deliberately not treated as worker
    // verification. Extracted documents enter the future worker queue.
    await queryRunner.query(
      `UPDATE "prescriptions" SET "verificationStatus" = 'PENDING_VERIFICATION' WHERE "extractionStatus" IN ('EXTRACTED', 'APPROVED')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "activePlan"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "supersedesPrescriptionId"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "planRevision"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verificationNote"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verifiedAt"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verifierRole"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verifiedBy"`);
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "verificationStatus"`);
  }
}
