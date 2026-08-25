import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyntheticPatients1723817200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "synthetic_patients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "syntheticPatientId" character varying NOT NULL, "name" character varying NOT NULL, "age" integer NOT NULL, "gender" character varying NOT NULL, "state" character varying NOT NULL, "district" character varying NOT NULL, "language" character varying NOT NULL DEFAULT 'hi', "phoneNumber" character varying, "clinicalProfile" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_synthetic_patients" PRIMARY KEY ("id"), CONSTRAINT "UQ_synthetic_patient_id" UNIQUE ("syntheticPatientId"))`);
    await queryRunner.query(`CREATE INDEX "IDX_synthetic_patients_tenant" ON "synthetic_patients" ("tenantId")`);
    await queryRunner.query(`CREATE TABLE "synthetic_patient_feedback" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "syntheticPatientId" character varying NOT NULL, "sessionId" uuid NOT NULL, "responseId" character varying, "helpful" boolean NOT NULL, "reason" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_synthetic_patient_feedback" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_synthetic_feedback_tenant" ON "synthetic_patient_feedback" ("tenantId")`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "synthetic_patient_feedback"`);
    await queryRunner.query(`DROP TABLE "synthetic_patients"`);
  }
}
