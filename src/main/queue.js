// Fila sequencial de transcrição. Os segmentos chegam a cada N minutos enquanto
// a reunião acontece e são transcritos em ordem, então no fim só falta o último.
// Sequencial de propósito: o resultado anterior da mesma trilha pode virar
// `prompt` do próximo, o que melhora a continuidade da transcrição.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createTranscriptionQueue(transcribe, { retries = 3, backoffMs = 2000, onProgress = () => {} } = {}) {
  const results = [];
  let chain = Promise.resolve();
  let total = 0;
  let done = 0;

  async function withRetry(segment, previous) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await transcribe(segment, previous);
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  function push(segment) {
    total++;
    onProgress({ done, total });
    chain = chain.then(async () => {
      const previous = results.findLast((r) => r.source === segment.source && !r.error);
      try {
        const utterances = await withRetry(segment, previous);
        results.push({ ...segment, utterances });
      } catch (error) {
        results.push({ ...segment, utterances: [], error: error.message });
      }
      done++;
      onProgress({ done, total });
    });
  }

  async function drain() {
    await chain;
    return [...results].sort((a, b) => a.index - b.index);
  }

  return { push, drain };
}

module.exports = { createTranscriptionQueue };
