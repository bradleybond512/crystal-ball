/**
 * Stub for src/services/ml-worker.ts used by the panel test harness.
 * Exports a no-op mlWorker singleton so panels that import it can mount
 * without a real ONNX worker or Vite build environment.
 */

class StubMLWorkerManager {
  get isAvailable() { return false; }
  async init() { return false; }
  async loadModel() { return false; }
  async unloadModel() { return false; }
  async unloadOptionalModels() {}
  async embedTexts() { return []; }
  async summarize() { return []; }
  async classifySentiment() { return []; }
  async extractEntities() { return []; }
  async semanticCluster() { return []; }
  async clusterBySemanticSimilarity() { return []; }
  async getStatus() { return []; }
  reset() {}
  terminate() {}
  isModelLoaded() { return false; }
}

export const mlWorker = new StubMLWorkerManager();
