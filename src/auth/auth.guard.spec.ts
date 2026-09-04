/**
 * VDA Backend — Auth Guard Unit Tests (P0 Critical)
 *
 * Tests the AuthGuard for JWT validation, missing/malformed tokens,
 * tenant context isolation, and edge cases.
 */
import { AuthGuard } from './auth.guard';
import { HostIdentityContext, HostIdentity } from './host-identity.context';
import { TenantContext } from '../tenants/tenant.context';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockHostIdentityContext: jest.Mocked<HostIdentityContext>;
  let mockTenantContext: jest.Mocked<TenantContext>;
  let mockExecutionContext: jest.Mocked<ExecutionContext>;

  const validIdentity: HostIdentity = {
    partnerId: 'partner-001',
    tenantId: 'tenant-001',
    externalId: 'user-ext-001',
    subjectAbhaRef: 'abha-ref-001',
    scopes: ['read', 'write'],
  };

  function createMockContext(headers: Record<string, string | undefined>): jest.Mocked<ExecutionContext> {
    const mockRequest: Record<string, unknown> = { headers };
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
      getArgs: jest.fn(),
      getArgByIndex: jest.fn(),
      switchToRpc: jest.fn(),
      switchToWs: jest.fn(),
      getType: jest.fn(),
    } as unknown as jest.Mocked<ExecutionContext>;
  }

  beforeEach(() => {
    mockHostIdentityContext = {
      validateToken: jest.fn(),
    } as unknown as jest.Mocked<HostIdentityContext>;

    mockTenantContext = {
      setTenantId: jest.fn(),
    } as unknown as jest.Mocked<TenantContext>;

    guard = new AuthGuard(mockHostIdentityContext, mockTenantContext);
  });

  // ─── Missing Authorization header ─────────────────────
  describe('Missing Authorization header', () => {
    it('should throw UnauthorizedException when Authorization header is missing', async () => {
      mockExecutionContext = createMockContext({});
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow('Missing Authorization header');
    });

    it('should throw UnauthorizedException when Authorization header is undefined', async () => {
      mockExecutionContext = createMockContext({ authorization: undefined });
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Malformed Authorization header ───────────────────
  describe('Malformed Authorization header', () => {
    it('should reject token without Bearer prefix', async () => {
      mockExecutionContext = createMockContext({ authorization: 'token-only-no-bearer' });
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow('Invalid Authorization header format');
    });

    it('should reject "Basic" auth scheme', async () => {
      mockExecutionContext = createMockContext({ authorization: 'Basic dXNlcjpwYXNz' });
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject empty Bearer token (3 parts)', async () => {
      mockExecutionContext = createMockContext({ authorization: 'Bearer token extra' });
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Valid token ──────────────────────────────────────
  describe('Valid token processing', () => {
    it('should allow access and set user + tenant context for valid token', async () => {
      mockHostIdentityContext.validateToken.mockResolvedValue(validIdentity);
      mockExecutionContext = createMockContext({ authorization: 'Bearer valid-token-123' });

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(mockHostIdentityContext.validateToken).toHaveBeenCalledWith('valid-token-123');
      expect(mockTenantContext.setTenantId).toHaveBeenCalledWith('tenant-001');

      // Verify user was set on request
      const request = mockExecutionContext.switchToHttp().getRequest();
      expect(request['user']).toEqual(validIdentity);
    });

    it('should extract token correctly from "bearer" (lowercase)', async () => {
      mockHostIdentityContext.validateToken.mockResolvedValue(validIdentity);
      mockExecutionContext = createMockContext({ authorization: 'bearer valid-token-456' });

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);
      expect(mockHostIdentityContext.validateToken).toHaveBeenCalledWith('valid-token-456');
    });
  });

  // ─── Token validation failure ─────────────────────────
  describe('Token validation failure', () => {
    it('should throw UnauthorizedException when token validation fails', async () => {
      mockHostIdentityContext.validateToken.mockRejectedValue(new Error('Token expired'));
      mockExecutionContext = createMockContext({ authorization: 'Bearer expired-token' });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow('Token expired');
    });

    it('should throw UnauthorizedException with generic message for non-Error exceptions', async () => {
      mockHostIdentityContext.validateToken.mockRejectedValue('string error');
      mockExecutionContext = createMockContext({ authorization: 'Bearer bad-token' });

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Tenant isolation ─────────────────────────────────
  describe('Tenant isolation', () => {
    it('should set correct tenant ID from token claims', async () => {
      const identity: HostIdentity = {
        ...validIdentity,
        tenantId: 'tenant-specific-abc',
      };
      mockHostIdentityContext.validateToken.mockResolvedValue(identity);
      mockExecutionContext = createMockContext({ authorization: 'Bearer tenant-token' });

      await guard.canActivate(mockExecutionContext);
      expect(mockTenantContext.setTenantId).toHaveBeenCalledWith('tenant-specific-abc');
    });
  });
});
