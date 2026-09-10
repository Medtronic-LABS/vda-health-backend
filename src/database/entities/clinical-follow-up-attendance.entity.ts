import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Attendance outcome for a source-backed clinical follow-up, never medication adherence. */
@Entity('clinical_follow_up_attendance')
@Index(['tenantId', 'patientRef', 'eventId', 'dueDate'], { unique: true })
export class ClinicalFollowUpAttendance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column() patientRef!: string;
  @Column() eventId!: string;
  @Column({ type: 'date' }) dueDate!: string;
  @Column() dateSource!: 'EXPLICIT' | 'DERIVED_30_DAY';
  @Column() attendanceStatus!: 'COMPLETED' | 'MISSED';
  @Column({ type: 'timestamptz' }) respondedAt!: Date;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
