import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('synthetic_patient_feedback')
export class SyntheticPatientFeedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  tenantId!: string;

  @Column()
  syntheticPatientId!: string;

  @Column('uuid')
  sessionId!: string;

  @Column({ type: 'varchar', nullable: true })
  responseId?: string | null;

  @Column('boolean')
  helpful!: boolean;

  @Column({ type: 'varchar', nullable: true })
  reason?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
