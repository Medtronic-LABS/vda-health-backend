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

  // TypeORM does not currently expose pgvector in its ColumnType union. The
  // database migration is authoritative and creates vector(384).
  @Column('vector' as any, { name: 'embedding', length: 384 })
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
