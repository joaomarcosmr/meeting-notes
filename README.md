# Meeting Notes

App de menu bar para macOS (Electron) que **ouve a sua reunião** — seu microfone e o áudio das outras pessoas na call —, transcreve **no seu Mac** (whisper.cpp, grátis e offline) ou pela API da OpenAI, e no final usa a **API da OpenAI** para gerar um resumo em bullet points:

- ✅ **Tarefas** (com responsável e prazo, as suas primeiro)
- ⭐ **Pontos importantes**
- 💡 **O que você deve saber**
- 🤝 **Decisões**
- 💬 **O que foi discutido**, por tópico
- ❓ **Perguntas em aberto**

## Instalação

Requisitos: Mac com chip Apple (M1 ou mais novo), macOS 14.2+ (para áudio do sistema), Node 20+, [Homebrew](https://brew.sh) e uma chave da [API da OpenAI](https://platform.openai.com/api-keys) (usada no resumo).

```bash
git clone git@github.com:joaomarcosmr/meeting-notes.git
cd meeting-notes
npm install
npm link        # instala o comando `meeting` no terminal
```

Na primeira vez, abra o app (`meeting show`), clique em **⚙︎ Configurações** e:

1. cole sua chave da OpenAI (ou exporte `OPENAI_API_KEY`);
2. coloque seu nome — é assim que a IA identifica quais tarefas são suas;
3. prepare a transcrição local (próxima seção) **ou** escolha **Transcrição › OpenAI**.

> A transcrição padrão é a **local**. Enquanto o whisper.cpp e o modelo não estiverem instalados, o app não começa a gravar e abre as Configurações dizendo o que falta. Para usar já, troque para **OpenAI**.

## Transcrição local (whisper.cpp)

O áudio é transcrito no próprio Mac pelo [whisper.cpp](https://github.com/ggml-org/whisper.cpp), usando a GPU do chip Apple (Metal). É grátis, funciona offline e o áudio da reunião não sai do computador. Você precisa de três coisas — duas obrigatórias e uma opcional:

| O quê | Tamanho | Para quê |
| --- | --- | --- |
| `whisper-cpp` (Homebrew) | pequeno | o programa que transcreve (`whisper-cli`) |
| modelo `ggml-large-v3-turbo.bin` | 1,6 GB | o modelo de transcrição — melhor equilíbrio entre qualidade (ótima em português) e velocidade |
| VAD `ggml-silero-v6.2.0.bin` (opcional) | 0,9 MB | detector de voz: pula os silêncios, onde o Whisper costuma inventar frases |

### 1. Instale o whisper.cpp

```bash
brew install whisper-cpp
whisper-cli --help | head -3   # confere: deve imprimir o uso do comando
```

### 2. Baixe os modelos

**Pelo app (mais fácil):** em ⚙︎ Configurações › Transcrição › No Mac, clique em **Baixar (1,6 GB)** no modelo e em **Baixar (0,9 MB)** no detector de voz. O progresso aparece no botão; os arquivos vão para `~/Library/Application Support/Meeting Notes/models/`.

**Pelo terminal (mesmo resultado):**

```bash
MODELS="$HOME/Library/Application Support/Meeting Notes/models"
mkdir -p "$MODELS"

# modelo de transcrição (obrigatório, 1,6 GB)
curl -L --fail -o "$MODELS/ggml-large-v3-turbo.bin" \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin

# detector de voz (opcional, 0,9 MB)
curl -L --fail -o "$MODELS/ggml-silero-v6.2.0.bin" \
  https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin

ls -lh "$MODELS"   # o modelo deve ter ~1,5G
```

### 3. Confira no app

Em ⚙︎ Configurações › Transcrição, clique em **Verificar de novo**: os itens ficam com ✓ e aparece "Pronto: as reuniões serão transcritas no seu Mac". Salve.

Se o `whisper-cli` estiver em outro lugar que não o Homebrew (`/opt/homebrew/bin` ou `/usr/local/bin`), coloque o caminho em `whisperCliPath` no arquivo `~/Library/Application Support/Meeting Notes/settings.json`.

### Local × OpenAI

| | No Mac (whisper.cpp) | OpenAI (`gpt-4o-transcribe-diarize`) |
| --- | --- | --- |
| Custo | grátis | pago por minuto, × 2 trilhas |
| Áudio sai do Mac | não (só o texto vai para o resumo) | sim |
| "Você" × outros | ✓ | ✓ |
| Separa os outros entre si | não — aparecem como "Participante" | sim — "Participante A", "B"… |
| Precisa de internet | só para o resumo | sim |

Em qualquer um dos dois, o **resumo** é feito pelo `gpt-5-mini` da OpenAI (centavos por reunião).

## Menu bar: suas tarefas a um clique

O ícone de forma de onda na barra do Mac abre um painel com:

- **todas as tarefas pendentes** (as suas destacadas; filtro "Só as minhas"), com o prazo e a reunião de origem — clicar no nome da reunião abre ela no histórico;
- um campo para **adicionar tarefas à mão** (Enter), que ficam salvas em `tarefas.json` na pasta das notas;
- o botão **Gravar reunião / Parar e resumir** (o cronômetro também aparece ao lado do ícone);
- o **⚙︎**, que abre o menu de opções (gravar, abrir histórico, pasta de notas, configurações, sair) — o mesmo que aparece com clique direito no ícone.

Concluir uma tarefa no painel ou na janela atualiza os dois na hora.

## Histórico

A janela do app é o seu arquivo de reuniões:

- **Barra lateral** com todas as reuniões (Hoje, Ontem, Últimos 7 dias, por mês), mostrando duração e tarefas pendentes, com **busca** (<kbd>⌘</kbd><kbd>F</kbd>) em títulos, tarefas, pontos e tópicos.
- **Reunião aberta**: resumo completo, aba com a transcrição (quem falou e quando), botões para copiar o resumo em Markdown e abrir a pasta.
- **Minhas tarefas**: todas as tarefas pendentes de todas as reuniões, mais as adicionadas à mão (filtro "Só as minhas"). Marcar o checkbox conclui a tarefa; **"É minha?"** corrige o dono quando a IA erra.
- Reuniões cujo resumo falhou aparecem como "sem resumo", com o botão **Gerar resumo agora**.

Com a janela aberta o app aparece no Dock e no <kbd>⌘</kbd><kbd>Tab</kbd>; fechada, ele continua só na menu bar.

Os dados ficam em arquivos comuns, uma pasta por reunião em `~/Documents/Meeting Notes/<data hora>/`:

| Arquivo | Conteúdo |
| --- | --- |
| `resumo.md` | o resumo em Markdown (tarefas concluídas viram `- [x]`) |
| `resumo.json` | o resumo estruturado, que é o que a interface lê |
| `transcricao.md` | a transcrição com quem falou e marcação de tempo |
| `meta.json` | início e duração |

## Como funciona

```
microfone (você) ──── MediaRecorder ─┐  trechos de 5 min, uma trilha para cada;
sistema (os outros) ─ MediaRecorder ─┘  trechos mudos são descartados
 (CoreAudio Tap)                        │
                                        ▼
        whisper.cpp no Mac (WAV 16 kHz)  ou  gpt-4o-transcribe-diarize
                    (enquanto a reunião acontece)
                                        │
                                        ▼
   [00:03:12] Participante: quem prepara as release notes?
   [00:03:15] Você: deixa comigo, eu preparo até sexta
                                        │
                                        ▼
         gpt-5-mini + Structured Outputs (JSON Schema) ─ resumo.md
```

### Quem disse o quê

O microfone e o áudio do sistema são gravados em **trilhas separadas**. Tudo que vem do microfone é **"Você"**; o que vem do sistema são os outros — **"Participante"** na transcrição local, ou **"Participante A", "B"**… com a diarização da OpenAI. Assim a IA sabe que um "eu faço" seu é tarefa sua e marca como **minha** — é isso que alimenta "Minhas tarefas".

- **Use fone de ouvido.** Sem ele, o microfone capta a voz dos outros saindo da caixa de som e ela aparece também como "Você" (o prompt instrui a IA a tratar falas repetidas como eco, mas o fone resolve de vez).
- Na diarização da OpenAI, as letras dos participantes valem dentro de cada trecho de 5 minutos; a IA é instruída a não usá-las para identificar alguém ao longo da reunião inteira.
- Sem áudio do sistema (reunião presencial, permissão negada), tudo vem do microfone e não dá para saber quem é você: na OpenAI as pessoas aparecem como "Pessoa A", "Pessoa B"…; no modo local, sem rótulo.

### Detalhes

- Os trechos são transcritos **durante** a reunião: ao parar, só falta o último, então o resumo sai rápido mesmo em reuniões longas (e nenhum arquivo passa do limite de 25 MB da API).
- Trechos sem som nenhum (ex.: ninguém falou na call naqueles 5 minutos) não são transcritos — no modo OpenAI isso também economiza.
- Na transcrição local, o áudio é convertido para WAV 16 kHz dentro do próprio app (sem ffmpeg), o whisper.cpp usa metade dos núcleos (a call continua fluida), o final de cada trecho vira `prompt` do seguinte para manter a continuidade, e frases típicas de alucinação em silêncio ("Legendas pela comunidade Amara.org") são descartadas.
- Se um trecho falhar (3 tentativas com backoff), ele vira uma lacuna marcada na transcrição e o áudio é mantido em disco. Se o resumo falhar, a transcrição já está salva e a reunião aparece no histórico com o botão "Gerar resumo agora".
- A chave da OpenAI fica criptografada no Keychain (`safeStorage`) e nunca chega à interface.

## Uso

| Como | O que faz |
| --- | --- |
| `meeting` | começa a gravar; se já estiver gravando, para e gera o resumo |
| `meeting start` / `meeting stop` | só inicia / só para |
| `meeting show` | mostra a janela |
| <kbd>⌘</kbd><kbd>⌥</kbd><kbd>⇧</kbd><kbd>M</kbd> | atalho global para gravar/parar (configurável) |
| ícone na menu bar | clique: painel de tarefas · clique direito: menu de opções |

Dica: dá para disparar o `meeting` pelo Raycast/Alfred ou por um atalho do app Atalhos ("Executar script de shell").

### Gerar o `.app`

```bash
npm run dist   # gera dist/Meeting Notes-<versão>.dmg
```

Arraste para `/Applications`. O comando `meeting` passa a abrir o app instalado automaticamente. Os modelos baixados continuam valendo (ficam em `~/Library/Application Support/Meeting Notes/models/`).

## Permissões do macOS

- **Microfone**: pedido na primeira gravação.
- **Gravação de tela e áudio do sistema**: necessário para ouvir os outros participantes. Sem ela o macOS entrega uma trilha muda sem erro (ou não responde); o app detecta isso e segue gravando só o microfone, com um aviso.
- Rodando com `npm start`/`meeting` (sem empacotar), **quem recebe a permissão é o terminal** (Terminal, iTerm, VS Code…), não o app.

## Configurações

| Campo | Padrão |
| --- | --- |
| Transcrição | **No Mac (whisper.cpp)**; ou OpenAI |
| Modelo de transcrição da OpenAI | `gpt-4o-transcribe-diarize` (separa quem fala). `gpt-4o-transcribe` e `gpt-4o-mini-transcribe` também funcionam, sem identificar os participantes |
| Modelo do resumo | `gpt-5-mini` (barato e suficiente para extrair tarefas; `gpt-5` para resumos mais caprichados, `gpt-5-nano` para o mínimo de custo) |
| Idioma | `pt` |
| Áudio do sistema | ligado |
| Manter áudio | desligado (o áudio só é apagado se tudo foi transcrito) |
| Pasta | `~/Documents/Meeting Notes` |

## Desenvolvimento

```bash
npm start                    # abre o app
npm test                     # testes (inclui o pipeline completo contra um servidor fake da OpenAI)
node scripts/make-icons.js   # regera o ícone da menu bar
```

```
bin/meeting.js            comando de terminal (repassa a ação para a instância aberta)
src/main/main.js          ciclo de vida, menu bar, painel de tarefas, atalho global, IPC
src/main/history.js       histórico em disco: reuniões, tarefas, tarefas manuais
src/main/meeting.js       uma reunião: trechos -> transcrição -> resumo -> arquivos
src/main/local-whisper.js transcrição local com whisper.cpp e download dos modelos
src/main/openai.js        chamadas à API da OpenAI (transcrição e resumo)
src/main/transcript.js    junta as trilhas em uma conversa com quem falou
src/main/summary.js       JSON Schema do resumo, prompt e Markdown
src/main/queue.js         fila sequencial de transcrição com retry
src/renderer/recorder.js  captura e segmentação das duas trilhas
src/renderer/wav.js       conversão para WAV 16 kHz e detecção de silêncio
src/renderer/app.js       janela principal
src/renderer/popover.js   painel da menu bar
```

## Privacidade

- **Transcrição local:** o áudio fica no Mac; só o **texto** da transcrição vai para a OpenAI, para o resumo.
- **Transcrição pela OpenAI:** o áudio vai para a OpenAI para transcrição, e a transcrição para o resumo.

Avise os participantes de que a reunião está sendo gravada.

## Licença

MIT
