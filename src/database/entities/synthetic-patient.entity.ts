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

  @Column()
  gender!: string;

  @Column()
  state!: string;

  @Column()
  district!: string;

  @Column({ default: 'hi' })
  language!: string;

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
