const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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

/**
 * Same shape as GAS's PropertiesService.getScriptProperties(), backed by a
 * JSON file in the OS user-data directory instead of Apps Script's project
 * properties. Lets engine.js stay close to Code.gs's structure. Plaintext —
 * there is no secret stored here (no API key; CLAUDE_CLI_PATH etc. are just
 * local config), unlike an earlier version of this file that encrypted
 * ANTHROPIC_API_KEY at rest via Electron's safeStorage.
 */
var ScriptProperties = {
  getProperty: function (key) {
    var config = readConfig();
    return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : null;
  },
  setProperty: function (key, value) {
    var config = readConfig();
    config[key] = value;
    writeConfig(config);
  },
  // Batched write: one read + one write for the whole object, instead of a
  // read-modify-write per key. Only the keys present in `values` are touched.
  setProperties: function (values) {
    var config = readConfig();
    Object.keys(values).forEach(function (key) { config[key] = values[key]; });
    writeConfig(config);
  },
  getProperties: function () {
    return readConfig();
  }
};

module.exports = { ScriptProperties: ScriptProperties, configPath: configPath };
