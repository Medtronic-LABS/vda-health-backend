import { Body, Controller, ForbiddenException, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigurationService } from '../configuration/configuration.service';

const ADMIN_ACCOUNTS = [
  {
    identifiers: ['admin', 'admin@vdahealth.org'],
    password: process.env.VDA_ADMIN_PASSWORD || 'Admin@Vda2026',
    role: 'ADMIN' as const,
    roleLabel: 'System Administrator',
    displayName: 'VDA System Administrator',
    email: 'admin@vdahealth.org',
    tokenSuffix: 'admin',
  },
  {
    identifiers: ['doctor', 'medical', 'doctor@vdahealth.org'],
    password: process.env.VDA_DOCTOR_PASSWORD || 'Doctor@Vda2026',
    role: 'MEDICAL_OFFICER' as const,
    roleLabel: 'Medical Officer (Prescription Reviewer)',
    displayName: 'Dr. Ananya Sharma (CHO / Medical Officer)',
    email: 'doctor@vdahealth.org',
    tokenSuffix: 'medical-officer',
  },
];

/**
 * Development-only endpoint that provides the configured dev auth token
 * to the frontend so the admin UI can auto-authenticate without manual
 * token entry. NEVER available in production.
 */
@Controller('dev/auth')
export class DevAuthController {
  constructor(private readonly config: ConfigurationService) {}

  @Post('admin-login')
  adminLogin(@Body() body: { identifier?: string; password?: string }) {
    if (!this.config.devAuthEnabled) {
      throw new ForbiddenException('Admin authentication is disabled.');
    }
    const normalizedId = String(body?.identifier || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const matched = ADMIN_ACCOUNTS.find(
      (account) => account.identifiers.includes(normalizedId) && account.password === password,
    );
    if (!matched) {
      throw new UnauthorizedException('Invalid User ID or Password.');
    }
    const baseToken = this.config.devAuthToken || 'dev-token';
    return {
      token: `${baseToken}:${matched.tokenSuffix}`,
      user: {
        id: matched.email,
        role: matched.role,
        roleLabel: matched.roleLabel,
        displayName: matched.displayName,
        email: matched.email,
      },
    };
  }

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
