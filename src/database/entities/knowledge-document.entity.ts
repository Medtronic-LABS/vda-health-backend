import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { KnowledgeChunk } from './knowledge-chunk.entity';

export type KnowledgeStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'SUPERSEDED'
  | 'FAILED';

@Entity('knowledge_documents')
export class KnowledgeDocument {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 255 })
  source!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  sourceUrl!: string | null;

  @Column({ type: 'varchar', length: 50, default: '1.0' })
  version!: string;

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

  @Column({
    type: 'varchar',
    length: 50,
    default: 'UPLOADED',
  })
  status!: KnowledgeStatus;

  @Column({ type: 'timestamp', nullable: true })
  effectiveDate!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewDate!: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @OneToMany(() => KnowledgeChunk, (chunk) => chunk.document, {
    cascade: true,
  })
  chunks!: KnowledgeChunk[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
