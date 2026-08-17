import { IntentMetadata } from './intent.types';

export interface IIntentClassifier {
  classifyIntent(
    text: string,
    language?: string,
    correlationId?: string,
  ): Promise<IntentMetadata>;
}
