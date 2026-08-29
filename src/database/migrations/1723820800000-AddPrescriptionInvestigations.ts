import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrescriptionInvestigations1723820800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "investigations" jsonb NOT NULL DEFAULT '[]'`); }
  public async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`ALTER TABLE "prescriptions" DROP COLUMN IF EXISTS "investigations"`); }
}
