import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prescription_push_deliveries')
@Index(['prescriptionId', 'status', 'deviceId'], { unique: true })
export class PrescriptionPushDelivery {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column('uuid') tenantId!: string;
  @Column('uuid') userId!: string;
  @Column('uuid') prescriptionId!: string;
  @Column({ length: 24 }) status!: 'VERIFIED' | 'REJECTED' | 'NEEDS_RESUBMISSION';
  @Column('uuid') deviceId!: string;
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Index() @Column({ type: 'timestamptz', default: () => 'now()' }) nextAttemptAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) deliveredAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
