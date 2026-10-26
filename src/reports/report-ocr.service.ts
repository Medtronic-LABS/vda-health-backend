import { Injectable } from '@nestjs/common';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { PDFParse } from 'pdf-parse';
import sharp = require('sharp');
import { createWorker, PSM } from 'tesseract.js';

export type OcrLine = {
  text: string;
  page: number;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  rotationDegrees?: number;
};
export type OcrReadResult = { lines: OcrLine[]; hasUncertainRows: boolean };

/** OCR is local to the backend. No report bytes or text are sent to an OCR cloud. */
@Injectable()
export class ReportOcrService {
  private readonly maxPages = 5;
  private readonly minLineConfidence = 85;
  private activeReads = 0;
  private readonly maxConcurrentReads = 1;
  private readonly maxRescueAttempts = 8;

  private normalized(text: string): string { return text.trim().replace(/\s+/g, ' '); }

  private suspectedReading(line: { text: string }): boolean {
    return /\b(?:glucose|sugar|hba1c|hb\s*a1c)\b/i.test(line.text) && /\d/.test(line.text);
  }

  private strongLine(line: { confidence: number; words: Array<{ text: string; confidence: number }> }): boolean {
    return line.confidence >= this.minLineConfidence
      && line.words.filter((word) => /^\d/.test(word.text)).every((word) => word.confidence >= 85);
  }

