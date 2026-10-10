import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/database.mjs';
import { createBackups } from '../server/backup.mjs';

test('daily backup writes one consistent copy per China day and keeps only the newest copies',t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'radar-backup-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const database=path.join(dir,'radar.sqlite'),backupDir=path.join(dir,'backups');
  const db=openDatabase(database);
  t.after(()=>db.close());
  db.prepare("INSERT INTO meta VALUES('k','v')").run();
  let clock=Date.parse('2026-10-01T02:00:00Z');
  const backups=createBackups({db,config:{database,backupDir,backupKeep:2},now:()=>clock});
  const first=backups.runDaily();
  assert.equal(path.basename(first.file),'radar-2026-10-01.sqlite');
  assert.equal(backups.runDaily(),null,'same China day is not backed up twice');
  const copy=new DatabaseSync(first.file);
  assert.equal(copy.prepare("SELECT value FROM meta WHERE key='k'").get().value,'v');
  copy.close();
  // 北京时间跨日后各写一份，只保留最近 2 份。
  for(const day of ['2026-10-02','2026-10-03']){clock=Date.parse(day+'T02:00:00Z');backups.runDaily();}
  assert.deepEqual(readdirSync(backupDir).sort(),['radar-2026-10-02.sqlite','radar-2026-10-03.sqlite']);
  // 上次中断留下的临时文件不会被当作当天备份。
  clock=Date.parse('2026-10-04T02:00:00Z');
  writeFileSync(path.join(backupDir,'radar-2026-10-04.sqlite.partial'),'broken');
  assert.ok(backups.runDaily());
  assert.ok(!existsSync(path.join(backupDir,'radar-2026-10-04.sqlite.partial')));
});

test('backup is disabled when keep is 0 or the database is in memory',()=>{
  const db=openDatabase(':memory:');
  assert.equal(createBackups({db,config:{database:':memory:',backupDir:'/tmp/x',backupKeep:7}}).runDaily(),null);
  assert.equal(createBackups({db,config:{database:'/tmp/radar.sqlite',backupDir:'/tmp/x',backupKeep:0}}).enabled,false);
  db.close();
});
