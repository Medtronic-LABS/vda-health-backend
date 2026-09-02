import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IphsLevel } from '../../facilities/iphs-classification';

export type DemoCapabilityAvailability =
  'AVAILABLE' | 'NOT_AVAILABLE' | 'UNKNOWN';

/** Explicitly synthetic facility capability used only by controlled demos/pilots. */
@Entity('facility_demo_capabilities')
@Index(['tenantId', 'facilityId', 'serviceCode'], { unique: true })
@Index(['tenantId', 'state', 'district', 'iphsLevel'])
export class FacilityDemoCapability {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  /** Existing source facility identifier; never creates or replaces a facility. */
  @Column() facilityId!: string;
  @Column('uuid') facilityRecordId!: string;
  @Column() state!: string;
  @Column() district!: string;
  @Column({ type: 'varchar', nullable: true }) areaLocality?: string | null;
  @Column() serviceCode!: string;
  @Column() serviceName!: string;
  @Column({ type: 'varchar', default: 'UNKNOWN' })
  availability!: DemoCapabilityAvailability;
  @Column({ type: 'varchar', default: 'MANUAL_DEMO_MAPPING' })
  sourceType!: 'MANUAL_DEMO_MAPPING';
  @Column({ type: 'varchar', default: 'VDA Pilot Facility Mapping' })
  source!: 'VDA Pilot Facility Mapping';
  @Column({ default: false }) verified!: boolean;
  @Column({ default: true }) demoOnly!: boolean;
  @Column({ type: 'varchar', default: 'UNKNOWN' }) iphsLevel!: IphsLevel;
  @Column({ type: 'varchar', nullable: true })
  classificationBasis?: string | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
