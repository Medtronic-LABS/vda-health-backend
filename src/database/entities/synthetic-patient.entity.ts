import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('synthetic_patients')
export class SyntheticPatient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  tenantId!: string;

  @Index({ unique: true })
  @Column()
  syntheticPatientId!: string;

  @Column()
  name!: string;

  @Column('int')
  age!: number;

  /** Optional development-only demographic detail supplied by the admin. */
  @Column({ type: 'date', nullable: true })
  dateOfBirth?: string | null;

  @Column()
  gender!: string;

  @Column()
  state!: string;

  @Column()
  district!: string;

  @Column({ type: 'varchar', nullable: true })
  city?: string | null;

  @Column({ type: 'varchar', nullable: true })
  locality?: string | null;

  @Column({ default: 'hi' })
  language!: string;

  @Column({ default: 'Asia/Kolkata' })
  timezone!: string;

  @Column({ type: 'varchar', nullable: true })
  phoneNumber?: string | null;

  // Development-only synthetic clinical data. Never an ABHA or production record.
  @Column({ type: 'jsonb', default: {} })
  clinicalProfile!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
