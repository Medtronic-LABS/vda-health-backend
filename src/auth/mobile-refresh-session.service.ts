import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { MobileRefreshSession } from '../database/entities/mobile-refresh-session.entity';
import { MobileUser } from '../database/entities/mobile-user.entity';

@Injectable()
export class MobileRefreshSessionService {
  private readonly lifetimeMs = 30 * 24 * 60 * 60 * 1000;
  constructor(
    @InjectRepository(MobileRefreshSession) private readonly sessions: Repository<MobileRefreshSession>,
    private readonly dataSource: DataSource,
  ) {}

  private digest(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private generate(): string { return randomBytes(32).toString('base64url'); }

  async issue(user: MobileUser): Promise<{ sessionId: string; refreshToken: string; refreshExpiresAt: string }> {
    const refreshToken = this.generate();
    const expiresAt = new Date(Date.now() + this.lifetimeMs);
    const session = await this.sessions.save(this.sessions.create({
      tenantId: user.tenantId, userId: user.id, familyId: randomUUID(),
      tokenHash: this.digest(refreshToken), expiresAt, revokedAt: null, replacedById: null,
    }));
    return { sessionId: session.id, refreshToken, refreshExpiresAt: expiresAt.toISOString() };
  }

  async rotate(rawToken: string, nextToken: string): Promise<{ user: MobileUser; sessionId: string; refreshToken: string; refreshExpiresAt: string }> {
    const tokenHash = this.digest(rawToken);
    const nextHash = this.digest(nextToken);
    if (tokenHash === nextHash) throw new UnauthorizedException('Refresh session is invalid.');
    const result = await this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(MobileRefreshSession).createQueryBuilder('session')
        .setLock('pessimistic_write').where('session.tokenHash = :tokenHash', { tokenHash }).getOne();
      if (!session) throw new UnauthorizedException('Refresh session is invalid.');
      if (session.replacedById) {
        const replacement = await manager.getRepository(MobileRefreshSession).findOne({ where: { id: session.replacedById } });
        if (replacement && replacement.tokenHash === nextHash && !replacement.revokedAt && replacement.expiresAt.getTime() > Date.now()) {
          const user = await manager.getRepository(MobileUser).findOne({ where: { id: session.userId, tenantId: session.tenantId, isActive: true } });
          if (!user) throw new UnauthorizedException('Mobile user is inactive or unavailable.');
          return { user, sessionId: replacement.id, refreshToken: nextToken, refreshExpiresAt: replacement.expiresAt.toISOString() };
        }
        await manager.getRepository(MobileRefreshSession).createQueryBuilder().update()
          .set({ revokedAt: new Date() }).where('familyId = :familyId AND revokedAt IS NULL', { familyId: session.familyId }).execute();
        return null;
      }
      if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Refresh session is expired or revoked.');
      const user = await manager.getRepository(MobileUser).findOne({ where: { id: session.userId, tenantId: session.tenantId, isActive: true } });
      if (!user) throw new UnauthorizedException('Mobile user is inactive or unavailable.');
      const refreshToken = nextToken;
      const next = await manager.getRepository(MobileRefreshSession).save(manager.getRepository(MobileRefreshSession).create({
        tenantId: user.tenantId, userId: user.id, familyId: session.familyId,
        tokenHash: this.digest(refreshToken), expiresAt: session.expiresAt, revokedAt: null, replacedById: null,
      }));
      session.revokedAt = new Date();
      session.replacedById = next.id;
      await manager.getRepository(MobileRefreshSession).save(session);
      return { user, sessionId: next.id, refreshToken, refreshExpiresAt: session.expiresAt.toISOString() };
    });
    if (!result) throw new UnauthorizedException('Refresh session has been reused.');
    return result;
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = this.digest(rawToken);
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(MobileRefreshSession).findOne({ where: { tokenHash } });
      if (!session) return;
      await manager.getRepository(MobileRefreshSession).createQueryBuilder().update()
        .set({ revokedAt: new Date() }).where('familyId = :familyId AND revokedAt IS NULL', { familyId: session.familyId }).execute();
    });
  }
}
