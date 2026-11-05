// Fila sequencial de transcrição. Os segmentos chegam a cada N minutos enquanto
// a reunião acontece e são transcritos em ordem, então no fim só falta o último.
// Sequencial de propósito: o final do segmento anterior vira `prompt` do
// próximo, o que melhora a continuidade da transcrição.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createTranscriptionQueue(transcribe, { retries = 3, backoffMs = 2000, onProgress = () => {} } = {}) {
  const results = [];
  let chain = Promise.resolve();
  let total = 0;
  let done = 0;

  async function withRetry(segment, previousText) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await transcribe(segment, previousText);
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
      const previousText = results.length ? results[results.length - 1].text : '';
      try {
        const text = await withRetry(segment, previousText);
        results.push({ ...segment, text });
      } catch (error) {
        results.push({ ...segment, text: '', error: error.message });
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
