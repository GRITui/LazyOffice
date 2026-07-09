const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// Keys whose values are secrets and should be encrypted at rest (via the OS
// keychain, through Electron's safeStorage) rather than sitting in plaintext
// in config.json. Everything else stays plaintext for easy inspection.
var SENSITIVE_KEYS = { ANTHROPIC_API_KEY: true };
var ENC_PREFIX = 'enc:v1:';

function encryptionAvailable() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch (err) {
    return false;
  }
}

// Encrypt a sensitive value to an "enc:v1:<base64>" marker string. Falls back
// to storing plaintext if the platform can't encrypt (keeps the app usable
// rather than blocking on keychain availability).
function maybeEncrypt(key, value) {
  if (!SENSITIVE_KEYS[key] || !value || !encryptionAvailable()) {
    return value;
  }
  try {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
  } catch (err) {
    return value;
  }
}

// Reverse of maybeEncrypt. A marker we can't decrypt (e.g. copied from another
// machine/user) yields null so the caller treats the secret as unset rather
// than leaking ciphertext.
function maybeDecrypt(value) {
  if (typeof value !== 'string' || value.indexOf(ENC_PREFIX) !== 0) {
    return value;
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch (err) {
    return null;
  }
}

/**
 * Same shape as GAS's PropertiesService.getScriptProperties(), backed by a
 * JSON file in the OS user-data directory instead of Apps Script's project
 * properties. Lets engine.js stay close to Code.gs's structure. Sensitive
 * values (see SENSITIVE_KEYS) are transparently encrypted on write and
 * decrypted on read, so callers always see plaintext.
 */
var ScriptProperties = {
  getProperty: function (key) {
    var config = readConfig();
    if (!Object.prototype.hasOwnProperty.call(config, key)) return null;
    return maybeDecrypt(config[key]);
  },
  setProperty: function (key, value) {
    var config = readConfig();
    config[key] = maybeEncrypt(key, value);
    writeConfig(config);
  },
  getProperties: function () {
    var config = readConfig();
    var out = {};
    Object.keys(config).forEach(function (key) { out[key] = maybeDecrypt(config[key]); });
    return out;
  }
};

module.exports = { ScriptProperties: ScriptProperties, configPath: configPath };
