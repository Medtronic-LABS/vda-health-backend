import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrescriptionPatientReviewReason1727000700000 implements MigrationInterface {
  name = 'AddPrescriptionPatientReviewReason1727000700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN "patientReviewReason" text`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN "patientReviewReason"`);
  }
}
