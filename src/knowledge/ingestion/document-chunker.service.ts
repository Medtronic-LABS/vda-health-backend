/* eslint-disable */
import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeDocument } from '../../database/entities/knowledge-document.entity';

export interface GeneratedChunkPayload {
  chunkIndex: number;
  content: string;
  language: string;
  domain: string;
  category: string;
  role: string | null;
  state: string | null;
  district: string | null;
  source: string;
  documentVersion: string;
  metadata: Record<string, any>;
}

@Injectable()
export class DocumentChunkerService {
  private readonly logger = new Logger(DocumentChunkerService.name);

  /**
   * Splits document content into sentence-aware chunks respecting max length boundary.
   */
  chunkDocument(
    document: KnowledgeDocument,
    maxChunkLength = 1200,
  ): GeneratedChunkPayload[] {
    const text = (document as any).content || document.description || '';
    if (!text.trim()) return [];

    // Split text by sentence terminators (. ! ? \n | full-stop । in Devanagari)
    const sentences = text
      .split(/(?<=[.!?।\n])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);

    const chunks: GeneratedChunkPayload[] = [];
    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).length > maxChunkLength) {
        if (currentChunk.trim().length > 0) {
          chunks.push(
            this.buildChunkPayload(document, currentChunk.trim(), chunkIndex++),
          );
          currentChunk = sentence;
        } else {
          // If a single sentence exceeds maxChunkLength, split by length
          const subChunks = this.splitByLength(sentence, maxChunkLength);
          for (const sub of subChunks) {
            chunks.push(
              this.buildChunkPayload(document, sub.trim(), chunkIndex++),
            );
          }
          currentChunk = '';
        }
      } else {
        currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(
        this.buildChunkPayload(document, currentChunk.trim(), chunkIndex++),
      );
    }

    this.logger.log(
      `Document [${document.title}] split into ${chunks.length} chunks (maxLen=${maxChunkLength})`,
    );

    return chunks;
  }

  private buildChunkPayload(
    doc: KnowledgeDocument,
    content: string,
    chunkIndex: number,
  ): GeneratedChunkPayload {
    return {
      chunkIndex,
      content,
      language: doc.language,
      domain: doc.domain,
      category: doc.category,
      role: doc.role,
      state: doc.state,
      district: doc.district,
      source: doc.source,
      documentVersion: doc.version,
      metadata: {
        documentId: doc.id,
        documentTitle: doc.title,
        chunkIndex,
      },
    };
  }

  private splitByLength(text: string, maxLength: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
      result.push(text.substring(i, i + maxLength));
    }
    return result;
  }
}