  private async rescueLine(worker: Awaited<ReturnType<typeof createWorker>>, image: Buffer,
    line: { text: string; bbox: OcrLine['bbox'] }, page: number, angle: number, deadline: number): Promise<OcrLine | null> {
    const metadata = await sharp(image).metadata();
    if (!metadata.width || !metadata.height) return null;
    const left = Math.max(0, Math.floor(line.bbox.x0 - 15));
    const top = Math.max(0, Math.floor(line.bbox.y0 - 10));
    const width = Math.min(metadata.width - left, Math.ceil(line.bbox.x1 - left + 15));
    const height = Math.min(metadata.height - top, Math.ceil(line.bbox.y1 - top + 10));
    if (width <= 0 || height <= 0 || width * height > 2_000_000) return null;
    const crop = await this.bounded(sharp(image).extract({ left, top, width, height })
      .resize({ width: width * 2 }).sharpen().png().toBuffer(), deadline);
    try {
      await this.bounded(worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE }), deadline);
      const result = await this.bounded(worker.recognize(crop, {}, { text: true, blocks: true }), deadline);
      const recognized = (result.data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines))[0];
      if (!recognized || this.normalized(recognized.text) !== this.normalized(line.text)
        || !this.strongLine(recognized)
        || recognized.words.some((word) => /[\p{L}\d]/u.test(word.text) && word.confidence < 85)) return null;
      return { text: this.normalized(recognized.text), page, confidence: Math.round(recognized.confidence),
        bbox: line.bbox, rotationDegrees: angle };
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    }
  }

  private async bounded<T>(operation: Promise<T>, deadline: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([operation, new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('REPORT_OCR_TIMEOUT')),
          Math.max(1, Math.min(30_000, deadline - Date.now())));
      })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async assertPdfPageLimit(buffer: Buffer): Promise<void> {
    const parser = new PDFParse({ data: buffer, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
    try {
      const info = await this.bounded(parser.getInfo({ first: 1 }), Date.now() + 30_000);
      if (info.total > this.maxPages) throw new Error('REPORT_PDF_PAGE_LIMIT');
    } finally {
      await parser.destroy();
    }
  }

  /** Read only a real PDF text layer; never infer report evidence from raw PDF bytes. */
  async readPdfTextLayer(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
    const deadline = Date.now() + 30_000;
    try {
      const info = await this.bounded(parser.getInfo({ first: 1 }), deadline);
      if (info.total > this.maxPages) throw new Error('REPORT_PDF_PAGE_LIMIT');
      const result = await this.bounded(parser.getText(), deadline);
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private languagePath(): string {
    const target = join(tmpdir(), 'vda-report-ocr-models-v1');
    mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const lang of ['eng', 'hin']) {
      const source = join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)),
        '4.0.0_best_int', `${lang}.traineddata.gz`);
      const dest = join(target, `${lang}.traineddata.gz`);
      if (!existsSync(dest)) copyFileSync(source, dest);
    }
    return target;
  }

  private async *images(buffer: Buffer, mimeType: string, deadline: number): AsyncGenerator<{ page: number; data: Buffer }> {
    if (mimeType !== 'application/pdf') {
      yield { page: 1, data: await this.bounded(sharp(buffer, { limitInputPixels: 25_000_000 })
        .rotate().png().toBuffer(), deadline) };
      return;
    }
    const parser = new PDFParse({ data: buffer, canvasMaxAreaInBytes: 64 * 1024 * 1024 });
    try {
      const info = await this.bounded(parser.getInfo({ first: 1 }), deadline);
      if (info.total > this.maxPages) throw new Error('REPORT_PDF_PAGE_LIMIT');
      for (let pageNumber = 1; pageNumber <= info.total; pageNumber++) {
        const rendered = await this.bounded(parser.getScreenshot({ partial: [pageNumber], desiredWidth: 2200,
          imageBuffer: true, imageDataUrl: false }), deadline);
        const page = rendered.pages[0];
        if (page?.data) yield { page: page.pageNumber, data: Buffer.from(page.data) };
      }
    } finally {
      await parser.destroy();
    }
  }

  async read(buffer: Buffer, mimeType: string): Promise<OcrReadResult> {
    if (this.activeReads >= this.maxConcurrentReads) throw new Error('REPORT_OCR_BUSY');
    this.activeReads++;
    const deadline = Date.now() + 120_000;
    let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      worker = await this.bounded(createWorker(['eng', 'hin'], 1, {
        langPath: this.languagePath(), gzip: true, cacheMethod: 'none',
      }), deadline);
      await worker.setParameters({ user_defined_dpi: '300', tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const accepted: OcrLine[] = [];
      let hasUncertainRows = false;
      let rescueAttempts = this.maxRescueAttempts;
      for await (const page of this.images(buffer, mimeType, deadline)) {
        const candidates: Array<{ score: number; lines: OcrLine[]; uncertain: boolean }> = [];
        for (const angle of [0, 90, 180, 270]) {
          if (angle && candidates[0]?.score >= 180) break;
          const image = angle ? await this.bounded(sharp(page.data).rotate(angle).png().toBuffer(), deadline) : page.data;
          const result = await this.bounded(worker.recognize(image, {}, { text: true, blocks: true }), deadline);
          const rawLines = (result.data.blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
          const strong: OcrLine[] = rawLines.filter((line) => this.strongLine(line)).map((line) => ({
            text: this.normalized(line.text), page: page.page, confidence: Math.round(line.confidence), bbox: line.bbox,
            rotationDegrees: angle,
          }));
          const weakReadings = rawLines.filter((line) => this.suspectedReading(line) && !this.strongLine(line));
          for (const weak of weakReadings) {
            if (rescueAttempts <= 0) break;
            rescueAttempts--;
            const rescued = await this.rescueLine(worker, image, weak, page.page, angle, deadline);
            if (rescued && !strong.some((line) => this.normalized(line.text) === rescued.text)) strong.push(rescued);
          }
          const uncertain = weakReadings.some((line) => !strong.some((acceptedLine) =>
            acceptedLine.text === this.normalized(line.text)));
          const measurable = strong.filter((line) => /\d/.test(line.text) && /[A-Za-z\u0900-\u097f]/u.test(line.text));
          candidates.push({ score: measurable.length * 100 + (measurable.length ? result.data.confidence : 0),
            lines: strong, uncertain });
        }
        candidates.sort((a, b) => b.score - a.score);
        accepted.push(...(candidates[0]?.lines || []));
        hasUncertainRows ||= candidates[0]?.uncertain || false;
      }
      return { lines: accepted.slice(0, 250), hasUncertainRows };
    } finally {
      try { if (worker) await worker.terminate(); }
      finally { this.activeReads--; }
    }
  }
}
