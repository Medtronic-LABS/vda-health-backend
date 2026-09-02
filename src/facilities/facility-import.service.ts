import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Facility } from '../database/entities/facility.entity';
import { FacilityIphsOverlay } from '../database/entities/facility-iphs-overlay.entity';
import { FacilityScheme } from '../database/entities/facility-scheme.entity';
import { KnowledgeChunk } from '../database/entities/knowledge-chunk.entity';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { MultiFormatParserService } from '../knowledge/ingestion/multi-format-parser.service';
import {
  classifyIphsFacility,
  IPHS_SOURCE,
  supportsIphsOverlay,
} from './iphs-classification';

export type FacilityImportMetadata = {
  state: string;
  sourceVersion?: string;
  sourceUrl?: string;
};
type FacilityRow = {
  facilityId: string;
  name: string;
  district?: string;
  contactNumber?: string;
  hospitalType?: string;
  empanelmentType?: string;
  pmjayStatus?: boolean;
};
export type StructuredFacilityRow = {
  hospitalCode: string;
  hospitalName: string;
  district: string;
  hospitalType?: string;
  specialityCodes?: string[];
};
export type StructuredFacilityImport = {
  state: string;
  scheme: string;
  source: string;
  sourceUrl?: string;
  sourceVersion?: string;
  sourceUpdatedAt?: string;
  rows: StructuredFacilityRow[];
};

