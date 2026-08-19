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
    @UploadedFile() file?: any,
  ) {
    const filePayload = file
      ? {
          filename: file.originalname || 'uploaded-document',
          buffer: file.buffer,
          mimeType: file.mimetype,
        }
      : undefined;

    return this.adminService.createDocument(dto, filePayload);
  }

  @Get('documents')
  async listDocuments(
    @Query('domain') domain?: string,
    @Query('status') status?: KnowledgeStatus,
  ) {
    return this.adminService.findAll({ domain, status });
  }

  @Get('documents/:id')
  async getDocument(@Param('id') id: string) {
    return this.adminService.findOne(id);
  }

  @Patch('documents/:id')
  async updateDocument(
    @Param('id') id: string,
    @Body() dto: Record<string, any>,
  ) {
    return this.adminService.updateDocument(id, dto);
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string) {
    await this.adminService.deleteDocument(id);
    return { status: 'DELETED', id };
  }

  @Post('documents/:id/process')
  async processDocument(@Param('id') id: string) {
    return this.adminService.processDocument(id);
  }

  @Post('documents/:id/approve')
  async approveDocument(@Param('id') id: string) {
    return this.adminService.approveDocument(id);
  }

  @Post('documents/:id/publish')
  async publishDocument(@Param('id') id: string) {
    return this.adminService.publishDocument(id);
  }

  @Post('documents/:id/supersede')
  async supersedeDocument(
    @Param('id') id: string,
    @Body('newVersionId') newVersionId?: string,
  ) {
    return this.adminService.supersedeDocument(id, newVersionId);
  }

  @Post('reindex')
  async reindexAll() {
    return this.adminService.reindexAll();
  }

  @Get('search')
  async search(
    @Query('query') query: string,
    @Query('domain') domain?: string,
    @Query('language') language?: string,
    @Query('limit') limit?: string,
  ) {
    return this.retrievalService.retrieve(query, {
      domain,
      language,
      maxResults: limit ? parseInt(limit, 10) : 5,
    });
  }
}
