import { browser } from 'webextension-polyfill-ts';
import { ProfileLike, resolveFieldValue } from '@/utils/autofillFields';

let isInitialized = false;
let stylesAdded = false;

/**
 * Ensures toast notification styles are added to the document
 */
function ensureToastStyles() {
  if (stylesAdded) return;

  const style = document.createElement('style');
  style.textContent = `
    .toast-success {
      background-color: hsl(142.1, 76.2%, 36.3%);
      color: white;
      border-radius: 6px;
      padding: 12px 16px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      opacity: 0;
      transform: translateY(16px);
      animation: toast-in 0.3s ease forwards;
    }
    
    .toast-error {
      background-color: hsl(0, 84.2%, 60.2%);
      color: white;
      border-radius: 6px;
      padding: 12px 16px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      opacity: 0;
      transform: translateY(16px);
      animation: toast-in 0.3s ease forwards;
    }
    
    .toast-loading {
      background-color: hsl(215, 20.2%, 65.1%);
      color: white;
      border-radius: 6px;
      padding: 12px 16px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      opacity: 0;
      transform: translateY(16px);
      animation: toast-in 0.3s ease forwards;
    }
    
    .spinner {
      margin-right: 8px;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      border-top-color: white;
      animation: spin 1s ease-in-out infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    @keyframes toast-in {
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;

  document.head.appendChild(style);
  stylesAdded = true;
}

/**
 * Gets or creates the toast container
 */
function getToastContainer(): HTMLElement {
  let toastContainer = document.getElementById(
    'resume-generator-toast-container'
  );

  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'resume-generator-toast-container';
    toastContainer.className = 'toaster group';
    toastContainer.style.position = 'fixed';
    toastContainer.style.bottom = '20px';
    toastContainer.style.right = '20px';
    toastContainer.style.zIndex = '9999';
    document.body.appendChild(toastContainer);

    ensureToastStyles();
  }

  return toastContainer;
}

/**
 * Shows a notification toast
 */
function showNotification(
  message: string,
  type: 'success' | 'error' = 'success'
): void {
  try {
    const toastContainer = getToastContainer();

    const toast = document.createElement('div');
    toast.className = type === 'error' ? 'toast-error' : 'toast-success';
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

      setTimeout(() => {
        if (toastContainer.contains(toast)) {
          toastContainer.removeChild(toast);
        }

        if (toastContainer.childNodes.length === 0) {
          try {
            if (document.body.contains(toastContainer)) {
              document.body.removeChild(toastContainer);
            }
          } catch (error) {
            console.warn('Error removing toast container:', error);
          }
        }
      }, 300);
    }, 3000);
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

/**
 * Shows a loading toast with spinner
 */
function showLoadingToast(id: string, message: string): void {
  try {
    const toastContainer = getToastContainer();

    let toast = document.getElementById(id);

    if (!toast) {
      toast = document.createElement('div');
      toast.id = id;
      toast.className = 'toast-loading';

      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      toast.appendChild(spinner);

      const messageSpan = document.createElement('span');
      messageSpan.textContent = message;
      toast.appendChild(messageSpan);

      toastContainer.appendChild(toast);
    }
  } catch (error) {
    console.error('Error showing loading toast:', error);
  }
}

/**
 * Updates the message of a loading toast
 */
function updateLoadingToast(id: string, message: string): void {
  try {
    const toast = document.getElementById(id);
    if (toast) {
      const messageSpan = toast.querySelector('span');
      if (messageSpan) {
        messageSpan.textContent = message;
      }
    }
  } catch (error) {
    console.error('Error updating loading toast:', error);
  }
}

/**
 * Hides a loading toast
 */
function hideLoadingToast(id: string): void {
  try {
    const toast = document.getElementById(id);
    if (toast) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

      setTimeout(() => {
        const toastContainer = document.getElementById(
          'resume-generator-toast-container'
        );
        if (toastContainer && toastContainer.contains(toast)) {
          toastContainer.removeChild(toast);

          if (toastContainer.childNodes.length === 0) {
            try {
              if (document.body.contains(toastContainer)) {
                document.body.removeChild(toastContainer);
              }
            } catch (error) {
              console.warn('Error removing toast container:', error);
            }
          }
        }
      }, 300);
    }
  } catch (error) {
    console.error('Error hiding loading toast:', error);
  }
}

/**
 * Tier-1 auto-fill: heuristically fill application form fields from the profile.
 * Matches inputs by label/name/id/placeholder/aria-label/autocomplete text.
 */
function describeInput(input: HTMLElement): string {
  const parts: string[] = [];
  const id = input.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) parts.push(label.textContent || '');
  }
  const wrappingLabel = input.closest('label');
  if (wrappingLabel) parts.push(wrappingLabel.textContent || '');
  parts.push(
    input.getAttribute('name') || '',
    id || '',
    input.getAttribute('placeholder') || '',
    input.getAttribute('aria-label') || '',
    input.getAttribute('autocomplete') || ''
  );
  return parts.join(' ');
}

function setNativeValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  // Use the native setter so React-controlled inputs register the change
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function autofillFromProfile(profile: ProfileLike): {
  filled: number;
  total: number;
  unfilledRequired: string[];
} {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea'
    )
  ).filter(el => !el.disabled && !el.readOnly);

  let filled = 0;
  const unfilledRequired: string[] = [];

  inputs.forEach(input => {
    const descriptor = describeInput(input);
    const value = resolveFieldValue(descriptor, profile);

    if (value && !input.value) {
      setNativeValue(input, value);
      filled += 1;
    } else if (
      !input.value &&
      (input.required || input.getAttribute('aria-required') === 'true')
    ) {
      unfilledRequired.push(
        input.getAttribute('name') ||
          input.getAttribute('id') ||
          input.getAttribute('placeholder') ||
          'unnamed field'
      );
    }
  });

  return { filled, total: inputs.length, unfilledRequired };
}

/**
 * Message listener for background script communication
 */
browser.runtime.onMessage.addListener((message: any) => {
  try {
    if (
      message.action === 'showLoadingToast' &&
      message.id &&
      message.message
    ) {
      showLoadingToast(message.id, message.message);
      return Promise.resolve({ success: true });
    }

    if (message.action === 'hideLoadingToast' && message.id) {
      hideLoadingToast(message.id);
      return Promise.resolve({ success: true });
    }

    if (
      message.action === 'updateLoadingToast' &&
      message.id &&
      message.message
    ) {
      updateLoadingToast(message.id, message.message);
      return Promise.resolve({ success: true });
    }

    if (message.action === 'ping') {
      return Promise.resolve({ success: true, message: 'pong' });
    }

    if (message.action === 'getCurrentPageInfo') {
      // Get text content of the page
      const content = document.body.innerText || '';

      // Check if there's any meaningful content
      if (!content || content.trim().length < 10) {
        return Promise.resolve({
          success: false,
          error: 'Page has no meaningful content',
        });
      }

      return Promise.resolve({
        success: true,
        url: window.location.href,
        title: document.title,
        content: content,
      });
    }

    if (message.action === 'autofillApplication' && message.profile) {
      const result = autofillFromProfile(message.profile);
      showNotification(
        `Auto-filled ${result.filled} field${result.filled === 1 ? '' : 's'}`,
        result.filled > 0 ? 'success' : 'error'
      );
      return Promise.resolve({ success: true, ...result });
    }

    if (message.action === 'showNotification' && message.message) {
      showNotification(message.message, message.type || 'success');
      return Promise.resolve({ success: true });
    }

    return Promise.resolve({
      success: false,
      error: 'Unknown action',
      receivedAction: message.action,
    });
  } catch (error) {
    console.error('Error handling message in content script:', error);
    return Promise.resolve({ success: false, error: String(error) });
  }
});

/**
 * Initializes the content script
 */
function initialize() {
  if (isInitialized) return;
  isInitialized = true;

  // Notify background script that content script is ready
  try {
    browser.runtime.sendMessage({ action: 'contentScriptReady' });
  } catch (error) {
    console.warn('Error notifying background script:', error);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
