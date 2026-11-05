# Meeting Notes

App de menu bar para macOS (Electron) que **ouve a sua reunião** — seu microfone e o áudio das outras pessoas na call — e no final usa a **API da OpenAI** para gerar um resumo em bullet points:

- ✅ **Tarefas** (com responsável e prazo, as suas primeiro)
- ⭐ **Pontos importantes**
- 💡 **O que você deve saber**
- 🤝 **Decisões**
- 💬 **O que foi discutido**, por tópico
- ❓ **Perguntas em aberto**

## Histórico

A janela do app é o seu arquivo de reuniões:

- **Barra lateral** com todas as reuniões (Hoje, Ontem, Últimos 7 dias, por mês), mostrando duração e tarefas pendentes, com **busca** (<kbd>⌘</kbd><kbd>F</kbd>) em títulos, tarefas, pontos e tópicos.
- **Reunião aberta**: resumo completo, aba com a transcrição com marcação de tempo, botões para copiar o resumo em Markdown e abrir a pasta.
- **Minhas tarefas**: todas as tarefas pendentes de todas as reuniões num só lugar (filtro "Só as minhas"). Marcar o checkbox conclui a tarefa e salva no arquivo.
- Reuniões cujo resumo falhou aparecem como "sem resumo", com o botão **Gerar resumo agora**.

Com a janela aberta o app aparece no Dock e no <kbd>⌘</kbd><kbd>Tab</kbd>; fechada, ele continua só na menu bar.

Os dados ficam em arquivos comuns, uma pasta por reunião em `~/Documents/Meeting Notes/<data hora>/`:

| Arquivo | Conteúdo |
| --- | --- |
| `resumo.md` | o resumo em Markdown (tarefas concluídas viram `- [x]`) |
| `resumo.json` | o resumo estruturado, que é o que a interface lê |
| `transcricao.md` | a transcrição com marcação de tempo |
| `meta.json` | início e duração |

## Como funciona

```
microfone ─┐
           ├─ mix (Web Audio) ─ MediaRecorder ─ segmentos .webm de 5 min
sistema ───┘                                         │
 (CoreAudio Tap)                                     ▼
                                   gpt-4o-transcribe (enquanto a reunião acontece)
                                                     │
                                                     ▼
                         gpt-5 + Structured Outputs (JSON Schema) ─ resumo.md
```

- A gravação é dividida em segmentos de 5 minutos, transcritos **durante** a reunião. Ao parar, só falta o último trecho, então o resumo sai rápido mesmo em reuniões longas — e nenhum arquivo passa do limite de 25 MB da API.
- O final de cada trecho é enviado como `prompt` da transcrição seguinte, para manter a continuidade.
- Se um trecho falhar (3 tentativas com backoff), ele vira uma lacuna marcada na transcrição e o áudio é mantido em disco. Se o resumo falhar, a transcrição já está salva e a reunião aparece no histórico com o botão "Gerar resumo agora".
- A chave da OpenAI fica criptografada no Keychain (`safeStorage`) e nunca chega à interface.

## Instalação

Requisitos: macOS 14.2+ (para áudio do sistema), Node 20+ e uma chave da [API da OpenAI](https://platform.openai.com/api-keys).

```bash
git clone git@github.com:joaomarcosmr/meeting-notes.git
cd meeting-notes
npm install
npm link        # instala o comando `meeting` no terminal
```

Na primeira vez, abra o app (`meeting show`), clique em ⚙︎ e cole sua chave da OpenAI (ou exporte `OPENAI_API_KEY`). Coloque seu nome também: é assim que a IA identifica quais tarefas são suas.

### Gerar o `.app`

```bash
npm run dist   # gera dist/Meeting Notes-<versão>.dmg
```

Arraste para `/Applications`. O comando `meeting` passa a abrir o app instalado automaticamente.

## Uso

| Como | O que faz |
| --- | --- |
| `meeting` | começa a gravar; se já estiver gravando, para e gera o resumo |
| `meeting start` / `meeting stop` | só inicia / só para |
| `meeting show` | mostra a janela |
| <kbd>⌘</kbd><kbd>⌥</kbd><kbd>⇧</kbd><kbd>M</kbd> | atalho global para gravar/parar (configurável) |
| ícone ◎ na menu bar | gravar, parar, abrir pasta de notas, configurações |

Durante a gravação o menu bar mostra `● 00:12:34`.

Dica: dá para disparar o `meeting` pelo Raycast/Alfred ou por um atalho do app Atalhos ("Executar script de shell").

## Permissões do macOS

- **Microfone**: pedido na primeira gravação.
- **Gravação de tela e áudio do sistema**: necessário para ouvir os outros participantes. Sem ela o macOS entrega uma trilha muda sem erro; o app detecta isso e avisa que está gravando só o microfone.
- Rodando com `npm start`/`meeting` (sem empacotar), **quem recebe a permissão é o terminal** (Terminal, iTerm, VS Code…), não o app.
- Use fone de ouvido se puder: sem ele o microfone também capta o som das caixas e as falas dos outros ficam duplicadas.

## Configurações

| Campo | Padrão |
| --- | --- |
| Modelo de transcrição | `gpt-4o-transcribe` (também funciona com `gpt-4o-mini-transcribe` ou `whisper-1`) |
| Modelo do resumo | `gpt-5` (qualquer modelo com Structured Outputs) |
| Idioma | `pt` |
| Áudio do sistema | ligado |
| Manter áudio | desligado (o áudio só é apagado se tudo foi transcrito) |
| Pasta | `~/Documents/Meeting Notes` |

## Desenvolvimento

```bash
npm start   # abre o app
npm test    # testes (inclui o pipeline completo contra um servidor fake da OpenAI)
```

```
bin/meeting.js           comando de terminal (repassa a ação para a instância aberta)
src/main/main.js         ciclo de vida, menu bar, atalho global, IPC
src/main/history.js      histórico em disco: listar, abrir, concluir tarefas
src/main/meeting.js      uma reunião: segmentos -> transcrição -> resumo -> arquivos
src/main/openai.js       chamadas à API da OpenAI
src/main/summary.js      JSON Schema do resumo, prompt e Markdown
src/main/queue.js        fila sequencial de transcrição com retry
src/renderer/recorder.js captura, mixagem e segmentação do áudio
src/renderer/app.js      interface
```

## Privacidade

O áudio vai para a OpenAI para transcrição e a transcrição vai para a OpenAI para o resumo. Avise os participantes de que a reunião está sendo gravada.

## Licença

MIT
