const { ipcRenderer } = require('electron');

// Lista de scripts externos a bloquear para reducir uso de CPU
const BLOCKED_RESOURCES = [
  'Google Analytics',
  'facebook',
  'twitter',
  'tracking',
  'analytics',
  'telemetry',
  // Añadir más recursos a bloquear según sea necesario
  'cdn.doubleclick.net', // Ejemplo: bloquear anuncios de DoubleClick
  'googletagmanager.com', // Ejemplo: bloquear Google Tag Manager
  'googlesyndication.com' // Ejemplo: bloquear anuncios de Google
];

// Funciones para inyectar antes de la carga de la página
function injectPerformanceOptimizations() {
  // Desactivar animaciones cuando no son necesarias
  const style = document.createElement('style');
  style.textContent = `
    * {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  `;
  document.head.appendChild(style);

  // Desactivar imágenes de perfil para WhatsApp Web
  const profilePicStyle = document.createElement('style');
  profilePicStyle.textContent = `
    .image-thumb, .image-thumb__image, .image-thumb__image-outer-wrapper {
      display: none !important;
    }
  `;
  document.head.appendChild(profilePicStyle);
}


// Limpiar recursos no utilizados (incluyendo imágenes y videos)
function cleanupResources() {
    // Eliminar recursos de video y audio
    document.querySelectorAll('video, audio').forEach(media => {
        URL.revokeObjectURL(media.src);
        media.src = '';
        media.load();
    });

    // Eliminar recursos de imágenes
    document.querySelectorAll('img').forEach(img => {
        URL.revokeObjectURL(img.src);
        img.src = '';
    });

    if (window.caches) {
        caches.keys().then(keyList => {
            keyList.forEach(key => caches.delete(key));
        });
    }
    if (window.gc) window.gc();
}

// Optimizaciones más agresivas para modo minimizado
function aggressiveCleanup() {
  cleanupResources();
  document.querySelectorAll('video, audio').forEach(media => {
    if (!media.paused) media.pause();
  });
  // Ocultar el body para reducir el trabajo de renderizado
  document.body.style.display = 'none';
}

// Throttle CPU para ventanas minimizadas o con poca actividad
function applyCPUThrottle(level, throttleTime) {
  if (level === 'aggressive') {
    setTimeout(() => {
      ipcRenderer.send('throttle-complete');
    }, throttleTime);
  }
  if (level === 'smooth') {
    // Implementar un throttling suave
    const start = performance.now();
    while (performance.now() - start < throttleTime * 0.1) {
      // Pequeña pausa para reducir el uso de CPU
    }
  }
}

// Modo de rendimiento
function enablePerformanceMode() {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    * {
      -webkit-backdrop-filter: none !important;
      backdrop-filter: none !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    img, video {
      image-rendering: optimizeSpeed;
    }
  `;
  document.head.appendChild(styleSheet);
}

// Añadir una función de limpieza ligera
function lightCleanup() {
  // Limpiar solo los elementos más críticos
  if (window.caches) {
    caches.keys().then(keyList => {
      keyList.slice(0, 2).forEach(key => caches.delete(key)); // Limpiar las dos primeras cachés
    });
  }
}

// Escuchar mensajes del proceso principal
ipcRenderer.on('cleanup', lightCleanup);
ipcRenderer.on('light-cleanup', lightCleanup);
ipcRenderer.on('aggressive-cleanup', aggressiveCleanup);
ipcRenderer.on('cpu-throttle', applyCPUThrottle);
ipcRenderer.on('window-state', (_, state) => {
  if (state === 'minimized') {
    aggressiveCleanup();
    ipcRenderer.send('reduce-cpu-usage');
  } else if (state === 'blurred') {
    cleanupResources();
  } else if (state === 'restored' || state === 'focused') {
    document.body.style.display = '';
  }
});

ipcRenderer.on('performance-mode', enablePerformanceMode);

// Inyectar observador de mutaciones para detectar y optimizar nuevos elementos DOM
window.addEventListener('DOMContentLoaded', () => {
  injectPerformanceOptimizations();

  // Interceptar solicitudes de red potencialmente pesadas
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = args[0].toString();
    if (BLOCKED_RESOURCES.some(resource => url.includes(resource))) {
      return new Response('', { status: 200 });
    }
    return originalFetch(...args);
  };


  // Observer para detectar y optimizar cualquier cambio en el DOM
  const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      if (mutation.type === 'childList') {
        for (let node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
              node.setAttribute('preload', 'none');
              node.setAttribute('loading', 'lazy');
            } else if (node.tagName === 'IMG') {
              node.setAttribute('loading', 'lazy');
              node.setAttribute('decoding', 'async');
            }
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Añadir un observador de rendimiento
  const performanceObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'longtask' && entry.duration > 50) {
        console.log('Long task detected:', entry.duration);
        // Aquí puedes implementar acciones adicionales para optimizar
      }
    }
  });

  performanceObserver.observe({entryTypes: ['longtask']});
});

// Limitar la frecuencia de actualización
let lastRAF = 0;
const targetFPS = 30; // Puedes ajustar este valor
const frameInterval = 1000 / targetFPS;

function limitedRAF(callback) {
  const currentTime = performance.now();
  const timeUntilNextFrame = frameInterval - (currentTime - lastRAF);

  if (timeUntilNextFrame <= 0) {
    lastRAF = currentTime;
    callback();
  } else {
    setTimeout(() => limitedRAF(callback), timeUntilNextFrame);
  }
}

// Reemplazar requestAnimationFrame con nuestra versión limitada
const originalRAF = window.requestAnimationFrame;
window.requestAnimationFrame = (callback) => {
  return originalRAF(() => limitedRAF(callback));
};

