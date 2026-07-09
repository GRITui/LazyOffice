const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.lazyoffice');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Same shape as GAS's PropertiesService.getScriptProperties() and the
 * desktop-app's config-store — a local JSON file instead of an Electron
 * userData path, since this server has no Electron app object to ask.
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
  getProperties: function () {
    return readConfig();
  }
};

module.exports = { ScriptProperties: ScriptProperties, CONFIG_PATH: CONFIG_PATH };
