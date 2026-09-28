import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PrescriptionVerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED'
  | 'NEEDS_RESUBMISSION'
  | 'SUPERSEDED';

export type PrescriptionVerifierRole = 'ASHA' | 'ANM' | 'CHO';

/** Development-patient prescription source plus explicitly extracted medication facts. */
@Entity('prescriptions')
@Index(['tenantId', 'patientRef'])
export class Prescription {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column() patientRef!: string;
  /** Current VDA session that is authorized to use this uploaded document context. */
  @Column({ type: 'uuid', nullable: true }) sessionId!: string | null;
  @Column() prescriptionId!: string;
  @Column({ type: 'timestamp', nullable: true }) prescriptionDate?: Date | null;
  @Column({ type: 'varchar', nullable: true }) prescriberName?: string | null;
  @Column() sourceDocumentId!: string;
  @Column() filename!: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) sourceMimeType!: string | null;
  @Column({ type: 'bytea', nullable: true, select: false }) sourceFile!: Buffer | null;
  @Column() checksum!: string;
  @Column({ type: 'text' }) extractedText!: string;
  @Column({ type: 'jsonb', default: [] }) medications!: Array<Record<string, string | null>>;
  @Column({ type: 'jsonb', default: [] }) investigations!: Array<Record<string, string | null>>;
  /** Worker-reviewed values; original AI extraction remains immutable above. */
  @Column({ type: 'jsonb', nullable: true }) verifiedMedications!: Array<Record<string, string | null>> | null;
  @Column({ type: 'jsonb', nullable: true }) verifiedInvestigations!: Array<Record<string, string | null>> | null;
  @Column({ default: 'REVIEW_REQUIRED' }) extractionStatus!: 'REVIEW_REQUIRED' | 'EXTRACTED' | 'APPROVED' | 'REJECTED' | 'FAILED';
  /** Extraction quality is not clinical verification. */
  @Column({ type: 'varchar', length: 32, default: 'UNVERIFIED' })
  verificationStatus!: PrescriptionVerificationStatus;
  @Column({ type: 'varchar', length: 160, nullable: true }) verifiedBy!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) verifierRole!: PrescriptionVerifierRole | null;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) verificationNote!: string | null;
  /** Explicitly patient-visible explanation; never substitute the internal verification note. */
  @Column({ type: 'text', nullable: true }) patientReviewReason!: string | null;
  /** Revision foundation for future verified medication-plan replacement. */
  @Column({ type: 'integer', default: 1 }) planRevision!: number;
  @Column({ type: 'uuid', nullable: true }) supersedesPrescriptionId!: string | null;
  @Column({ type: 'boolean', default: false }) activePlan!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
