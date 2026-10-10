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
  private workerFailure?: Error;
  private shuttingDown = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private restartAttempts = 0;
  private workerStartedAt = 0;
  private nextRequestId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (vectors: number[][]) => void; reject: (error: Error) => void }
  >();
  private readonly modelName = 'all-MiniLM-L6-v2';
  private readonly dimension = 384;
  // A stalled first model load must fail before the 60-second ingress timeout.
  // The worker may finish initializing later; no substitute vector is returned.
  private readonly requestTimeoutMs = 30_000;

  constructor() {
    this.workerReady = this.startWorker();
    void this.workerReady.catch(() => undefined);
  }

  private startWorker(): Promise<void> {
    this.workerFailure = undefined;
    this.workerStartedAt = Date.now();
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
      const worker = new Worker(workerCode, { eval: true });
      this.worker = worker;
      const failWorker = (error: Error) => {
        if (this.worker !== worker || this.workerFailure) return;
        this.workerFailure = error;
        this.worker = undefined;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        if (!this.shuttingDown) {
          this.logger.error(`Local ONNX embedding worker failed: ${error.message}`);
          this.scheduleRestart();
        }
        reject(error);
      };
      worker.on('error', failWorker);
      worker.on('exit', (code) => {
        failWorker(new Error(`Local ONNX embedding worker exited with code ${code}`));
      });
      worker.on('message', (message: any) => {
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

  private scheduleRestart(): void {
    if (this.shuttingDown || this.restartTimer) return;
    if (Date.now() - this.workerStartedAt > 60_000) this.restartAttempts = 0;
    if (this.restartAttempts >= 5) {
      this.logger.error('Local ONNX embedding worker restart limit reached');
      return;
    }
    const delayMs = Math.min(1000 * 2 ** this.restartAttempts++, 16_000);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.shuttingDown) return;
      this.workerReady = this.startWorker();
      void this.workerReady.catch(() => undefined);
    }, delayMs);
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
      if (this.workerFailure) throw this.workerFailure;
      if (!this.worker) throw new Error('Embedding worker is unavailable.');
      const id = ++this.nextRequestId;
      return await new Promise<number[][]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Local ONNX embedding request timed out'));
        }, this.requestTimeoutMs);
        this.pending.set(id, {
          resolve: (vectors) => {
            clearTimeout(timer);
            resolve(vectors);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        try {
          this.worker!.postMessage({ id, texts });
        } catch (error) {
          this.pending.get(id)?.reject(error instanceof Error ? error : new Error(String(error)));
          this.pending.delete(id);
        }
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(`Local semantic embedding inference failed: ${msg}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const error = new Error('Local ONNX embedding worker is shutting down');
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    await this.worker?.terminate();
  }
}