@Injectable()
export class FacilityImportService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilities: Repository<Facility>,
    @InjectRepository(FacilityIphsOverlay)
    private readonly iphsOverlays: Repository<FacilityIphsOverlay>,
    @InjectRepository(FacilityScheme)
    private readonly facilitySchemes: Repository<FacilityScheme>,
    @InjectRepository(KnowledgeDocument)
    private readonly documents: Repository<KnowledgeDocument>,
    @InjectRepository(KnowledgeChunk)
    private readonly chunks: Repository<KnowledgeChunk>,
    private readonly parser: MultiFormatParserService,
  ) {}

  /** Reusable idempotent import for explicit structured government facility feeds. */
  async importStructuredRows(
    tenantId: string,
    input: StructuredFacilityImport,
  ) {
    if (!input.state?.trim() || !input.scheme?.trim() || !input.source?.trim())
      throw new BadRequestException('state, scheme and source are required.');
    let inserted = 0;
    let updated = 0;
    let associationsCreated = 0;
    let skipped = 0;
    const seen = new Set<string>();
    for (const raw of input.rows || []) {
      const hospitalCode = raw.hospitalCode?.trim();
      const hospitalName = raw.hospitalName?.replace(/\s+/g, ' ').trim();
      const district = raw.district?.replace(/\s+/g, ' ').trim();
      // Official feeds in scope use HOSP... or HS... codes. Reject headers and
      // malformed rows before any persistence; never create a facility from a
      // table label such as "Hospital code".
      if (
        !hospitalCode ||
        !/^(?:HOSP\d|HS\d)/.test(hospitalCode) ||
        !hospitalName ||
        !district
      ) {
        skipped++;
        continue;
      }
      if (seen.has(hospitalCode)) {
        skipped++;
        continue;
      }
      seen.add(hospitalCode);
      let facility = await this.facilities.findOne({
        where: { tenantId, facilityId: hospitalCode },
      });
      if (
        facility &&
        ((facility.state && facility.state !== input.state.trim()) ||
          facility.name !== hospitalName)
      ) {
        throw new BadRequestException(`FACILITY_CODE_CONFLICT:${hospitalCode}`);
      }
      const isNew = !facility;
      facility =
        facility ||
        this.facilities.create({
          tenantId,
          facilityId: hospitalCode,
          name: hospitalName,
        });
      Object.assign(facility, {
        name: hospitalName,
        state: input.state.trim(),
        district,
        hospitalType: raw.hospitalType?.trim() || null,
        specialityCodes: [
          ...new Set(
            (raw.specialityCodes || []).map((x) => x.trim()).filter(Boolean),
          ),
        ],
        sourceDocumentId: null,
        sourceVersion: input.sourceVersion || null,
        sourceUrl: input.sourceUrl || null,
        sourceUpdatedAt: input.sourceUpdatedAt
          ? new Date(input.sourceUpdatedAt)
          : null,
        active: true,
      });
      facility = await this.facilities.save(facility);
      await this.upsertIphsOverlay(facility);
      isNew ? inserted++ : updated++;
      const existing = await this.facilitySchemes.findOne({
        where: {
          tenantId,
          facilityId: facility.id,
          scheme: input.scheme.trim(),
        },
      });
      if (!existing) {
        await this.facilitySchemes.save(
          this.facilitySchemes.create({
            tenantId,
            facilityId: facility.id,
            scheme: input.scheme.trim(),
            status: 'SOURCE_LISTED',
            source: input.source.trim(),
            sourceUrl: input.sourceUrl || null,
            active: true,
          }),
        );
        associationsCreated++;
      }
    }
    return {
      inserted,
      updated,
      associationsCreated,
      skipped,
      uniqueSourceCodes: seen.size,
    };
  }

  /** Imports only explicit source fields; caller supplies source geography rather than it being inferred. */
  async importKnowledgeDocument(
    tenantId: string,
    documentId: string,
    meta: FacilityImportMetadata,
  ) {
    if (!meta.state?.trim())
      throw new BadRequestException(
        'state is required; it must be supplied from the authoritative source.',
      );
    const document = await this.documents.findOne({
      where: { id: documentId, tenantId },
    });
    if (!document)
      throw new NotFoundException('FACILITY_SOURCE_DOCUMENT_NOT_FOUND');
    if (document.status !== 'ACTIVE')
      throw new BadRequestException('FACILITY_SOURCE_DOCUMENT_MUST_BE_ACTIVE');
    const chunks = await this.chunks.find({
      where: { documentId, tenantId },
      order: { chunkIndex: 'ASC' },
    });
    const rows = this.extractTableRows(
      chunks.map((chunk) => chunk.content).join('\n'),
    );
    if (!rows.length)
      throw new BadRequestException(
        'No unambiguous facility rows found. Upload a structured CSV or JSON dataset instead.',
      );
    for (const row of rows) {
      const existing = await this.facilities.findOne({
        where: { tenantId, facilityId: row.facilityId },
      });
      const facility =
        existing ||
        this.facilities.create({
          tenantId,
          facilityId: row.facilityId,
          name: row.name,
          sourceDocumentId: documentId,
        });
      Object.assign(facility, {
        ...row,
        state: meta.state.trim(),
        sourceDocumentId: documentId,
        sourceVersion: meta.sourceVersion || null,
        sourceUrl: meta.sourceUrl || null,
        active: true,
      });
      const savedFacility = await this.facilities.save(facility);
      await this.upsertIphsOverlay(savedFacility);
    }
    return {
      sourceDocumentId: documentId,
      imported: rows.length,
      state: meta.state.trim(),
    };
  }

  /**
   * Uses the same parser as knowledge ingestion, then binds the parsed source
   * to its already-governed document by checksum. This prevents table chunk
   * boundaries from changing structured facility facts.
   */
  async importUploadedSource(
    tenantId: string,
    documentId: string,
    file: { buffer: Buffer; filename: string; mimeType?: string },
    meta: FacilityImportMetadata,
  ) {
    const document = await this.documents.findOne({
      where: { id: documentId, tenantId },
    });
    if (!document)
      throw new NotFoundException('FACILITY_SOURCE_DOCUMENT_NOT_FOUND');
    if (document.status !== 'ACTIVE')
      throw new BadRequestException('FACILITY_SOURCE_DOCUMENT_MUST_BE_ACTIVE');
    const parsed = await this.parser.parseDocument(
      file.buffer,
      file.filename,
      file.mimeType,
    );
    if (document.checksum && document.checksum !== parsed.checksum)
      throw new BadRequestException('FACILITY_SOURCE_CHECKSUM_MISMATCH');
    return this.saveRows(
      tenantId,
      documentId,
      this.extractTableRows(parsed.content),
      meta,
    );
  }

  private async saveRows(
    tenantId: string,
    documentId: string,
    rows: FacilityRow[],
    meta: FacilityImportMetadata,
  ) {
    if (!meta.state?.trim())
      throw new BadRequestException(
        'state is required; it must be supplied from the authoritative source.',
      );
    if (!rows.length)
      throw new BadRequestException(
        'No unambiguous facility rows found. Upload a structured CSV or JSON dataset instead.',
      );
    for (const row of rows) {
      const existing = await this.facilities.findOne({
        where: { tenantId, facilityId: row.facilityId },
      });
      const facility =
        existing ||
        this.facilities.create({
          tenantId,
          facilityId: row.facilityId,
          name: row.name,
          sourceDocumentId: documentId,
        });
      Object.assign(facility, {
        ...row,
        state: meta.state.trim(),
        sourceDocumentId: documentId,
        sourceVersion: meta.sourceVersion || null,
        sourceUrl: meta.sourceUrl || null,
        active: true,
      });
      const savedFacility = await this.facilities.save(facility);
      await this.upsertIphsOverlay(savedFacility);
    }
    return {
      sourceDocumentId: documentId,
      imported: rows.length,
      state: meta.state.trim(),
    };
  }

  private extractTableRows(text: string): FacilityRow[] {
    if (!/hospital\s+id/i.test(text) || !/hospital\s+name/i.test(text))
      return [];
    const entries = text.split(/(?=HOSP\d)/g).slice(1);
    const candidates = entries
      .map((entry) => this.extractExplicitRow(entry))
      .filter((row): row is FacilityRow => Boolean(row));
    const districts = [
      ...new Set(
        candidates
          .map((row) => row.district)
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((a, b) => b.length - a.length);
    return entries.flatMap((entry) => {
      const id = entry.match(/^(HOSP\d[A-Z0-9]+)/)?.[1];
      const phone = entry.match(/\b(\d{10})\b/);
      if (!id || !phone?.index) return [];
      const tail = entry
        .slice(phone.index + phone[0].length)
        .replace(/\s+/g, ' ')
        .trim();
      const type = tail.match(/^(GOI|Public|Private\s*\([^)]*\))(.*)$/i);
      const beforePhone = entry.slice(id.length, phone.index).trim();
      const columns = beforePhone
        .split(/\t+|\s{2,}/)
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const normalizedBeforePhone = beforePhone.replace(/\s+/g, ' ').trim();
      const recoveredDistrict =
        columns.length < 2
          ? districts.find((district) =>
              normalizedBeforePhone
                .toLowerCase()
                .endsWith(district.toLowerCase()),
            )
          : undefined;
      if (!type || (columns.length < 2 && !recoveredDistrict)) return [];
      const name =
        columns.length >= 2
          ? columns[0]!
          : normalizedBeforePhone.slice(0, -recoveredDistrict!.length).trim();
      const district =
        columns.length >= 2 ? columns.slice(1).join(' ') : recoveredDistrict!;
      const empanelmentType = type[2].trim() || undefined;
      return [
        {
          facilityId: id,
          name,
          district,
          contactNumber: phone[1]!,
          hospitalType: type[1]!.replace(/\s+/g, ' '),
          empanelmentType,
          pmjayStatus: /pm\s*-?\s*jay/i.test(empanelmentType || ''),
        },
      ];
    });
  }

  private async upsertIphsOverlay(facility: Facility): Promise<void> {
    if (!supportsIphsOverlay(facility.state)) return;
    const state = facility.state!.trim().toUpperCase().replace(/\s+/g, '_');
    const classification = classifyIphsFacility(facility);
    const existing = await this.iphsOverlays.findOne({
      where: { tenantId: facility.tenantId, facilityId: facility.id, state },
    });
    const overlay = existing
      ? existing
      : this.iphsOverlays.create({
          tenantId: facility.tenantId,
          facilityId: facility.id,
          state,
          iphsServices: { status: 'NOT_VERIFIED', services: [] },
          iphsVerified: false,
        });
    Object.assign(overlay, {
      ...classification,
      iphsSource: IPHS_SOURCE,
      active: true,
    });
    await this.iphsOverlays.save(overlay);
  }

  private extractExplicitRow(entry: string): FacilityRow | null {
    const id = entry.match(/^(HOSP\d[A-Z0-9]+)/)?.[1];
    const phone = entry.match(/\b(\d{10})\b/);
    if (!id || !phone?.index) return null;
    const columns = entry
      .slice(id.length, phone.index)
      .trim()
      .split(/\t+|\s{2,}/)
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return columns.length >= 2
      ? {
          facilityId: id,
          name: columns[0]!,
          district: columns.slice(1).join(' '),
        }
      : null;
  }
}
