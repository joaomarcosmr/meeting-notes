#!/usr/bin/env node
// `meeting`        inicia a gravação (ou para, se já estiver gravando)
// `meeting start`  só inicia     `meeting stop`  para e resume     `meeting show`  mostra a janela

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { commandToFlag } = require('../src/main/argv');

const APP = '/Applications/Meeting Notes.app';

let flag;
try {
  flag = commandToFlag(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Uma nova instância repassa o comando para a que já está aberta (single instance lock).
const child = fs.existsSync(APP)
  ? spawn('open', ['-n', '-a', APP, '--args', flag], { stdio: 'ignore', detached: true })
  : spawn(require('electron'), [path.join(__dirname, '..'), flag], { stdio: 'ignore', detached: true });
child.unref();
