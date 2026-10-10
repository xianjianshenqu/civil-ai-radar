import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(filename) {
  if(filename!==':memory:')mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY REFERENCES users(id),data TEXT NOT NULL,since INTEGER NOT NULL,last_sent INTEGER NOT NULL DEFAULT 0,unsubscribe_hash TEXT NOT NULL,cursor_id TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS unsubscribe_tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT UNIQUE NOT NULL,data TEXT NOT NULL,content_hash TEXT NOT NULL,first_seen INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,etag TEXT,last_modified TEXT,last_attempt INTEGER,last_success INTEGER,error TEXT);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,started_at INTEGER NOT NULL,finished_at INTEGER,results TEXT);
    CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT NOT NULL,to_email TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,created_at INTEGER NOT NULL,sent_at INTEGER,error TEXT,provider_id TEXT);
  `);
  // 每源独立调度列（2026-09-29，参考 AIHOT per-source 调度）：失败退避阶梯与下次尝试时间。
  // SQLite 无 IF NOT EXISTS 的 ADD COLUMN，重复迁移按「已存在」忽略。
  for(const column of ['fail_count INTEGER NOT NULL DEFAULT 0','next_attempt INTEGER','interval_minutes INTEGER']){
    try{db.exec('ALTER TABLE sources ADD COLUMN '+column);}catch{/* column already exists */}
  }
  // 公开池版本号：文章表任何增删改都 +1，公开列表缓存据此判断是否需要重算（feeds.mjs memoByPublicVersion）。
  bumpPublicVersionOnWrite(db,'articles');
  if(filename!==':memory:')chmodSync(filename,0o600);
  return db;
}
export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}
export function bumpPublicVersionOnWrite(db,table) {
  db.exec('CREATE TABLE IF NOT EXISTS public_version(id INTEGER PRIMARY KEY CHECK(id=1),n INTEGER NOT NULL); INSERT OR IGNORE INTO public_version VALUES(1,0);');
  for(const [suffix,event] of [['i','INSERT'],['u','UPDATE'],['d','DELETE']])
    db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_public_version_${suffix} AFTER ${event} ON ${table} BEGIN UPDATE public_version SET n=n+1 WHERE id=1; END;`);
}
