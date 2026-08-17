import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { ConsentEvent } from './consent-event.entity';

@Entity('consent_artifacts')
export class ConsentArtifact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.consents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @Column()
  subjectId!: string; // subject identity reference according to HostIdentityContext

  @Column()
  consentVersion!: string;

  @Column('text', { array: true })
  scopes!: string[]; // record_read, conversation_retention, reminder_delivery

  @Column()
  language!: string;

  @Column()
  deliveryMode!: string;

  @Column('jsonb')
  retentionInfo!: Record<string, any>;

  @Column()
  status!: string; // ACTIVE, WITHDRAWN, EXPIRED

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  withdrawnAt?: Date | null;

  @OneToMany(() => ConsentEvent, (event) => event.consentArtifact)
  events?: ConsentEvent[];
}
