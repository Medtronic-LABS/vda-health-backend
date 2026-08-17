import { Test, TestingModule } from '@nestjs/testing';
import { AbdmGatewayAuthService } from './services/abdm-gateway-auth.service';
import { AbdmEcdhService } from './services/abdm-ecdh.service';
import { ConfigurationService } from '../configuration/configuration.service';

describe('ABDM Auth & ECDH Services (Phase 7)', () => {
  let authService: AbdmGatewayAuthService;
  let ecdhService: AbdmEcdhService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbdmGatewayAuthService,
        AbdmEcdhService,
        {
          provide: ConfigurationService,
          useValue: {
            abdmBaseUrl: 'https://dev.abdm.gov.in',
            abdmClientId: 'SBX_CLIENT_123',
            abdmClientSecret: 'SECRET_456',
            abdmXCmId: 'sbx',
            abdmTimeoutMs: 5000,
          },
        },
      ],
    }).compile();

    authService = module.get<AbdmGatewayAuthService>(AbdmGatewayAuthService);
    ecdhService = module.get<AbdmEcdhService>(AbdmEcdhService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('1. AbdmEcdhService generates valid Curve25519 keypair and DhKeyMaterial', () => {
    const keyPair = ecdhService.generateKeyPair(24);
    expect(keyPair).toBeDefined();
    expect(keyPair.privateKeyBase64).toBeDefined();
    expect(keyPair.publicKeyBase64).toBeDefined();
    expect(keyPair.nonceBase64).toBeDefined();
    expect(keyPair.keyMaterial.cryptoAlg).toBe('ECDH');
    expect(keyPair.keyMaterial.curve).toBe('Curve25519');
    expect(keyPair.keyMaterial.dhPublicKey.keyValue).toBe(
      keyPair.publicKeyBase64,
    );
  });

  it('2. AbdmEcdhService decrypts payload with fallback when GCM is not present', () => {
    const rawPayload = JSON.stringify({
      resourceType: 'MedicationRequest',
      medicationName: 'Paracetamol',
    });
    const base64Content = Buffer.from(rawPayload).toString('base64');

    const keyPair = ecdhService.generateKeyPair();
    const senderKeyPair = ecdhService.generateKeyPair();

    const decrypted = ecdhService.decryptPayload({
      encryptedContentBase64: base64Content,
      hiuPrivateKeyBase64: keyPair.privateKeyBase64,
      senderPublicKeyBase64: senderKeyPair.publicKeyBase64,
      hiuNonceBase64: keyPair.nonceBase64,
      senderNonceBase64: senderKeyPair.nonceBase64,
    });

    expect(decrypted).toBe(rawPayload);
  });

  it('3. AbdmGatewayAuthService clears cache cleanly', () => {
    expect(() => authService.clearCache()).not.toThrow();
  });

  it('4. AbdmGatewayAuthService throws clear error if config credentials missing', async () => {
    const customAuthService = new AbdmGatewayAuthService({
      abdmBaseUrl: undefined,
      abdmClientId: undefined,
      abdmClientSecret: undefined,
    } as unknown as ConfigurationService);

    await expect(customAuthService.authenticate()).rejects.toThrow(
      'ABDM gateway authentication parameters',
    );
  });
});
