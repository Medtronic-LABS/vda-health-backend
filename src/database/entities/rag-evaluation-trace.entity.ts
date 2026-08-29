import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Privacy-minimized, source-level trace for real RAG quality observation. */
@Entity('rag_evaluation_traces')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'intent'])
export class RagEvaluationTrace {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid') tenantId!: string;
  @Column('text') query!: string;
  @Column('text', { nullable: true }) normalizedQuery?: string | null;
  @Column('varchar', { nullable: true }) intent?: string | null;
  @Column('varchar', { nullable: true }) agent?: string | null;
  @Column('varchar', { nullable: true }) language?: string | null;
  @Column('varchar', { nullable: true }) domain?: string | null;
  @Column('varchar', { nullable: true }) state?: string | null;
  @Column('varchar', { nullable: true }) providerType?: string | null;
  @Column('int', { default: 0 }) retrievedChunkCount!: number;
  @Column('int', { default: 0 }) retrievalLatencyMs!: number;
  @Column('jsonb', { default: [] }) sources!: Array<Record<string, unknown>>;
  @Column('jsonb', { default: [] }) chunks!: Array<Record<string, unknown>>;
  @Column('text', { nullable: true }) response?: string | null;
  @Column('float', { nullable: true }) contextPrecision?: number | null;
  @Column('float', { nullable: true }) contextRecall?: number | null;
  @Column('float', { nullable: true }) faithfulness?: number | null;
  @Column('float', { nullable: true }) answerRelevancy?: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
