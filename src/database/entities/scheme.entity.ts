import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Structured scheme facts from an authoritative governed source. */
@Entity('schemes')
@Index(['tenantId', 'schemeId'], { unique: true })
@Index(['tenantId', 'state', 'active'])
export class Scheme {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column() schemeId!: string;
  @Column() name!: string;
  @Column({ type: 'text', nullable: true }) description?: string | null;
  @Column({ type: 'varchar' }) geographyScope!: 'NATIONAL' | 'STATE';
  @Column({ type: 'varchar', nullable: true }) state?: string | null;
  @Column({ type: 'text', nullable: true }) eligibilityCriteria?: string | null;
  @Column({ type: 'text', nullable: true }) benefitsDescription?: string | null;
  @Column({ type: 'text', nullable: true }) coverageInformation?: string | null;
  @Column({ type: 'jsonb', nullable: true }) requiredDocuments?: string[] | null;
  @Column({ type: 'text', nullable: true }) applicationProcess?: string | null;
  @Column({ type: 'varchar', nullable: true }) officialUrl?: string | null;
  @Column({ type: 'varchar', nullable: true }) helpline?: string | null;
  @Column('uuid') sourceDocumentId!: string;
  @Column({ type: 'varchar', nullable: true }) sourceVersion?: string | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
