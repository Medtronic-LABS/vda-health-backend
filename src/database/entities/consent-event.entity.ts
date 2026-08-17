import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConsentArtifact } from './consent-artifact.entity';

@Entity('consent_events')
export class ConsentEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('uuid')
  consentArtifactId!: string;

  @ManyToOne(() => ConsentArtifact, (consent) => consent.events, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'consentArtifactId' })
  consentArtifact?: ConsentArtifact;

  @Column()
  eventType!: string; // CREATED, WITHDRAWN

  @CreateDateColumn({ type: 'timestamptz' })
  timestamp!: Date;
}
