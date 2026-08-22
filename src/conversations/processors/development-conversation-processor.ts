import { Injectable } from '@nestjs/common';
import { IConversationProcessor } from '../interfaces/conversation-processor.interface';
import { HostIdentity } from '../../auth/host-identity.context';

@Injectable()
export class DevelopmentConversationProcessor implements IConversationProcessor {
  async processTurn(
    sessionId: string,
    inputText: string,
    correlationId: string,
    _identity: HostIdentity,
    _consentArtifactId: string,
  ): Promise<{
    responseType: string;
    content: Record<string, any>;
    intent: string | null;
    selectedAgent: string | null;
    safetyStatus: string;
  }> {
    await Promise.resolve();
    // Reference parameters to satisfy unused vars check
    if (!sessionId || !inputText || !correlationId) {
      // Do nothing
    }

    // Deterministic prototype response generator.
    // Explicitly non-clinical placeholder response.
    return {
      responseType: 'text',
      content: {
        en: 'Conversation processing is available in the prototype.',
        hi: 'प्रोटोटाइप में बातचीत की प्रक्रिया उपलब्ध है।',
      },
      intent: 'prototype-intent',
      selectedAgent: 'prototype-agent',
      safetyStatus: 'SAFE',
    };
  }
}
