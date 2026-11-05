# Meeting Notes

App de menu bar para macOS (Electron) que **ouve a sua reunião** — seu microfone e o áudio das outras pessoas na call — e no final usa a **API da OpenAI** para gerar um resumo em bullet points:

- ✅ **Tarefas** (com responsável e prazo, as suas primeiro)
- ⭐ **Pontos importantes**
- 💡 **O que você deve saber**
- 🤝 **Decisões**
- 💬 **O que foi discutido**, por tópico
- ❓ **Perguntas em aberto**

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
- **Reunião aberta**: resumo completo, aba com a transcrição com marcação de tempo, botões para copiar o resumo em Markdown e abrir a pasta.
- **Minhas tarefas**: todas as tarefas pendentes de todas as reuniões, mais as adicionadas à mão, num só lugar (filtro "Só as minhas"). Marcar o checkbox conclui a tarefa e salva no arquivo.
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
microfone (você) ──── MediaRecorder ─┐  segmentos .webm de 5 min,
sistema (os outros) ─ MediaRecorder ─┘  uma trilha para cada
 (CoreAudio Tap)                        │
                                        ▼
            gpt-4o-transcribe-diarize (enquanto a reunião acontece)
                                        │
                                        ▼
   [00:03:12] Participante A: quem prepara as release notes?
   [00:03:15] Você: deixa comigo, eu preparo até sexta
                                        │
                                        ▼
         gpt-5-mini + Structured Outputs (JSON Schema) ─ resumo.md
```

### Quem disse o quê

O microfone e o áudio do sistema são gravados em **trilhas separadas**. Tudo que vem do microfone é **"Você"**; o áudio do sistema passa pela diarização do `gpt-4o-transcribe-diarize`, que separa os outros em **"Participante A", "Participante B"**… Assim a IA sabe que um "eu faço" seu é tarefa sua, e marca como **minha** — é isso que alimenta a aba "Minhas tarefas".

- **Use fone de ouvido.** Sem ele, o microfone capta a voz dos outros saindo da caixa de som e ela aparece também como "Você" (o prompt instrui a IA a tratar falas repetidas como eco, mas o fone resolve de vez).
- As letras dos participantes valem dentro de cada trecho de 5 minutos; a IA é instruída a não usá-las para identificar alguém ao longo da reunião inteira.
- Sem áudio do sistema (reunião presencial, permissão negada), tudo vem do microfone e as pessoas aparecem como "Pessoa A", "Pessoa B"…, sem presumir quem é você.
- Como são duas trilhas com a duração inteira da reunião, a transcrição custa cerca de 2× o de uma trilha só.
- A IA errou o dono? Cada tarefa tem o botão **"É minha?"** para corrigir com um clique.

- A gravação é dividida em segmentos de 5 minutos, transcritos **durante** a reunião. Ao parar, só falta o último trecho, então o resumo sai rápido mesmo em reuniões longas — e nenhum arquivo passa do limite de 25 MB da API.
- Com um modelo sem diarização (ex.: `gpt-4o-transcribe`), o final de cada trecho vira `prompt` do seguinte, para manter a continuidade.
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
| ícone na menu bar | clique: painel de tarefas · clique direito: menu de opções |

Durante a gravação a menu bar mostra o cronômetro ao lado do ícone.

Dica: dá para disparar o `meeting` pelo Raycast/Alfred ou por um atalho do app Atalhos ("Executar script de shell").

## Permissões do macOS

- **Microfone**: pedido na primeira gravação.
- **Gravação de tela e áudio do sistema**: necessário para ouvir os outros participantes. Sem ela o macOS entrega uma trilha muda sem erro; o app detecta isso e avisa que está gravando só o microfone.
- Rodando com `npm start`/`meeting` (sem empacotar), **quem recebe a permissão é o terminal** (Terminal, iTerm, VS Code…), não o app.
- Use fone de ouvido se puder: sem ele o microfone também capta o som das caixas e as falas dos outros ficam duplicadas.

## Configurações

| Campo | Padrão |
| --- | --- |
| Modelo de transcrição | `gpt-4o-transcribe-diarize` (separa quem fala). `gpt-4o-transcribe` e `gpt-4o-mini-transcribe` também funcionam, mas sem identificar os participantes |
| Modelo do resumo | `gpt-5-mini` (barato e suficiente para extrair tarefas; `gpt-5` para resumos mais caprichados, `gpt-5-nano` para o mínimo de custo) |
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
