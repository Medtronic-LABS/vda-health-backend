import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  tenantId!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  subjectAbhaRefHash!: string; // Cryptographic HMAC hash of the ABHA reference

  @Column({ type: 'varchar', length: 50, nullable: true })
  speaker?: string | null;

  @Column({ type: 'varchar', length: 255 })
  actingPrincipal!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ type: 'varchar', length: 100 })
  action!: string; // e.g. session_created, session_closed, consent_validated, consent_failure

  @Column({ type: 'varchar', length: 100 })
  entityName!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  entityId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details?: Record<string, any> | null;

  @Column({ type: 'varchar', length: 50 })
  hmacKeyId!: string; // Tracks which key version was used for hashing

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp!: Date;
}
