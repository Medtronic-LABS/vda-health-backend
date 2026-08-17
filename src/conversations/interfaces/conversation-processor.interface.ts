export interface IConversationProcessor {
  processTurn(
    sessionId: string,
    inputText: string,
    correlationId: string,
  ): Promise<{
    responseType: string;
    content: Record<string, any>;
    intent: string | null;
    selectedAgent: string | null;
    safetyStatus: string;
  }>;
}
