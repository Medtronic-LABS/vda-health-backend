import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Source-backed scheme association; it never implies current clinical availability. */
@Entity('facility_schemes')
@Index(['tenantId', 'facilityId', 'scheme'], { unique: true })
@Index(['tenantId', 'scheme'])
export class FacilityScheme {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column('uuid') facilityId!: string;
  @Column({ type: 'varchar' }) scheme!: string;
  @Column({ type: 'varchar', nullable: true }) status?: string | null;
  @Column({ type: 'varchar', nullable: true }) source?: string | null;
  @Column({ type: 'varchar', nullable: true }) sourceUrl?: string | null;
  @Column({ default: true }) active!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
