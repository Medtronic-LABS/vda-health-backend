import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigurationService } from '../configuration/configuration.service';

/**
 * Development-only endpoint that provides the configured dev auth token
 * to the frontend so the admin UI can auto-authenticate without manual
 * token entry. NEVER available in production.
 */
@Controller('dev/auth')
export class DevAuthController {
  constructor(private readonly config: ConfigurationService) {}

  @Get('token')
  getDevToken(@Req() request: Request) {
    if (
      this.config.nodeEnv !== 'development' ||
      !this.config.devAuthEnabled ||
      !this.isLocalRequest(request)
    ) {
      throw new ForbiddenException('Development authentication is disabled.');
    }

    const token = this.config.devAuthToken;
    if (!token) {
      throw new ForbiddenException('No development token configured.');
    }

    return { token };
  }

  private isLocalRequest(request: Request): boolean {
    const remoteAddress = request.socket.remoteAddress || '';
    const isLoopbackAddress =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1';
    const host = (request.hostname || '').toLowerCase();
    const isLoopbackHost =
      host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLoopbackAddress && isLoopbackHost;
  }
}
