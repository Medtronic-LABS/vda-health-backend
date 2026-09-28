import { LocalSemanticEmbeddingProvider } from './local-semantic-embedding.provider';

jest.mock('worker_threads', () => {
  const { EventEmitter } = require('events') as typeof import('events');
  return {
    Worker: class FakeWorker extends EventEmitter {
      static latest: FakeWorker;

      constructor() {
        super();
        FakeWorker.latest = this;
        queueMicrotask(() => this.emit('message', { ready: true }));
      }

      postMessage() {}

      async terminate() {
        this.emit('exit', 0);
        return 0;
      }
    },
  };
});

function worker(): import('events').EventEmitter {
  return (require('worker_threads').Worker as { latest: import('events').EventEmitter }).latest;
}

describe('LocalSemanticEmbeddingProvider worker failures', () => {
  it('rejects a pending embedding when the worker exits after ready', async () => {
    const provider = new LocalSemanticEmbeddingProvider();
    const pending = provider.generateEmbedding('MRI');
    await new Promise((resolve) => setImmediate(resolve));
    worker().emit('exit', 1);
    await expect(pending).rejects.toThrow('Local ONNX embedding worker exited with code 1');
  });

  it('propagates a native model-load error instead of fabricating a vector', async () => {
    const provider = new LocalSemanticEmbeddingProvider();
    const pending = provider.generateEmbedding('HbA1c');
    await new Promise((resolve) => setImmediate(resolve));
    worker().emit('message', { id: 1, error: 'ERR_DLOP_FAILED' });
    await expect(pending).rejects.toThrow('ERR_DLOP_FAILED');
    await provider.onApplicationShutdown();
  });

  it('rejects a model load that never responds instead of leaving a turn pending', async () => {
    const provider = new LocalSemanticEmbeddingProvider();
    (provider as unknown as { requestTimeoutMs: number }).requestTimeoutMs = 10;
    await expect(provider.generateEmbedding('MRI')).rejects.toThrow(
      'Local ONNX embedding request timed out',
    );
    await provider.onApplicationShutdown();
  });
});
