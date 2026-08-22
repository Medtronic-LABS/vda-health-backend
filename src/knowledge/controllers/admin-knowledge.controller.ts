/* eslint-disable */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../auth/auth.guard';
import { KnowledgeAdminService } from '../services/knowledge-admin.service';
import { KnowledgeRetrievalService } from '../services/knowledge-retrieval.service';
import { KnowledgeStatus } from '../../database/entities/knowledge-document.entity';

@Controller('admin/knowledge')
@UseGuards(AuthGuard)
export class AdminKnowledgeController {
  constructor(
    private readonly adminService: KnowledgeAdminService,
    private readonly retrievalService: KnowledgeRetrievalService,
  ) {}

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  async createDocument(
    @Body() dto: Record<string, any>,
    @UploadedFile() file?: any, @Req() request?: any,
  ) {
    const filePayload = file
      ? {
          filename: file.originalname || 'uploaded-document',
          buffer: file.buffer,
          mimeType: file.mimetype,
        }
      : undefined;

    return this.adminService.createDocument(dto, filePayload, request.user.tenantId, request.user.externalId);
  }

  @Get('documents')
  async listDocuments(
    @Query('domain') domain?: string,
    @Query('status') status?: KnowledgeStatus, @Req() request?: any,
  ) {
    return this.adminService.findAll({ domain, status, tenantId: request.user.tenantId });
  }

  @Get('documents/:id')
  async getDocument(@Param('id') id: string, @Req() request?: any) {
    return this.adminService.findOne(id, request.user.tenantId);
  }

  @Patch('documents/:id')
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: Record<string, any>, @Req() request?: any,
  ) {
    return this.adminService.updateDocument(id, request.user.tenantId, dto);
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string, @Req() request?: any) {
    await this.adminService.deleteDocument(id, request.user.tenantId);
    return { status: 'DELETED', id };
  }

  @Post('documents/:id/process')
  async processDocument(@Param('id') id: string, @Req() request?: any) {
    return this.adminService.processDocument(id, undefined, request.user.tenantId, request.user.externalId);
  }

  @Post('documents/:id/approve')
  async approveDocument(@Param('id') id: string, @Req() request?: any) {
    return this.adminService.approveDocument(id, request.user.tenantId, request.user.externalId);
  }

  @Post('documents/:id/publish')
  async publishDocument(@Param('id') id: string, @Req() request?: any) {
    return this.adminService.publishDocument(id, request.user.tenantId, request.user.externalId);
  }

  @Post('documents/:id/supersede')
  async supersedeDocument(
    @Param('id') id: string,
    @Body('newVersionId') newVersionId?: string, @Req() request?: any,
  ) {
    return this.adminService.supersedeDocument(id, request.user.tenantId, newVersionId, request.user.externalId);
  }

  @Post('reindex')
  async reindexAll(@Req() request?: any) {
    return this.adminService.reindexAll(request.user.tenantId, request.user.externalId);
  }

  @Get('search')
  async search(
    @Query('query') query: string,
    @Query('domain') domain?: string,
    @Query('language') language?: string,
    @Query('limit') limit?: string, @Req() request?: any,
  ) {
    return this.retrievalService.retrieve(query, {
      domain,
      language,
      maxResults: limit ? parseInt(limit, 10) : 5,
      tenantId: request.user.tenantId,
    });
  }
}
