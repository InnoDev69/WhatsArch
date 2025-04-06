// preload.js
const { ipcRenderer } = require('electron');

// Lista de scripts externos a bloquear para reducir uso de CPU
const BLOCKED_RESOURCES = [
  'Google Analytics',
  'facebook',
  'twitter',
  'tracking',
  'analytics',
  'telemetry'
];

// Funciones para inyectar antes de la carga de la página
function injectPerformanceOptimizations() {
  // Desactivar animaciones cuando no son necesarias
  const style = document.createElement('style');
  style.textContent = `
    @media (prefers-reduced-motion: reduce) {
      * {
        animation-duration: 0.001s !important;
        transition-duration: 0.001s !important;
      }
    }
    
    @media (prefers-reduced-motion: reduce) {
      * {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
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

// Throttle CPU para ventanas minimizadas
function applyCPUThrottle(level) {
  if (level === 'aggressive') {
    // Pausa todos los timers
    const highFrequencyEvents = window.setInterval(() => {}, 100000);
    for (let i = 0; i < highFrequencyEvents; i++) {
      window.clearInterval(i);
    }
    
    // Limita el refresco de la página
    document.documentElement.style.visibility = 'hidden';
    setTimeout(() => {
      document.documentElement.style.visibility = 'visible';
    }, 500);
  }
  
  // Reducir la prioridad de tareas en segundo plano
  if (window.requestIdleCallback) {
    const heavyTasks = [];
    const originalSetTimeout = window.setTimeout;
    
    window.setTimeout = function(callback, timeout, ...args) {
      if (timeout < 100) timeout = 100; // Prevenir timeouts muy frecuentes
      return originalSetTimeout(callback, timeout, ...args);
    };
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

ipcRenderer.on('cpu-throttle', (_, level) => {
  applyCPUThrottle(level);
});

ipcRenderer.on('window-state', (_, state) => {
  // Aplicar optimizaciones basadas en el estado de la ventana
  if (state === 'minimized') {
    aggressiveCleanup();
    
    // Casi detener actualizaciones de la UI
    document.body.style.display = 'none';
    
    // Notificar al proceso principal para reducir aún más la CPU
    ipcRenderer.send('reduce-cpu-usage');
  } else if (state === 'blurred') {
    cleanupResources();
  } else if (state === 'restored' || state === 'focused') {
    document.body.style.display = '';
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
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach((node) => {
          if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
            // Optimizar elementos multimedia
            node.setAttribute('preload', 'none');
            node.setAttribute('loading', 'lazy');
          } else if (node.tagName === 'IMG') {
            // Optimizar imágenes
            node.setAttribute('loading', 'lazy');
            node.setAttribute('decoding', 'async');
          }
        });
      }
    });
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
});