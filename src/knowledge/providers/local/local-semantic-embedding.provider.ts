/* eslint-disable */
import { Injectable, Logger, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Worker } from 'worker_threads';
import {
  IEmbeddingProvider,
  ModelInfo,
} from '../../interfaces/embedding-provider.interface';

@Injectable()
export class LocalSemanticEmbeddingProvider
  implements IEmbeddingProvider, OnApplicationShutdown
{
  private readonly logger = new Logger(LocalSemanticEmbeddingProvider.name);
  private worker?: Worker;
  private workerReady?: Promise<void>;
  private nextRequestId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (vectors: number[][]) => void; reject: (error: Error) => void }
  >();
  private readonly modelName = 'all-MiniLM-L6-v2';
  private readonly dimension = 384;

  constructor() {
    this.workerReady = this.startWorker();
  }

  private startWorker(): Promise<void> {
    const workerCode = `
      const { parentPort } = require('worker_threads');
      let pipeline;
      let initializing;
      async function getPipeline() {
        if (pipeline) return pipeline;
        if (!initializing) initializing = (async () => {
          const transformers = await import('@xenova/transformers');
          pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
          return pipeline;
        })();
        return initializing;
      }
      parentPort.on('message', async ({ id, texts }) => {
        try {
          const embedder = await getPipeline();
          const embeddings = [];
          for (const text of texts) {
            const output = await embedder(text, { pooling: 'mean', normalize: true });
            const vector = Array.from(output.data);
            if (vector.length !== 384) throw new Error('Model returned unexpected embedding dimension: ' + vector.length);
            embeddings.push(vector);
          }
          parentPort.postMessage({ id, embeddings });
        } catch (error) {
          parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
        }
      });
      parentPort.postMessage({ ready: true });
    `;
    return new Promise((resolve, reject) => {
      this.worker = new Worker(workerCode, { eval: true });
      this.worker.once('error', (error) => {
        reject(error);
      });
      this.worker.on('message', (message: any) => {
        if (message.ready) {
          this.logger.log('Local ONNX embedding worker initialized (all-MiniLM-L6-v2, 384-dim)');
          resolve();
          return;
        }
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error));
        else request.resolve(message.embeddings);
      });
    });
  }

  getModelInfo(): ModelInfo {
    return {
      name: this.modelName,
      dimension: this.dimension,
      provider: 'local-onnx-transformers',
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const vec = await this.generateEmbedding('health check');
      return vec.length === 384;
    } catch {
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new ServiceUnavailableException('Embedding input is empty.');
    }

    const vectors = await this.requestEmbeddings([text]);
    return vectors[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.some((text) => !text || !text.trim())) {
      throw new ServiceUnavailableException('Embedding input is empty.');
    }
    return this.requestEmbeddings(texts);
  }

  private async requestEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      await this.workerReady;
      if (!this.worker) throw new Error('Embedding worker is unavailable.');
      const id = ++this.nextRequestId;
      return await new Promise<number[][]>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.worker!.postMessage({ id, texts });
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Local semantic embedding inference failed: ${msg}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.terminate();
  }
}
