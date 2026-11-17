if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(error => {
      console.warn('Offline support unavailable:', error);
    });
  });
}
