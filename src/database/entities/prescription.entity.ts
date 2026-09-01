import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
  @Column() checksum!: string;
  @Column({ type: 'text' }) extractedText!: string;
  @Column({ type: 'jsonb', default: [] }) medications!: Array<Record<string, string | null>>;
  @Column({ type: 'jsonb', default: [] }) investigations!: Array<Record<string, string | null>>;
  @Column({ default: 'REVIEW_REQUIRED' }) extractionStatus!: 'REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED' | 'FAILED';
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
