// preload.js
const { ipcRenderer } = require('electron');

// Lista de scripts externos a bloquear para reducir uso de CPU
const BLOCKED_RESOURCES = [
  'Google Analytics',
  'facebook',
  'twitter',
  'tracking',
  'analytics',
  'telemetry',
  'ads',
  'cdn',
  'fonts.googleapis.com'
];

// Funciones para inyectar antes de la carga de la página
function injectPerformanceOptimizations() {
  // Desactivar animaciones y transiciones
  const style = document.createElement('style');
  style.textContent = `
    * {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  `;
  document.head.appendChild(style);
}

// Limpiar recursos no utilizados
function cleanupResources() {
  // Limpia caché de imágenes
  if (window.caches) {
    try {
      caches.keys().then(keyList => {
        return Promise.all(keyList.map(key => {
          return caches.delete(key);
        }));
      });
    } catch (e) {
      // Ignorar errores de caché
    }
  }

  // Forzar recolección de basura si está disponible
  if (window.gc) window.gc();
}

// Optimizaciones más agresivas para modo minimizado
function aggressiveCleanup() {
  cleanupResources();

  // Detener reproducción de medios si hay alguno
  document.querySelectorAll('video, audio').forEach(media => {
    try {
      if (!media.paused) media.pause();
    } catch (e) {}
  });

  // Detener animaciones
  document.querySelectorAll('*').forEach(element => {
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.animationName && computedStyle.animationName !== 'none') {
      element.style.animationPlayState = 'paused';
    }
  });
}

// Throttle CPU para ventanas minimizadas o con poca actividad
function applyCPUThrottle(level, throttleTime) {
  if (level === 'aggressive') {
    setTimeout(() => {}, throttleTime * 0.8); // Usar setTimeout en lugar de un bucle síncrono
  }
}

// Modo de rendimiento
function enablePerformanceMode() {
  // Desactivar efectos visuales costosos
  try {
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
  } catch (e) {}
}

// Escuchar mensajes del proceso principal
ipcRenderer.on('cleanup', () => {
  cleanupResources();
});

ipcRenderer.on('aggressive-cleanup', () => {
  aggressiveCleanup();
});

ipcRenderer.on('cpu-throttle', (_, level, throttleTime) => {
  applyCPUThrottle(level, throttleTime);
});

let observerActive = true;

ipcRenderer.on('window-state', (_, state) => {
  if (state === 'minimized' || state === 'blurred') {
    observer.disconnect(); // Detener el observador
    observerActive = false;
  } else if ((state === 'restored' || state === 'focused') && !observerActive) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    }); // Reactivar el observador
    observerActive = true;
  }
});

ipcRenderer.on('performance-mode', () => {
  enablePerformanceMode();
});

// Inyectar observador de mutaciones para detectar y optimizar nuevos elementos DOM
window.addEventListener('DOMContentLoaded', () => {
  injectPerformanceOptimizations();

  // Interceptar solicitudes de red potencialmente pesadas
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = args[0].toString();

    // Bloquear recursos que consumen CPU
    if (BLOCKED_RESOURCES.some(resource => url.includes(resource))) {
      return new Response('', { status: 200 });
    }

    return originalFetch(...args);
  };

  // Observer para detectar y optimizar cualquier cambio en el DOM
  let mutationTimeout;
  const observer = new MutationObserver((mutations) => {
  if (mutationTimeout) return;

  mutationTimeout = setTimeout(() => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
            node.setAttribute('preload', 'none');
            node.setAttribute('loading', 'lazy');
          } else if (node.tagName === 'IMG') {
            node.setAttribute('loading', 'lazy');
            node.setAttribute('decoding', 'async');
          }
        });
      }
    });
    mutationTimeout = null;
  }, 200); // Aumentar el throttle a 200ms
  });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });