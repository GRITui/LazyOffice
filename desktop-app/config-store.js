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

function isEncrypted(value) {
  return typeof value === 'string' && value.indexOf(ENC_PREFIX) === 0;
}

// Encrypt a sensitive value to an "enc:v1:<base64>" marker string. Falls back
// to storing plaintext if the platform can't encrypt — but warns loudly, since
// that silently weakens the at-rest guarantee (only happens off macOS/Windows,
// e.g. Linux without a Secret Service provider).
function maybeEncrypt(key, value) {
  if (!SENSITIVE_KEYS[key] || !value) {
    return value;
  }
  if (encryptionAvailable()) {
    try {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64');
    } catch (err) {
      // fall through to the plaintext warning below
    }
  }
  console.warn('[config-store] OS encryption unavailable — storing ' + key +
    ' in PLAINTEXT in config.json. Secret is not encrypted at rest on this system.');
  return value;
}

// Reverse of maybeEncrypt. Only attempts decryption when the value is actually
// an enc marker AND encryption is available (symmetric with maybeEncrypt). A
// marker we cannot decrypt (keychain moved/locked/reset, different login) yields
// null so the caller treats the secret as *unreadable-on-this-machine* rather
// than leaking ciphertext — while the ciphertext itself is left untouched on
// disk (see the never-overwrite-with-blank rule in main.js) so it is not lost.
function maybeDecrypt(value) {
  if (!isEncrypted(value)) {
    return value;
  }
  if (!encryptionAvailable()) {
    return null;
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
 * decrypted on read, so callers always see plaintext (or null when a stored
 * secret can't be decrypted on this machine).
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
  // Batched write: one read + one write for the whole object, instead of a
  // read-modify-write per key. Only the keys present in `values` are touched.
  setProperties: function (values) {
    var config = readConfig();
    Object.keys(values).forEach(function (key) { config[key] = maybeEncrypt(key, values[key]); });
    writeConfig(config);
  },
  getProperties: function () {
    var config = readConfig();
    var out = {};
    Object.keys(config).forEach(function (key) { out[key] = maybeDecrypt(config[key]); });
    return out;
  },
  // One-time upgrade for secrets written before at-rest encryption existed (or
  // written on a system that lacked a keychain then): re-encrypt any sensitive
  // key that is still plaintext. Safe to call on every startup — a no-op once
  // everything is already encrypted or if encryption is unavailable.
  migrateSecrets: function () {
    if (!encryptionAvailable()) return 0;
    var config = readConfig();
    var changed = 0;
    Object.keys(SENSITIVE_KEYS).forEach(function (key) {
      var v = config[key];
      if (typeof v === 'string' && v && !isEncrypted(v)) {
        config[key] = maybeEncrypt(key, v);
        if (isEncrypted(config[key])) changed++;
      }
    });
    if (changed) writeConfig(config);
    return changed;
  }
};

module.exports = { ScriptProperties: ScriptProperties, configPath: configPath };
