'use strict';
/**
 * 前端渲染测试脚手架：jsdom + 真实 Vue 运行时挂载组件。
 * public/js 与 vendor 镜像到临时目录（写入测试配置），window.supabase 换成 fake-supabase，
 * 从而在不引入打包器、不连真实 Supabase 的前提下做真实 DOM 渲染断言。
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const { mirrorFrontend } = require('./frontend');

/** 把 jsdom 的浏览器对象挂到全局，供 Vue 运行时使用 */
function installGlobals(win) {
  const keys = [
    'window', 'document', 'navigator', 'location', 'history',
    'localStorage', 'sessionStorage', 'getComputedStyle',
    'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'SVGElement',
    'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  ];
  for (const k of keys) {
    const value = k === 'window' ? win : win[k];
    if (value === undefined) continue;
    Object.defineProperty(globalThis, k, { value, writable: true, configurable: true });
  }
}

/**
 * 启动一个前端渲染环境。
 * @param {object} opts
 * @param {object} opts.supabase fake-supabase 实例（createFakeSupabase 的返回值）
 */
async function startDom({ supabase } = {}) {
  const fe = mirrorFrontend({ vendor: true });
  const dir = fe.dir;
  const dom = new JSDOM(
    '<!doctype html><html lang="zh-CN"><body><div id="app"></div></body></html>',
    { url: 'https://example.github.io/jiayan/', pretendToBeVisual: true },
  );
  const win = dom.window;
  // 等价于 index.html 里的 <script src="vendor/supabase.js">
  if (supabase) {
    supabase.install();
    win.supabase = globalThis.supabase;
  }
  // 组件里用到的浏览器能力，测试中用可控替身
  win.confirm = () => true;
  const notifications = [];
  class FakeNotification {
    constructor(title, options) {
      notifications.push({ title, body: options && options.body });
    }

    static async requestPermission() {
      FakeNotification.permission = 'granted';
      return 'granted';
    }
  }
  FakeNotification.permission = 'default';
  win.Notification = FakeNotification;

  installGlobals(win);
  Object.defineProperty(globalThis, 'Notification', { value: FakeNotification, writable: true, configurable: true });

  // store.js 用裸 setInterval 做轮询降级，未清理的 interval 会把测试进程挂住。
  // 这里用登记式包装记录前端创建的定时器，close 时统一清掉。
  // 注意不能把全局 setTimeout 指向 window.setTimeout —— jsdom 内部又会调用全局实现，造成无限递归。
  const nativeTimers = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const liveTimers = new Set();
  const wrapped = {
    setTimeout: (fn, ms, ...rest) => {
      const id = nativeTimers.setTimeout((...a) => {
        liveTimers.delete(id);
        return fn(...a);
      }, ms, ...rest);
      liveTimers.add(id);
      return id;
    },
    clearTimeout: (id) => {
      liveTimers.delete(id);
      return nativeTimers.clearTimeout(id);
    },
    setInterval: (fn, ms, ...rest) => {
      const id = nativeTimers.setInterval(fn, ms, ...rest);
      liveTimers.add(id);
      return id;
    },
    clearInterval: (id) => {
      liveTimers.delete(id);
      return nativeTimers.clearInterval(id);
    },
  };
  for (const [name, fn] of Object.entries(wrapped)) {
    Object.defineProperty(globalThis, name, { value: fn, writable: true, configurable: true });
  }
  function restoreTimers() {
    for (const id of liveTimers) {
      nativeTimers.clearTimeout(id);
      nativeTimers.clearInterval(id);
    }
    liveTimers.clear();
    for (const [name, fn] of Object.entries(nativeTimers)) {
      Object.defineProperty(globalThis, name, { value: fn, writable: true, configurable: true });
    }
  }
  const sleep = (ms) => new Promise((r) => nativeTimers.setTimeout(r, ms));

  const { load } = fe;
  const vue = await import(pathToFileURL(path.join(dir, 'vendor', 'vue.esm-browser.prod.js')).href);

  const mounted = [];

  return {
    window: win,
    vue,
    notifications,
    load,
    /** 挂载组件，返回容器与卸载函数 */
    async mount(component, props = {}) {
      const host = win.document.createElement('div');
      win.document.body.appendChild(host);
      const app = vue.createApp(component, props);
      // 渲染期异常直接抛出，避免 Vue 默认只 warn 导致测试假通过
      app.config.errorHandler = (err) => { throw err; };
      app.mount(host);
      mounted.push(app);
      await vue.nextTick();
      return {
        host,
        text: () => host.textContent.replace(/\s+/g, ' ').trim(),
        html: () => host.innerHTML,
        find: (sel) => host.querySelector(sel),
        all: (sel) => Array.from(host.querySelectorAll(sel)),
        /** 找到文案匹配的可点击元素 */
        findByText(sel, needle) {
          return Array.from(host.querySelectorAll(sel))
            .find((el) => el.textContent.replace(/\s+/g, ' ').includes(needle));
        },
        async click(el) {
          if (!el) throw new Error('待点击元素不存在');
          el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
          await vue.nextTick();
        },
        async type(el, value) {
          if (!el) throw new Error('待输入元素不存在');
          el.value = value;
          el.dispatchEvent(new win.Event('input', { bubbles: true }));
          await vue.nextTick();
        },
        unmount: () => app.unmount(),
      };
    },
    /** 等待条件成立（应对异步加载） */
    async waitFor(fn, { timeout = 4000, interval = 25 } = {}) {
      const deadline = Date.now() + timeout;
      let lastErr = null;
      for (;;) {
        try {
          const val = await fn();
          if (val) return val;
          lastErr = null;
        } catch (err) {
          lastErr = err;
        }
        if (Date.now() > deadline) {
          throw lastErr || new Error('等待条件超时');
        }
        await sleep(interval);
        await vue.nextTick();
      }
    },
    sleep,
    async close() {
      for (const app of mounted) {
        try {
          app.unmount();
        } catch (_) { /* 已卸载 */ }
      }
      win.close();
      restoreTimers();
      delete globalThis.supabase;
      fe.cleanup();
    },
  };
}

module.exports = { startDom };
