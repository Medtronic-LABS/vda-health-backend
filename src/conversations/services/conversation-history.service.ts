import { Injectable, Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConversationTurn } from '../../database/entities/conversation-turn.entity';
import { IPiiProtectionService } from '../../pii/interfaces/pii-protection-service.interface';

@Injectable()
export class ConversationHistoryService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject('IPiiProtectionService')
    private readonly piiService: IPiiProtectionService,
  ) {}

  /**
   * Retrieves recent conversation turns for context-aware multi-turn reasoning.
   * Enforces retention scope consent and PII sanitization.
   */
  async getRecentTurnHistory(
    sessionId: string,
    maxTurns = 3,
    maxChars = 1000,
  ): Promise<string> {
    const turnRepo = this.dataSource.getRepository(ConversationTurn);

    // Retrieve recent turns ordered by turn number descending
    const turns = await turnRepo.find({
      where: { sessionId },
      order: { turnNumber: 'DESC' },
      take: maxTurns + 1, // Include current active turn
    });

    if (turns.length <= 1) {
      return '';
    }

    // Skip the current active turn (first item in DESC order)
    const previousTurns = turns.slice(1).reverse();
    const historyBlocks: string[] = [];

    for (const turn of previousTurns) {
      // If retention was not granted, turn text is null in DB
      if (!turn.conversationRetentionGranted || !turn.inputText) {
        continue;
      }

      // Extract output text
      let outputText = turn.outputText || '';
      try {
        const parsed = JSON.parse(outputText) as Record<string, unknown>;
        const hiVal = parsed['hi'];
        const enVal = parsed['en'];
        if (typeof hiVal === 'string') {
          outputText = hiVal;
        } else if (typeof enVal === 'string') {
          outputText = enVal;
        }
      } catch {
        // use plain string
      }

      // Sanitize history text against PII
      const sanitizedInput = (
        await this.piiService.sanitizeText(turn.inputText)
      ).sanitizedText;
      const sanitizedOutput = (await this.piiService.sanitizeText(outputText))
        .sanitizedText;

      historyBlocks.push(
        `[TURN ${turn.turnNumber}]\nPatient: ${sanitizedInput}\nAssistant: ${sanitizedOutput}`,
      );
    }

    let combined = historyBlocks.join('\n\n');
    if (combined.length > maxChars) {
      combined = combined.slice(-maxChars);
    }

    return combined;
  }
}
