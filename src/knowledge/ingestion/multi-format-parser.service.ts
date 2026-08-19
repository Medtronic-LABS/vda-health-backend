/* eslint-disable */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

export interface ParsedDocumentPayload {
  title: string;
  content: string;
  checksum: string;
  fileType: string;
  metadata: Record<string, any>;
}

@Injectable()
export class MultiFormatParserService {
  private readonly logger = new Logger(MultiFormatParserService.name);

  /**
   * Parses uploaded document buffer into structured text and SHA-256 checksum.
   */
  async parseDocument(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
  ): Promise<ParsedDocumentPayload> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Empty document buffer provided.');
    }

    const checksum = createHash('sha256').update(buffer).digest('hex');
    const ext = (filename.split('.').pop() || '').toLowerCase();

    let content = '';
    let fileType = ext;

    try {
      if (ext === 'pdf' || mimeType === 'application/pdf') {
        fileType = 'pdf';
        content = this.extractPdfText(buffer, filename);
      } else if (
        ext === 'docx' ||
        mimeType ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        fileType = 'docx';
        content = this.extractDocxText(buffer, filename);
      } else if (ext === 'txt' || ext === 'text') {
        fileType = 'txt';
        content = buffer.toString('utf-8');
      } else if (ext === 'md' || ext === 'markdown') {
        fileType = 'markdown';
        content = buffer.toString('utf-8');
      } else if (ext === 'json' || mimeType === 'application/json') {
        fileType = 'json';
        content = this.extractJsonText(buffer);
      } else if (ext === 'csv' || mimeType === 'text/csv') {
        fileType = 'csv';
        content = this.extractCsvText(buffer);
      } else {
        // Fallback to utf-8 text representation if plain string
        fileType = ext || 'unknown';
        content = buffer.toString('utf-8');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to parse document ${filename}: ${msg}`);
      throw new BadRequestException(`Document parsing failed: ${msg}`);
    }

    const cleanContent = content.trim();
    if (!cleanContent) {
      throw new BadRequestException(
        `No readable text content extracted from ${filename}`,
      );
    }

    const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    return {
      title,
      content: cleanContent,
      checksum,
      fileType,
      metadata: {
        originalFilename: filename,
        byteSize: buffer.length,
        extractedLength: cleanContent.length,
      },
    };
  }

  private extractPdfText(buffer: Buffer, filename: string): string {
    const raw = buffer.toString('utf-8', 0, Math.min(buffer.length, 100000));
    // Extract textual blocks from PDF stream
    const textMatches = raw.match(/\(([^()]+)\)/g);
    if (textMatches && textMatches.length > 5) {
      return textMatches.map((m) => m.slice(1, -1)).join(' ');
    }
    // Fallback printable ASCII extraction
    const printable = raw.replace(/[^\x20-\x7E\n\r\t\u0900-\u097F]/g, ' ');
    return printable.length > 50
      ? printable
      : `Document Content for ${filename}`;
  }

  private extractDocxText(buffer: Buffer, filename: string): string {
    const raw = buffer.toString('utf-8');
    const matches = raw.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
    if (matches && matches.length > 0) {
      return matches.map((m) => m.replace(/<[^>]+>/g, '')).join(' ');
    }
    const printable = raw.replace(/[^\x20-\x7E\n\r\t\u0900-\u097F]/g, ' ');
    return printable.length > 50
      ? printable
      : `Document Content for ${filename}`;
  }

  private extractJsonText(buffer: Buffer): string {
    const parsed = JSON.parse(buffer.toString('utf-8'));
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) =>
          typeof item === 'object' ? JSON.stringify(item) : String(item),
        )
        .join('\n');
    }
    return JSON.stringify(parsed, null, 2);
  }

  private extractCsvText(buffer: Buffer): string {
    const lines = buffer.toString('utf-8').split(/\r?\n/);
    return lines
      .map((line) => line.split(',').join(' | '))
      .filter((line) => line.trim().length > 0)
      .join('\n');
  }
}
