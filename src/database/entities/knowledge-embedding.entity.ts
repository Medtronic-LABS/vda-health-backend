import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { KnowledgeChunk } from './knowledge-chunk.entity';

@Entity('knowledge_embeddings')
export class KnowledgeEmbedding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  chunkId!: string;

  @Column({ type: 'text', name: 'embedding' })
  embedding!: string;

  @Column({ type: 'varchar', length: 100, default: 'all-MiniLM-L6-v2' })
  embeddingModel!: string;

  @Column({ type: 'integer', default: 384 })
  embeddingDimension!: number;

  @OneToOne(() => KnowledgeChunk, (chunk) => chunk.embedding, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'chunkId' })
  chunk!: KnowledgeChunk;

  @CreateDateColumn()
  createdAt!: Date;
}
