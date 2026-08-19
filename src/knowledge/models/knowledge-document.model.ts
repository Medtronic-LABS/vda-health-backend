import { KnowledgeStatus } from '../../database/entities/knowledge-document.entity';

export interface KnowledgeDocumentModel {
  documentId: string;
  title: string;
  description: string | null;
  source: string;
  sourceUrl: string | null;
  version: string;
  language: string;
  domain: string;
  category: string;
  role: string | null;
  state: string | null;
  district: string | null;
  status: KnowledgeStatus;
  effectiveDate: Date | null;
  reviewDate: Date | null;
  checksum: string | null;
  metadata: Record<string, any> | null;
  createdAt: Date;
  updatedAt: Date;
}
