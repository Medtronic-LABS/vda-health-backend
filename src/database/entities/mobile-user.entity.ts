import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('mobile_users')
export class MobileUser {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column('uuid') tenantId!: string;
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'tenantId' }) tenant?: Tenant;
  @Column({ length: 120 }) fullName!: string;
  @Index({ unique: true }) @Column({ length: 10, unique: true }) phone!: string;
  @Column({ length: 255, select: false }) pinHash!: string;
  @Column('smallint') age!: number;
  @Column({ length: 16 }) gender!: string;
  @Column({ length: 100 }) state!: string;
  @Column({ length: 100 }) district!: string;
  @Column({ length: 8 }) preferredLanguage!: string;
  @Column({ type: 'varchar', length: 50, nullable: true, select: false }) abhaNumber!: string | null;
  @Column({ default: true }) isActive!: boolean;
  @Column('smallint', { default: 0, select: false }) failedLoginAttempts!: number;
  @Column({ type: 'timestamptz', nullable: true, select: false }) lockedUntil!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
