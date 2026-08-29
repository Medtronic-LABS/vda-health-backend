import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeDocument } from '../database/entities/knowledge-document.entity';
import { Scheme } from '../database/entities/scheme.entity';
import { SchemeAdminController } from './scheme-admin.controller';
import { SchemeService } from './scheme.service';
@Module({ imports: [TypeOrmModule.forFeature([Scheme, KnowledgeDocument]), AuthModule], controllers: [SchemeAdminController], providers: [SchemeService], exports: [SchemeService] })
export class SchemeModule {}
