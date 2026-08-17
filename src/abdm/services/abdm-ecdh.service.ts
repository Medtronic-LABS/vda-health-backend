import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface DhKeyMaterial {
  cryptoAlg: string;
  curve: string;
  dhPublicKey: {
    expiry: string;
    parameters: string;
    keyValue: string;
  };
  nonce: string;
}

export interface KeyPairResult {
  privateKeyBase64: string;
  publicKeyBase64: string;
  nonceBase64: string;
  keyMaterial: DhKeyMaterial;
}

@Injectable()
export class AbdmEcdhService {
  private readonly logger = new Logger(AbdmEcdhService.name);

  /**
   * Generates a new Curve25519 / X25519 key pair for HIU Data Request.
   */
  generateKeyPair(expiryHours = 24): KeyPairResult {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const privateKeyBase64 = privateKey
      .export({ type: 'pkcs8', format: 'der' })
      .toString('base64');
    const publicKeyBase64 = publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64');
    const nonce = crypto.randomBytes(32).toString('base64');

    const expiry = new Date(
      Date.now() + expiryHours * 3600 * 1000,
    ).toISOString();

    return {
      privateKeyBase64,
      publicKeyBase64,
      nonceBase64: nonce,
      keyMaterial: {
        cryptoAlg: 'ECDH',
        curve: 'Curve25519',
        dhPublicKey: {
          expiry,
          parameters: 'Curve25519/32byte random key',
          keyValue: publicKeyBase64,
        },
        nonce,
      },
    };
  }

  /**
   * Decrypts encrypted FHIR content payload received from HIP via Data Push notification.
   * Uses ECDH shared secret derivation + HKDF + AES-256-GCM decryption with graceful fallback.
   */
  decryptPayload(options: {
    encryptedContentBase64: string;
    hiuPrivateKeyBase64: string;
    senderPublicKeyBase64: string;
    hiuNonceBase64: string;
    senderNonceBase64: string;
  }): string {
    const {
      encryptedContentBase64,
      hiuPrivateKeyBase64,
      senderPublicKeyBase64,
    } = options;

    try {
      const privateKey = crypto.createPrivateKey({
        key: Buffer.from(hiuPrivateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });

      const senderPublicKey = crypto.createPublicKey({
        key: Buffer.from(senderPublicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });

      const sharedSecret = crypto.diffieHellman({
        privateKey,
        publicKey: senderPublicKey,
      });

      const salt = Buffer.concat([
        Buffer.from(options.hiuNonceBase64, 'base64'),
        Buffer.from(options.senderNonceBase64, 'base64'),
      ]);

      const derivedKey = Buffer.from(
        crypto.hkdfSync('sha256', sharedSecret, salt, Buffer.from(''), 32),
      );

      const encryptedBuffer = Buffer.from(encryptedContentBase64, 'base64');

      if (encryptedBuffer.length > 28) {
        const iv = encryptedBuffer.subarray(0, 12);
        const tag = encryptedBuffer.subarray(encryptedBuffer.length - 16);
        const ciphertext = encryptedBuffer.subarray(
          12,
          encryptedBuffer.length - 16,
        );

        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(tag);
        const decrypted =
          decipher.update(ciphertext, undefined, 'utf8') +
          decipher.final('utf8');
        return decrypted;
      }

      return encryptedBuffer.toString('utf8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[ECDH] GCM Decryption fallback to UTF-8 Base64 decode: ${msg}`,
      );
      return Buffer.from(encryptedContentBase64, 'base64').toString('utf8');
    }
  }
}
