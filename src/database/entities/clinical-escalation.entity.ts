import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ClinicalEscalationTier = 'T1' | 'T2';
export type ClinicalEscalationStatus = 'OPEN' | 'REVIEWED' | 'TRUE_POSITIVE' | 'FALSE_POSITIVE';
export type ClinicalEscalationOutcome = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'ANNOTATED';
export type ClinicalResponseReviewDecision = 'APPROVED' | 'CORRECTED' | 'ANNOTATED';

/** Privacy-minimized operational record of an existing SafetyGate escalation. */
@Entity('clinical_escalations')
@Index(['tenantId', 'status', 'createdAt'])
@Index(['tenantId', 'correlationId'])
@Index(['turnId'])
export class ClinicalEscalation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column('uuid') turnId!: string;
  @Column('uuid') sessionId!: string;
  @Column({ type: 'varchar', length: 255 }) subjectRefHash!: string;
  @Column({ type: 'varchar', length: 255 }) correlationId!: string;
  @Column({ type: 'varchar', length: 2 }) tier!: ClinicalEscalationTier;
  @Column({ type: 'varchar', length: 100 }) clinicalCategory!: string;
  @Column({ type: 'varchar', length: 100 }) ruleId!: string;
  @Column({ type: 'varchar', length: 50, nullable: true }) ruleVersion?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) language?: string | null;
  // Present only where the existing conversation-retention policy permits it.
  @Column({ type: 'text', nullable: true }) sanitizedInputText?: string | null;
  @Column({ type: 'text', nullable: true }) patientSafeResponse?: string | null;
  /** Immutable response returned at the original SafetyGate decision. */
  @Column({ type: 'text', nullable: true }) originalPatientResponse?: string | null;
  /** Allowlisted, existing response components needed to retain emergency cards after text review. */
  @Column({ type: 'jsonb', nullable: true }) originalResponseContext?: Record<string, unknown> | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) responseReviewDecision?: ClinicalResponseReviewDecision | null;
  @Column({ type: 'text', nullable: true }) correctedPatientResponse?: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) responseReviewerId?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) responseReviewedAt?: Date | null;
  @Column({ type: 'varchar', length: 30, default: 'OPEN' }) status!: ClinicalEscalationStatus;
  @Column({ type: 'varchar', length: 30, nullable: true }) reviewOutcome?: ClinicalEscalationOutcome | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) reviewerId?: string | null;
  @Column({ type: 'text', nullable: true }) reviewerNote?: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt?: Date | null;
  @Column({ type: 'jsonb', default: [] }) reviewHistory!: Array<Record<string, unknown>>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
