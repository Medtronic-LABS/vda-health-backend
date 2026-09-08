import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClinicalFollowUpAttendance1726000000000 implements MigrationInterface {
  name = 'AddClinicalFollowUpAttendance1726000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "clinical_follow_up_attendance" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "patientRef" varchar NOT NULL, "eventId" varchar NOT NULL, "dueDate" date NOT NULL, "dateSource" varchar NOT NULL, "attendanceStatus" varchar NOT NULL, "respondedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_clinical_follow_up_attendance" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_clinical_follow_up_attendance_event" ON "clinical_follow_up_attendance" ("tenantId", "patientRef", "eventId", "dueDate")`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "clinical_follow_up_attendance"');
  }
}
