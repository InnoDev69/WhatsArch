// main.js
const { app, BrowserWindow, session, powerSaveBlocker, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
let win;
let powerSaveId = null;
let isMinimized = false;
let throttleIntervalId = null;

// Configuración predeterminada de rendimiento
let performanceSettings = {
  blockResources: true,
  disableAnimations: true,
  hideProfilePictures: true,
  limitFrameRate: true,
  backgroundThrottling: true,
  aggressiveCleanup: true
};

// Ruta para guardar configuración
const configPath = path.join(app.getPath('userData'), 'performance-settings.json');

// Cargar configuración guardada o usar valores predeterminados
function loadSettings() {
  try {
    if (fs.existsSync(configPath)) {
      const savedSettings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      performanceSettings = { ...performanceSettings, ...savedSettings };
    }
  } catch (err) {
    console.error('Error al cargar configuración:', err);
  }
}

// Guardar configuración
function saveSettings() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(performanceSettings), 'utf8');
  } catch (err) {
    console.error('Error al guardar configuración:', err);
  }
}

// Cargar configuración al inicio
loadSettings();

// Configurar User-Agent antes de crear ventanas
app.userAgentFallback = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Optimizaciones avanzadas antes de iniciar la app
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu'); // Desactivar la GPU para reducir el consumo
app.commandLine.appendSwitch('high-dpi-support', 1);
app.commandLine.appendSwitch('force-device-scale-factor', 1);

// Reemplazar la función throttleCPU con una versión más suave
function throttleCPU(enable) {
  if (throttleIntervalId) {
    clearInterval(throttleIntervalId);
    throttleIntervalId = null;
  }

  if (enable && win && performanceSettings.backgroundThrottling) {
    const throttleTime = 100; // Reducir el intervalo para un throttling más suave
    let lastThrottleTime = Date.now();

    throttleIntervalId = setInterval(() => {
      if (win && !win.isDestroyed()) {
        const now = Date.now();
        const timeSinceLastThrottle = now - lastThrottleTime;

        if (timeSinceLastThrottle >= 1000) { // Aplicar throttling cada segundo
          win.webContents.send('cpu-throttle', 'smooth', throttleTime);
          lastThrottleTime = now;
        }
      }
    }, throttleTime);
  }
}

function createWindow() {
  const windowOptions = {
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:whatsapp',
      backgroundThrottling: performanceSettings.backgroundThrottling,
      devTools: true,
      preload: path.join(__dirname, 'preload.js'),
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      enableWebSQL: false,
      webgl: false,
      safeBrowsingEnabled: false,
      spellcheck: false,
      disableDialogs: true,
      zoomFactor: 1.0,
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'AutomationControlled,Translate',
      disableHardwareAcceleration: true
    },
    backgroundColor: '#f8f9fa',
    show: false,
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: true,
    offscreen: false
  };

  win = new BrowserWindow(windowOptions);

  // Aplicar User-Agent
  const filter = {
    urls: ['*://*.whatsapp.com/*', '*://web.whatsapp.com/*']
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

  win.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Limitar framerate según configuración
  win.webContents.on('did-finish-load', () => {
    if (performanceSettings.limitFrameRate) {
      win.webContents.setFrameRate(10);
    }
    
    // Enviar configuración de rendimiento al preload
    win.webContents.send('performance-settings', performanceSettings);

    // Reducir uso de memoria después de cargar la página
    setTimeout(() => {
      if (global.gc) {
        global.gc();
      }
    }, 60000);
  });

  // Mostrar ventana solo cuando se haya cargado
  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadURL('https://web.whatsapp.com/');

  // Gestión de energía inteligente
  win.on('focus', () => {
    if (powerSaveId === null) {
      powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    }
    isMinimized = false;
    throttleCPU(false);
    win.webContents.send('window-state', 'focused');
  });

  win.on('blur', () => {
    if (powerSaveId !== null) {
      powerSaveBlocker.stop(powerSaveId);
      powerSaveId = null;
    }
    throttleCPU(true);
    win.webContents.send('window-state', 'blurred');
  });

  // Liberar memoria cuando la ventana está minimizada
  win.on('minimize', () => {
    isMinimized = true;
    throttleCPU(true);
    win.webContents.send('window-state', 'minimized');
  });

  win.on('restore', () => {
    isMinimized = false;
    throttleCPU(false);
    win.webContents.send('window-state', 'restored');
  });
}

// Modificar el intervalo de limpieza
let cleanupCounter = 0;
let cleanupInterval;

function startCleanupInterval() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  cleanupInterval = setInterval(() => {
    if (win && !win.isDestroyed() && performanceSettings.aggressiveCleanup) {
      cleanupCounter++;
      if (isMinimized || cleanupCounter >= 30) {
        win.webContents.send('aggressive-cleanup');
        if (global.gc) global.gc();
        cleanupCounter = 0;
      } else {
        win.webContents.send('light-cleanup');
      }
    }
  }, 10 * 1000);
}

// API para el menu de rendimiento
ipcMain.handle('get-performance-settings', () => {
  return performanceSettings;
});

ipcMain.on('toggle-blocked-resources', (_, enabled) => {
  performanceSettings.blockResources = enabled;
  saveSettings();
});

ipcMain.on('toggle-animations', (_, enabled) => {
  performanceSettings.disableAnimations = enabled;
  saveSettings();
});

ipcMain.on('toggle-profile-pictures', (_, enabled) => {
  performanceSettings.hideProfilePictures = enabled;
  saveSettings();
});

ipcMain.on('toggle-framerate-limit', (_, enabled) => {
  performanceSettings.limitFrameRate = enabled;
  if (win && !win.isDestroyed()) {
    win.webContents.setFrameRate(enabled ? 10 : 60);
  }
  saveSettings();
});

ipcMain.on('toggle-background-throttling', (_, enabled) => {
  performanceSettings.backgroundThrottling = enabled;
  saveSettings();
});

ipcMain.on('toggle-aggressive-cleanup', (_, enabled) => {
  performanceSettings.aggressiveCleanup = enabled;
  saveSettings();
});

ipcMain.on('restart-app', () => {
  saveSettings();
  dialog.showMessageBox({
    type: 'info',
    title: 'Reinicio requerido',
    message: 'La aplicación necesita reiniciarse para aplicar los cambios. ¿Desea reiniciar ahora?',
    buttons: ['Sí', 'No']
  }).then(result => {
    if (result.response === 0) {
      app.relaunch();
      app.exit();
    }
  });
});

// Optimización de inicio de aplicación
app.whenReady().then(() => {
  createWindow();
  startCleanupInterval();
});

// Limpiar recursos cuando se cierran todas las ventanas
app.on('window-all-closed', () => {
  if (throttleIntervalId) {
    clearInterval(throttleIntervalId);
  }

  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  if (powerSaveId !== null) {
    powerSaveBlocker.stop(powerSaveId);
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Manejo de eventos de bajo nivel para optimizaciones adicionales
ipcMain.on('reduce-cpu-usage', () => {
  if (win && !win.isDestroyed() && performanceSettings.limitFrameRate) {
    win.webContents.setFrameRate(5); // Reducir aún más el framerate
  }
});

// Función para reducir la prioridad del proceso
function reducePriority() {
  try {
    process.setProcessPriority('low');
  } catch (e) {
    // Ignorar si no está disponible en todos los sistemas
  }
}

// Reducir prioridad cuando la aplicación está en segundo plano
app.on('browser-window-blur', () => {
  if (performanceSettings.backgroundThrottling) {
    reducePriority();
  }
});