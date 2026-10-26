import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A patient report is never a prescription or a general knowledge document. */
@Entity('medical_reports')
@Index(['tenantId', 'patientRef', 'createdAt'])
export class MedicalReport {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column() patientRef!: string;
  @Column('uuid') consentArtifactId!: string;
  @Column({ type: 'timestamptz' }) uploadConsentAt!: Date;
  @Column({ type: 'varchar', length: 160 }) filename!: string;
  @Column({ type: 'varchar', length: 32 }) mimeType!: string;
  @Column({ type: 'varchar', length: 64 }) checksum!: string;
  @Column({ type: 'bytea', select: false }) sourceFile!: Buffer;
  @Column({ type: 'text', nullable: true, select: false }) extractedText!: string | null;
  @Column({ type: 'jsonb', default: {} }) extractedFacts!: Record<string, unknown>;
  @Column({ type: 'text', nullable: true }) explanation!: string | null;
  @Column({ type: 'varchar', length: 24 }) extractionStatus!: 'EXTRACTED' | 'REVIEW_REQUIRED' | 'UNREADABLE';
  @Column({ type: 'varchar', length: 40, nullable: true }) category!: string | null;
  @Column({ type: 'boolean', default: true }) isCurrent!: boolean;
  @Column({ type: 'uuid', nullable: true }) replacementOf!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
