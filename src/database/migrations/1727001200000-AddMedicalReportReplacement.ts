import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive version state. Existing rows remain available as uncategorized reports. */
export class AddMedicalReportReplacement1727001200000 implements MigrationInterface {
  name = 'AddMedicalReportReplacement1727001200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "medical_reports" ADD COLUMN "category" varchar(40)');
    await queryRunner.query('ALTER TABLE "medical_reports" ADD COLUMN "isCurrent" boolean NOT NULL DEFAULT true');
    await queryRunner.query('ALTER TABLE "medical_reports" ADD COLUMN "replacementOf" uuid');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_medical_report_current_category" ON "medical_reports" ("tenantId", "patientRef", "category") WHERE "isCurrent" = true AND "category" IS NOT NULL');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "UQ_medical_report_current_category"');
    await queryRunner.query('ALTER TABLE "medical_reports" DROP COLUMN "replacementOf"');
    await queryRunner.query('ALTER TABLE "medical_reports" DROP COLUMN "isCurrent"');
    await queryRunner.query('ALTER TABLE "medical_reports" DROP COLUMN "category"');
  }
}
