const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, safeStorage } = require('electron');

const DEFAULTS = {
  userName: '',
  language: 'pt',
  transcriptionModel: 'gpt-4o-transcribe',
  summaryModel: 'gpt-5',
  captureSystemAudio: true,
  micDeviceId: 'default',
  segmentMinutes: 5,
  keepAudio: false,
  shortcut: 'CommandOrControl+Alt+Shift+M',
  notesDir: path.join(os.homedir(), 'Documents', 'Meeting Notes'),
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

// Configurações visíveis para a interface. A chave nunca sai do processo principal;
// a interface só sabe se ela existe.
function getSettings() {
  const raw = readRaw();
  const { encryptedApiKey, ...rest } = raw;
  return { ...DEFAULTS, ...rest, hasApiKey: Boolean(getApiKey()) };
}

function saveSettings(patch) {
  const { apiKey, hasApiKey, ...rest } = patch;
  const raw = { ...readRaw(), ...rest };
  if (apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Criptografia do Keychain indisponível.');
    raw.encryptedApiKey = safeStorage.encryptString(apiKey.trim()).toString('base64');
  }
  writeRaw(raw);
  return getSettings();
}

function getApiKey() {
  const { encryptedApiKey } = readRaw();
  if (encryptedApiKey) {
    try {
      return safeStorage.decryptString(Buffer.from(encryptedApiKey, 'base64'));
    } catch {
      // Chave salva por outra assinatura do app; cai para a variável de ambiente.
    }
  }
  return process.env.OPENAI_API_KEY || '';
}

module.exports = { getSettings, saveSettings, getApiKey };
