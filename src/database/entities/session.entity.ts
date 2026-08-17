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
import { ConsentArtifact } from './consent-artifact.entity';
import { ConversationTurn } from './conversation-turn.entity';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @Column()
  externalId!: string; // host application's external patient/subject identity

  @Column()
  subjectAbhaRef!: string; // approved subject reference abstraction

  @Column()
  speaker!: string; // self, assisted

  @Column({ nullable: true })
  assistContextId?: string;

  @Index()
  @Column('uuid')
  consentArtifactId!: string; // MUST be NOT NULL

  @ManyToOne(() => ConsentArtifact, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'consentArtifactId' })
  consentArtifact?: ConsentArtifact;

  @Column({ nullable: true })
  localeHint?: string;

  @Column({ nullable: true })
  deviceClass?: string;

  @Column({ default: 'ACTIVE' })
  status!: string; // ACTIVE, CLOSED

  @Column({ type: 'timestamptz' })
  idleExpiresAt!: Date;

  @Column({ type: 'timestamptz' })
  absoluteExpiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  @OneToMany(() => ConversationTurn, (turn) => turn.session)
  turns?: ConversationTurn[];
}
