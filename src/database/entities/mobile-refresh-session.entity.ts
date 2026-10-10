import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('mobile_refresh_sessions')
export class MobileRefreshSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Index() @Column('uuid') tenantId!: string;
  @Index() @Column('uuid') userId!: string;
  @Index() @Column('uuid') familyId!: string;
  @Index({ unique: true }) @Column({ length: 64 }) tokenHash!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'timestamptz' }) expiresAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) replacedById!: string | null;
}
