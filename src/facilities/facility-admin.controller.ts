import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import {
  FacilityImportMetadata,
  FacilityImportService,
} from './facility-import.service';
import { FacilitySearchService } from './facility-search.service';
import { IphsLevel, ReferralLevel } from './iphs-classification';

@Controller('admin/facilities')
@UseGuards(AuthGuard)
export class FacilityAdminController {
  constructor(
    private readonly importer: FacilityImportService,
    private readonly search: FacilitySearchService,
  ) {}
  @Post('import/structured')
  importStructured(@Body() input: any, @Req() req: any) {
    return this.importer.importStructuredRows(req.user.tenantId, input);
  }
  @Post('import/documents/:documentId')
  importDocument(
    @Param('documentId') documentId: string,
    @Body() meta: FacilityImportMetadata,
    @Req() req: any,
  ) {
    return this.importer.importKnowledgeDocument(
      req.user.tenantId,
      documentId,
      meta,
    );
  }
  @Post('import/documents/:documentId/file')
  @UseInterceptors(FileInterceptor('file'))
  importSourceFile(
    @Param('documentId') documentId: string,
    @Body() meta: FacilityImportMetadata,
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    if (!file?.buffer) throw new BadRequestException('file is required.');
    return this.importer.importUploadedSource(
      req.user.tenantId,
      documentId,
      {
        buffer: file.buffer,
        filename: file.originalname,
        mimeType: file.mimetype,
      },
      meta,
    );
  }
  @Get()
  list(@Query() query: Record<string, string>, @Req() req: any) {
    return this.search.search(req.user.tenantId, {
      state: query.state,
      district: query.district,
      locality: query.locality,
      hospitalType: query.hospitalType,
      query: query.query,
      pmjay: query.pmjay === undefined ? undefined : query.pmjay === 'true',
      scheme: query.scheme,
      speciality: query.speciality,
      facilityId: query.facilityId,
      iphsLevel: query.iphsLevel as IphsLevel | undefined,
      referralLevel: query.referralLevel as ReferralLevel | undefined,
      emergency: query.emergency === 'true',
      originLatitude: query.latitude ? Number(query.latitude) : undefined,
      originLongitude: query.longitude ? Number(query.longitude) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }
}
