import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigurationService } from '../configuration/configuration.service';
import { MobileUser } from '../database/entities/mobile-user.entity';
import { HostIdentity } from './host-identity.context';

interface MobileTokenPayload { sub: string; typ: 'mobile'; tenant: string }

@Injectable()
export class MobileAuthTokenService {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigurationService, @InjectRepository(MobileUser) private readonly users: Repository<MobileUser>) {}
  issue(user: MobileUser) {
    const expiresInSeconds = this.config.mobileAuthTokenTtlSeconds;
    return {
      token: this.jwt.sign({ sub: user.id, typ: 'mobile', tenant: user.tenantId }, { expiresIn: expiresInSeconds }),
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      expiresInSeconds,
    };
  }
  isJwtShape(token: string): boolean { return token.split('.').length === 3; }
  async validate(token: string): Promise<HostIdentity> {
    let payload: MobileTokenPayload;
    try { payload = await this.jwt.verifyAsync<MobileTokenPayload>(token); }
    catch { throw new UnauthorizedException('Access token is invalid or expired.'); }
    if (payload.typ !== 'mobile' || !payload.sub || !payload.tenant) throw new UnauthorizedException('Invalid access token.');
    const user = await this.users.findOne({ where: { id: payload.sub, tenantId: payload.tenant, isActive: true } });
    if (!user) throw new UnauthorizedException('Mobile user is inactive or unavailable.');
    return {
      partnerId: 'vda-android-pilot', tenantId: user.tenantId,
      externalId: `mobile-user:${user.id}`, subjectAbhaRef: `mobile-user:${user.id}`,
      scopes: ['record_read', 'conversation_retention'],
      authType: 'MOBILE', mobileUserId: user.id, preferredLanguage: user.preferredLanguage,
    };
  }
}
