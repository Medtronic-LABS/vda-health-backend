import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { KnowledgeDocument } from './knowledge-document.entity';
import { KnowledgeEmbedding } from './knowledge-embedding.entity';

@Entity('knowledge_chunks')
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  documentId!: string;

  @Column({ type: 'varchar', length: 50, default: '1.0' })
  documentVersion!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'integer' })
  chunkIndex!: number;

  @Column({ type: 'varchar', length: 20, default: 'hi' })
  language!: string;

  @Column({ type: 'varchar', length: 100 })
  domain!: string;

  @Column({ type: 'varchar', length: 100 })
  category!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  role!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  district!: string | null;

  @Column({ type: 'varchar', length: 255 })
  source!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @ManyToOne(() => KnowledgeDocument, (doc) => doc.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'documentId' })
  document!: KnowledgeDocument;

  @OneToOne(() => KnowledgeEmbedding, (emb) => emb.chunk, {
    cascade: true,
  })
  embedding!: KnowledgeEmbedding;

  @CreateDateColumn()
  createdAt!: Date;
}
