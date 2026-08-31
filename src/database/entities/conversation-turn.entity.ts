import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Session } from './session.entity';

@Entity('conversation_turns')
export class ConversationTurn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  sessionId!: string;

  /** Set only for messages belonging to an active Clinical Escalation conversation. */
  @Index()
  @Column('uuid', { nullable: true })
  clinicalEscalationId?: string | null;

  @ManyToOne(() => Session, (session) => session.turns, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session?: Session;

  @Column()
  turnNumber!: number;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  correlationId!: string; // opaque string tracking ID

  @Column()
  speaker!: string; // self, assisted

  @Column()
  subjectRef!: string; // subject identity reference for attribution

  @Column({ type: 'text', nullable: true })
  inputText?: string | null; // governed by conversation_retention consent scope

  @Column({ type: 'text', nullable: true })
  outputText?: string | null; // governed by conversation_retention consent scope

  @Column()
  responseType!: string;

  @Column({ nullable: true })
  intent?: string;

  @Column({ nullable: true })
  selectedAgent?: string;

  @Column()
  latency!: number; // ms

  @Column()
  safetyStatus!: string; // SAFE, ESCALATED_BY_RULE, WITHHELD_QUALITY

  @Column({ type: 'varchar', length: 50, default: 'PROCESSING' })
  status!: string; // RECEIVED, PROCESSING, COMPLETED, WITHHELD, REJECTED

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  idempotencyKey?: string | null;

  @Column({ type: 'boolean', default: false })
  conversationRetentionGranted!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
