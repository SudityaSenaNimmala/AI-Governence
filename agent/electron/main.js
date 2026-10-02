// Thin loader — the real code lives in resources/electron/main-impl.js
// (outside app.asar) so it can be auto-updated without rebuilding.
// This file stays in app.asar and should NEVER need to change.

const path = require('path');
const { app } = require('electron');
const isDev = !app.isPackaged;

const implPath = isDev
  ? path.join(__dirname, 'main-impl.js')
  : path.join(process.resourcesPath, 'electron', 'main-impl.js');

require(implPath);
