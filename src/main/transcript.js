function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Junta os segmentos transcritos em um texto único com marcação de tempo,
// sinalizando trechos que falharam para a IA (e você) saberem que há lacunas.
function joinSegments(segments) {
  return segments
    .map((segment) => {
      const stamp = `[${formatClock(segment.startSec)}]`;
      if (segment.error) return `${stamp} (trecho não transcrito: ${segment.error})`;
      return `${stamp} ${segment.text.trim()}`;
    })
    .join('\n\n');
}

// Últimos caracteres do segmento anterior, usados como `prompt` do próximo.
function tailForPrompt(text, maxChars = 400) {
  if (!text) return '';
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

module.exports = { formatClock, joinSegments, tailForPrompt };
