// main.js
const { app, BrowserWindow, session, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
let win;
let powerSaveId = null;
let isMinimized = false;
let throttleIntervalId = null;

// Configurar User-Agent antes de crear ventanas
app.userAgentFallback = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Optimizaciones avanzadas antes de iniciar la app
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-http2');
app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-accelerated-video-encode');
app.commandLine.appendSwitch('disable-gpu-memory-buffer-video-frames');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('high-dpi-support', 1);
app.commandLine.appendSwitch('force-device-scale-factor', 1);

// Función para limitar el uso de CPU
function throttleCPU(enable) {
  if (throttleIntervalId) {
    clearInterval(throttleIntervalId);
    throttleIntervalId = null;
  }

  if (enable && win) {
    // Detectar número de núcleos disponibles y memoria
    const cpuCount = os.cpus().length;
    const systemMemory = os.totalmem() / 1024 / 1024 / 1024; // GB

    // Ajustar el throttling según los recursos disponibles, más agresivo para 2 núcleos y 1GHz
    const throttleTime = 1000; // Reducir el tiempo para throttling más frecuente
    const throttleLevel = 'aggressive'; // Siempre usar throttling agresivo


    throttleIntervalId = setInterval(() => {
      if (win && !win.isDestroyed()) {
        // Pausar la ejecución del renderer process
        win.webContents.send('cpu-throttle', throttleLevel, throttleTime * 0.8); // Pausar por el 80% del throttleTime
      }
    }, throttleTime);
  }
}

function createWindow() {

  const windowOptions = {
    width: 800, // Reducir tamaño de ventana para menor consumo
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'persist:whatsapp', // Persistir la sesión
      backgroundThrottling: true, // Habilitamos throttling para mejor rendimiento
      devTools: false, // Desactivar DevTools en producción
      preload: path.join(__dirname, 'preload.js'),
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Optimizaciones adicionales
      enableWebSQL: false,
      spellcheck: false,
      disableDialogs: true,
      zoomFactor: 1.0,
      enableBlinkFeatures: '',
      disableBlinkFeatures: 'AutomationControlled,Translate',
      disableHardwareAcceleration: true // Esta opción reduce considerablemente el uso de CPU
    },
    // Optimizaciones para reducir el uso de memoria
    backgroundColor: '#f8f9fa',
    show: false, // No mostrar hasta que la ventana esté lista
    autoHideMenuBar: true,
    // Reducir la prioridad en el sistema
    paintWhenInitiallyHidden: true,
    // Evitar que la ventana se vuelva a renderizar cuando está en segundo plano
    offscreen: false
  };

  win = new BrowserWindow(windowOptions);

  // Aplicar User-Agent tanto en sesión por defecto como en sesión persistente
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

  // Limitar el framerate para ahorrar CPU. Valor más bajo para máquinas de bajos recursos.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setFrameRate(15); // Limitar a 15 FPS
    win.webContents.send('performance-mode', true);

    // Reducir uso de memoria después de cargar la página.
    setTimeout(() => {
      if (global.gc) {
        global.gc();
      }
    }, 60000); // Esperar 1 minuto antes de la primera limpieza
  });

  // Mostrar ventana solo cuando se haya cargado
  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // Abrir enlaces externos en el navegador predeterminado en lugar de crear nuevas ventanas
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

// Limpieza de memoria cada 60 segundos cuando está minimizada
// y cada 5 minutos cuando está en uso
setInterval(() => {
  if (win && !win.isDestroyed()) {
    if (isMinimized) {
      win.webContents.send('aggressive-cleanup');
      if (global.gc) global.gc();
    }
  }
}, 60 * 1000);

setInterval(() => {
  if (win && !win.isDestroyed() && !isMinimized) {
    win.webContents.send('cleanup');
    if (global.gc) global.gc();
  }
}, 5 * 60 * 1000);

// Optimización de inicio de aplicación
app.whenReady().then(() => {
  createWindow();
});

// Limpiar recursos cuando se cierran todas las ventanas
app.on('window-all-closed', () => {
  if (throttleIntervalId) {
    clearInterval(throttleIntervalId);
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
  if (win && !win.isDestroyed()) {
    win.webContents.setFrameRate(20); // Reducir aún más el framerate
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
  reducePriority();
});