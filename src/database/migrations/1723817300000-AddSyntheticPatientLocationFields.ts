import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds optional development-only demographics. Existing synthetic profiles are
 * preserved; location is never inferred from a district or state.
 */
export class AddSyntheticPatientLocationFields1723817300000 implements MigrationInterface {
  name = 'AddSyntheticPatientLocationFields1723817300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "synthetic_patients" ADD COLUMN IF NOT EXISTS "dateOfBirth" date');
    await queryRunner.query('ALTER TABLE "synthetic_patients" ADD COLUMN IF NOT EXISTS "city" varchar');
    await queryRunner.query('ALTER TABLE "synthetic_patients" ADD COLUMN IF NOT EXISTS "locality" varchar');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "synthetic_patients" DROP COLUMN IF EXISTS "locality"');
    await queryRunner.query('ALTER TABLE "synthetic_patients" DROP COLUMN IF EXISTS "city"');
    await queryRunner.query('ALTER TABLE "synthetic_patients" DROP COLUMN IF EXISTS "dateOfBirth"');
  }
}
