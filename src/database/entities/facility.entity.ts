import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Authoritative, structured facility facts. Null means the source did not provide it. */
@Entity('facilities')
@Index(['tenantId', 'facilityId'], { unique: true })
@Index(['tenantId', 'state', 'district'])
export class Facility {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column() facilityId!: string;
  @Column() name!: string;
  @Column({ type: 'varchar', nullable: true }) state?: string | null;
  @Column({ type: 'varchar', nullable: true }) district?: string | null;
  @Column({ type: 'varchar', nullable: true }) city?: string | null;
  @Column({ type: 'varchar', nullable: true }) locality?: string | null;
  @Column({ type: 'text', nullable: true }) address?: string | null;
  @Column({ type: 'varchar', nullable: true }) contactNumber?: string | null;
  @Column({ type: 'varchar', nullable: true }) hospitalType?: string | null;
  @Column({ type: 'varchar', nullable: true }) empanelmentType?: string | null;
  @Column({ type: 'boolean', nullable: true }) pmjayStatus?: boolean | null;
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true }) latitude?: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true }) longitude?: string | null;
  @Column({ type: 'boolean', nullable: true }) emergencyAvailable?: boolean | null;
  @Column({ type: 'jsonb', nullable: true }) supportedServices?: string[] | null;
  /** Optional because structured facility feeds are not knowledge documents. */
  @Column('uuid', { nullable: true }) sourceDocumentId?: string | null;
  @Column({ type: 'varchar', nullable: true }) sourceVersion?: string | null;
  @Column({ type: 'varchar', nullable: true }) sourceUrl?: string | null;
  @Column({ type: 'jsonb', nullable: true }) specialityCodes?: string[] | null;
  @Column({ type: 'timestamptz', nullable: true }) sourceUpdatedAt?: Date | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
