// Ações que podem chegar pela linha de comando (`meeting`, `meeting stop`, ...).
// Usado tanto pelo bin/meeting.js (que traduz subcomando -> flag) quanto pelo
// processo principal (que lê a flag no primeiro start ou no 'second-instance').

const ACTIONS = ['toggle', 'start', 'stop', 'show'];

function commandToFlag(command) {
  const action = command || 'toggle';
  if (!ACTIONS.includes(action)) {
    throw new Error(`Comando desconhecido: "${command}". Use: ${ACTIONS.join(', ')}`);
  }
  return `--${action}`;
}

function actionFromArgv(argv) {
  for (const arg of argv) {
    const match = /^--(\w+)$/.exec(arg);
    if (match && ACTIONS.includes(match[1])) return match[1];
  }
  return null;
}

module.exports = { ACTIONS, commandToFlag, actionFromArgv };
