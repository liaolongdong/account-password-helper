// WXT Extension TypeScript Template
// This template provides common patterns and utilities for WXT extensions

import { storage } from 'wxt/storage';
// Browser API is available globally in WXT - no import needed
// Types are available through global browser object

// === Type Definitions ===
interface ExtensionSettings {
  theme: 'light' | 'dark';
  notifications: boolean;
  autoSync: boolean;
}

interface UserData {
  id: string;
  name: string;
  preferences: Record<string, any>;
}

interface MessageSender {
  id?: string;
  url?: string;
  tab?: any;
}

// === Storage Management ===
class StorageManager {
  private static instance: StorageManager;

  private constructor() {}

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  async getSettings(): Promise<ExtensionSettings> {
    const defaultSettings: ExtensionSettings = {
      theme: 'light',
      notifications: true,
      autoSync: false,
    };

    return (await storage.getItem('local:settings')) || defaultSettings;
  }

  async saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const currentSettings = await this.getSettings();
    const updatedSettings = { ...currentSettings, ...settings };
    await storage.setItem('local:settings', updatedSettings);
  }

  async getUserData(): Promise<UserData | null> {
    return await storage.getItem('local:userData');
  }

  async saveUserData(userData: UserData): Promise<void> {
    await storage.setItem('local:userData', userData);
  }

  async clearUserData(): Promise<void> {
    await storage.removeItem('local:userData');
  }
}

// === Message Handling ===
class MessageHandler {
  private static instance: MessageHandler;

  private constructor() {}

  static getInstance(): MessageHandler {
    if (!MessageHandler.instance) {
      MessageHandler.instance = new MessageHandler();
    }
    return MessageHandler.instance;
  }

  async sendMessage<T = any>(message: any): Promise<T> {
    try {
      // @ts-ignore - browser is available globally in WXT
      const response = await browser.runtime.sendMessage(message);
      if (response?.success) {
        return response.data;
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Message sending failed:', error);
      throw error;
    }
  }

  async handleBackgroundMessage(message: any, sender: MessageSender): Promise<any> {
    try {
      switch (message.type) {
        case 'GET_SETTINGS':
          const settings = await StorageManager.getInstance().getSettings();
          return { success: true, data: settings };

        case 'SAVE_SETTINGS':
          await StorageManager.getInstance().saveSettings(message.data);
          return { success: true };

        case 'GET_USER_DATA':
          const userData = await StorageManager.getInstance().getUserData();
          return { success: true, data: userData };

        case 'SAVE_USER_DATA':
          await StorageManager.getInstance().saveUserData(message.data);
          return { success: true };

        default:
          return { success: false, error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('Message handling error:', error);
      return { success: false, error: error.message };
    }
  }
}

// === Utility Functions ===
export class ExtensionUtils {
  static async getCurrentTab(): Promise<any | null> {
    try {
      // @ts-ignore - browser is available globally in WXT
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      return tabs[0] || null;
    } catch (error) {
      console.error('Failed to get current tab:', error);
      return null;
    }
  }

  static async injectContentScript(tabId: number, file: string): Promise<void> {
    try {
      // @ts-ignore - browser is available globally in WXT
      await browser.scripting.executeScript({
        target: { tabId },
        files: [file],
      });
    } catch (error) {
      console.error('Failed to inject content script:', error);
      throw error;
    }
  }

  static async showNotification(title: string, message: string, iconUrl?: string): Promise<string> {
    try {
      // @ts-ignore - browser is available globally in WXT
      return await browser.notifications.create({
        type: 'basic',
        title,
        message,
        iconUrl: iconUrl || 'icon/48.png',
      });
    } catch (error) {
      console.error('Failed to show notification:', error);
      throw error;
    }
  }

  static debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;

    return function executedFunction(...args: Parameters<T>) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };

      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  static getDomainFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
  }
}

// === Event Listeners ===
export class EventListeners {
  private static listeners: Array<() => void> = [];

  static addCleanupListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  static cleanup(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('Cleanup listener error:', error);
      }
    });
    this.listeners = [];
  }
}

// === Error Handling ===
export class ErrorHandler {
  static async handleAsyncError<T>(asyncFn: () => Promise<T>, fallbackValue?: T): Promise<T | undefined> {
    try {
      return await asyncFn();
    } catch (error) {
      console.error('Async operation failed:', error);
      return fallbackValue;
    }
  }

  static wrapAsyncFunction<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    fallbackValue?: Awaited<ReturnType<T>>,
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | undefined> {
    return async (...args: Parameters<T>) => {
      return await this.handleAsyncError(() => fn(...args), fallbackValue);
    };
  }
}

// === Export instances ===
export const storageManager = StorageManager.getInstance();
export const messageHandler = MessageHandler.getInstance();

// === Type exports ===
export type { ExtensionSettings, UserData };
