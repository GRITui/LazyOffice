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
 * properties. Lets engine.js stay close to Code.gs's structure.
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

module.exports = { ScriptProperties: ScriptProperties, configPath: configPath };
