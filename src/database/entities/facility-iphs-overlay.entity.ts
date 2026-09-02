import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type IphsVerificationStatus = 'NOT_VERIFIED' | 'VERIFIED';
export type IphsServiceCapability = {
  status: IphsVerificationStatus;
  services: string[];
};

/**
 * Additive IPHS interpretation of a structured facility record. The overlay is
 * separate so source facts remain unchanged and states can evolve independently.
 */
@Entity('facility_iphs_overlays')
@Index(['tenantId', 'facilityId', 'state'], { unique: true })
@Index(['tenantId', 'state', 'iphsLevel'])
export class FacilityIphsOverlay {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column('uuid') facilityId!: string;
  @Column({ type: 'varchar' }) state!: string;
  @Column({ type: 'varchar', default: 'UNKNOWN' }) iphsLevel!: string;
  @Column({ type: 'varchar', default: 'UNKNOWN' }) iphsClassification!: string;
  @Column({
    type: 'jsonb',
    default: () =>
      `'${JSON.stringify({ status: 'NOT_VERIFIED', services: [] })}'::jsonb`,
  })
  iphsServices!: IphsServiceCapability;
  @Column({ type: 'varchar', default: 'UNKNOWN' }) emergencyCapability!: string;
  @Column({ type: 'varchar', default: 'UNKNOWN' }) referralLevel!: string;
  @Column({ type: 'varchar', default: 'IPHS 2022' }) iphsSource!: string;
  @Column({ type: 'boolean', default: false }) iphsVerified!: boolean;
  @Column({ type: 'varchar', nullable: true }) classificationBasis?:
    string | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
