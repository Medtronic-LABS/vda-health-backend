/* eslint-disable */
import { Injectable } from '@nestjs/common';
import {
  IEmbeddingProvider,
  ModelInfo,
} from '../../interfaces/embedding-provider.interface';
import { createHash } from 'crypto';

@Injectable()
export class DevelopmentEmbeddingProvider implements IEmbeddingProvider {
  private readonly dimension = 384;

  getModelInfo(): ModelInfo {
    return {
      name: 'dev-synthetic-384',
      dimension: this.dimension,
      provider: 'development-mock',
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const hash = createHash('sha256')
      .update(text || 'dev')
      .digest();
    const vec: number[] = [];
    for (let i = 0; i < this.dimension; i++) {
      const b = hash[i % hash.length];
      vec.push((b / 255) * 2 - 1);
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }
}
