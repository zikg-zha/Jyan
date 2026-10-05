'use strict';
/**
 * supabase-js 的测试替身：auth（匿名会话）/ rpc（转发到 PGlite）/ storage / realtime。
 * realtime 由 PGlite 的 LISTEN/NOTIFY 驱动（见 Harness.enableRealtime），
 * 按 postgres_changes 的 table / event / filter 分发，presence 在同名频道间共享。
 */
const { toSupabaseError } = require('./pg');

function matchFilter(filter, row) {
  if (!filter) return true;
  const m = /^(\w+)=eq\.(.+)$/.exec(filter);
  return !!m && row && String(row[m[1]]) === m[2];
}

function createFakeSupabase(harness) {
  const state = { uid: null, uploads: [], channels: new Set(), presence: new Map() };

  function syncPresence(name) {
    for (const ch of state.channels) {
      if (ch.name === name) ch.presenceHandlers.forEach((fn) => fn());
    }
  }

  function makeChannel(name, opts) {
    const key = (opts && opts.config && opts.config.presence && opts.config.presence.key) || '';
    const ch = {
      name,
      changeHandlers: [],
      presenceHandlers: [],
      on(type, filter, cb) {
        if (type === 'postgres_changes') ch.changeHandlers.push({ filter, cb });
        else if (type === 'presence' && filter.event === 'sync') ch.presenceHandlers.push(cb);
        return ch;
      },
      subscribe(cb) {
        state.channels.add(ch);
        queueMicrotask(() => cb && cb('SUBSCRIBED'));
        return ch;
      },
      async track(meta) {
        if (!state.presence.has(name)) state.presence.set(name, {});
        state.presence.get(name)[key] = [meta];
        syncPresence(name);
        return 'ok';
      },
      presenceState: () => ({ ...(state.presence.get(name) || {}) }),
      unsubscribe() {
        state.channels.delete(ch);
        const p = state.presence.get(name);
        if (p) delete p[key];
        syncPresence(name);
      },
    };
    return ch;
  }

  const client = {
    auth: {
      async getSession() {
        return { data: { session: state.uid ? { user: { id: state.uid } } : null }, error: null };
      },
      async signInAnonymously() {
        state.uid = await harness.newUser();
        return { data: { session: { user: { id: state.uid } } }, error: null };
      },
    },
    async rpc(fn, args) {
      try {
        return { data: await harness.rpc(state.uid, fn, args), error: null };
      } catch (err) {
        return { data: null, error: toSupabaseError(err) };
      }
    },
    storage: {
      from(bucket) {
        return {
          async upload(p, file, opts) {
            state.uploads.push({ bucket, path: p, type: opts.contentType });
            return { data: { path: p }, error: null };
          },
          getPublicUrl: (p) => ({ data: { publicUrl: `https://demo.supabase.co/storage/v1/object/public/${bucket}/${p}` } }),
        };
      },
    },
    channel: (name, opts) => makeChannel(name, opts),
    removeChannel(ch) {
      ch.unsubscribe();
      return Promise.resolve('ok');
    },
  };

  /** 数据库变更 → 分发给订阅了对应表的频道 */
  function dispatch(change) {
    for (const ch of state.channels) {
      for (const { filter, cb } of ch.changeHandlers) {
        if (filter.schema !== 'public' || filter.table !== change.table) continue;
        if (filter.event !== '*' && filter.event !== change.eventType) continue;
        if (!matchFilter(filter.filter, change.new || change.old)) continue;
        cb({ schema: 'public', table: change.table, eventType: change.eventType,
          new: change.new || {}, old: change.old || {} });
      }
    }
  }

  return {
    state,
    client,
    dispatch,
    /** 挂到全局，等价于 index.html 里引入的 UMD 包 */
    install() {
      globalThis.supabase = { createClient: () => client };
    },
    /** 以另一台设备身份（新匿名用户）重新开始 */
    resetSession() {
      state.uid = null;
    },
  };
}

module.exports = { createFakeSupabase };
