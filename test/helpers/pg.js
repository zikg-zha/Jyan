'use strict';
/**
 * 测试夹具：用 PGlite（WASM 版 Postgres）加载 supabase/schema.sql + seed.sql，
 * 并模拟 Supabase 的 auth schema、anon/authenticated 角色，
 * 以「某个匿名用户」的身份调用 RPC，覆盖 RLS 与函数权限。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

async function createDb({ seed = true } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8'));
  if (seed) await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'seed.sql'), 'utf8'));
  return new Harness(db);
}

class Harness {
  constructor(db) {
    this.db = db;
  }

  /** 新建一个匿名用户（相当于 supabase.auth.signInAnonymously） */
  async newUser() {
    const id = crypto.randomUUID();
    await this.db.query('insert into auth.users (id) values ($1)', [id]);
    return id;
  }

  /** 以指定用户身份（authenticated 角色）执行 SQL；uid 为 null 时模拟 anon */
  async as(uid, sql, params = []) {
    return this.db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [uid || '']);
      await tx.query(uid ? 'set local role authenticated' : 'set local role anon');
      return tx.query(sql, params);
    });
  }

  /** 调用 public.<fn>(p_x => ...)，与 supabase.rpc(fn, {p_x}) 等价 */
  async rpc(uid, fn, args = {}) {
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`bad fn ${fn}`);
    const keys = Object.keys(args);
    for (const k of keys) if (!/^p_[a-z_]+$/.test(k)) throw new Error(`bad arg ${k}`);
    const call = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    const res = await this.as(uid, `select public.${fn}(${call}) as r`, keys.map((k) => args[k]));
    return res.rows[0].r;
  }

  /** 超级用户直接查询（断言用） */
  async sql(sql, params = []) {
    return (await this.db.query(sql, params)).rows;
  }

  async inviteCode() {
    return (await this.sql('select invite_code from public.families order by id limit 1'))[0].invite_code;
  }

  /** 新用户并登录为指定成员，返回 uid */
  async loginAs(name, password = '123456', code) {
    const uid = await this.newUser();
    const r = await this.rpc(uid, 'login', {
      p_invite_code: code || await this.inviteCode(), p_name: name, p_password: password,
    });
    if (!r.ok) throw new Error(`login ${name} failed: ${r.message}`);
    return uid;
  }

  /**
   * 模拟 Supabase Realtime：表变更时 pg_notify，交给 onChange 分发
   * （payload 上限 8000 字节，菜品的大字段不发送，与客户端只用 id 的行为一致）
   */
  async enableRealtime(onChange) {
    await this.db.exec(`
      create or replace function public._test_realtime() returns trigger language plpgsql as $$
      declare
        v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'ingredients' - 'steps' end;
        v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'ingredients' - 'steps' end;
      begin
        perform pg_notify('realtime', jsonb_build_object(
          'table', tg_table_name, 'eventType', tg_op, 'new', v_new, 'old', v_old)::text);
        return null;
      end $$;
    `);
    for (const t of ['orders', 'dishes', 'members', 'notifications']) {
      await this.db.exec(`create or replace trigger _test_realtime after insert or update or delete
        on public.${t} for each row execute function public._test_realtime()`);
    }
    await this.db.listen('realtime', (payload) => onChange(JSON.parse(payload)));
  }

  async close() {
    await this.db.close();
  }
}

/** 把 PGlite 抛出的错误转换成 supabase-js 的 error 形状 */
function toSupabaseError(err) {
  return {
    message: err.message,
    code: err.code || '',
    details: err.detail || null,
    hint: err.hint || null,
  };
}

/** 从业务错误中取出状态码（schema.sql 里 private.fail 写在 hint） */
function statusOf(err) {
  const m = /^jiayan:(\d{3})$/.exec((err && err.hint) || '');
  return m ? Number(m[1]) : 0;
}

module.exports = { createDb, toSupabaseError, statusOf };
