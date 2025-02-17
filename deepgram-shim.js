// shim.js
if (typeof globalThis.isBrowser === 'undefined') {
    globalThis.isBrowser = () => false;
  }
  