import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('mobile_push_devices')
export class MobilePushDevice {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column('uuid') tenantId!: string;
  @Index() @Column('uuid') userId!: string;
  @Index({ unique: true }) @Column({ length: 64 }) tokenHash!: string;
  @Column({ type: 'text' }) token!: string;
  @Column({ length: 16, default: 'android' }) platform!: string;
  @Column({ type: 'timestamptz', nullable: true }) disabledAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
