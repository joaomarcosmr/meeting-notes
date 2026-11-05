function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const SOURCE_NAMES = { mic: 'microfone', system: 'áudio do sistema' };

// Quem falou, a partir da trilha de origem:
// - com áudio do sistema, o microfone é só o usuário ("Você") e o sistema traz
//   os outros, separados pela diarização ("Participante A", "Participante B"...);
// - sem áudio do sistema (reunião presencial, permissão negada), o microfone tem
//   todo mundo e não dá para saber quem é o usuário ("Pessoa A"...).
function speakerLabel(source, speaker, hasSystemAudio) {
  if (source === 'system') return speaker ? `Participante ${speaker}` : 'Participante';
  if (hasSystemAudio) return 'Você';
  return speaker ? `Pessoa ${speaker}` : null;
}

// Junta os trechos transcritos das duas trilhas em uma conversa só, em ordem de
// tempo, marcando lacunas para a IA (e você) saberem que falta algo.
function buildTranscript(segments) {
  const hasSystemAudio = segments.some((s) => s.source === 'system');
  const lines = [];

  for (const segment of segments) {
    if (segment.error) {
      lines.push({
        start: segment.startSec,
        gap: `(trecho do ${SOURCE_NAMES[segment.source] || 'áudio'} não transcrito: ${segment.error})`,
      });
      continue;
    }
    for (const u of segment.utterances) {
      const text = u.text.trim();
      if (!text) continue;
      lines.push({
        start: segment.startSec + (u.start || 0),
        end: segment.startSec + (u.end ?? u.start ?? 0),
        speaker: speakerLabel(segment.source, u.speaker, hasSystemAudio),
        text,
      });
    }
  }
  lines.sort((a, b) => a.start - b.start);

  // Falas seguidas da mesma pessoa viram um parágrafo só.
  const merged = [];
  for (const line of lines) {
    const last = merged[merged.length - 1];
    if (last && !last.gap && !line.gap && last.speaker === line.speaker && line.start - last.end < 2) {
      last.text += ` ${line.text}`;
      last.end = line.end;
    } else {
      merged.push({ ...line });
    }
  }

  return merged
    .map((line) => {
      const stamp = `[${formatClock(line.start)}]`;
      if (line.gap) return `${stamp} ${line.gap}`;
      return line.speaker ? `${stamp} ${line.speaker}: ${line.text}` : `${stamp} ${line.text}`;
    })
    .join('\n\n');
}

// Últimos caracteres do segmento anterior, usados como `prompt` do próximo.
function tailForPrompt(text, maxChars = 400) {
  if (!text) return '';
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

module.exports = { formatClock, speakerLabel, buildTranscript, tailForPrompt };
