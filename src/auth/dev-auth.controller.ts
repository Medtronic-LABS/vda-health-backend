import { Controller, ForbiddenException, Get } from '@nestjs/common';
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
  getDevToken() {
    // Block in production regardless of DEV_AUTH_ENABLED
    if (this.config.nodeEnv === 'production') {
      throw new ForbiddenException('Not available in production.');
    }

    if (!this.config.devAuthEnabled) {
      throw new ForbiddenException('Development authentication is disabled.');
    }

    const token = this.config.devAuthToken;
    if (!token) {
      throw new ForbiddenException('No development token configured.');
    }

    return { token };
  }
}
