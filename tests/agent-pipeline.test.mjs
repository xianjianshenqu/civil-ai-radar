import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAgentPipeline, summarizeLatestRun} from '../src/lib/agentPipeline.js';

const healthOn = {ok: true, collectionEnabled: true, intervalMinutes: 1440, translation: true, reviewModel: true};
const healthOff = {ok: true, collectionEnabled: false, intervalMinutes: 1440, translation: false, reviewModel: false};

test('guest pipeline stays on public health fields', () => {
  const view = buildAgentPipeline({
    role: 'guest',
    health: healthOn,
    collectorStatus: {enabled: true, nextRunAt: Date.parse('2026-09-30T01:00:00Z'), runs: [], modelReview: {enabled: true, model: 'glm-secret', lastRun: {at: '2026-09-30T00:00:00Z', report: {archived: 9, extracted: 9, failed: 9, skipped: 9}}}},
    modelConfig: {enabled: true, model: 'glm-secret'},
  });
  assert.equal(view.showLogin, true);
  assert.deepEqual(view.lanes.map(lane => lane.id), ['collection', 'review', 'translation']);
  assert.equal(view.lanes[0].summary, '定时采集已开启，常规周期 24 小时。');
  assert.equal(view.lanes[1].summary, '大模型机器审核已启用。');
  assert.equal(view.lanes[2].summary, '自动翻译已连接。');
  assert.equal(view.lanes.every(lane => !/glm-secret|下次计划|补跑|新增/.test(lane.summary)), true);
  assert.match(view.banners.find(item => item.tone === 'info').text, /登录管理员账号/);
});

test('signed-in non-admin sees the same public summary without a login prompt', () => {
  const view = buildAgentPipeline({role: 'member', health: healthOff, detailErrors: ['采集状态读取失败：不应展示']});
  assert.equal(view.showLogin, false);
  assert.equal(view.lanes[0].label, '已关闭');
  assert.equal(view.lanes[1].summary, '大模型未启用，机器审核为规则模式。');
  assert.match(view.lanes[2].summary, /未连接/);
  assert.match(view.banners[0].text, /无管理员权限/);
  assert.equal(view.banners.some(item => /不应展示/.test(item.text)), false);
});

test('missing health fields stay readable instead of blank', () => {
  const view = buildAgentPipeline({role: 'guest', health: {ok: true}, healthError: ''});
  assert.equal(view.lanes.every(lane => lane.state === 'unknown' && lane.summary.includes('暂时读不到')), true);
});

test('health failure without a payload still renders three lanes', () => {
  const view = buildAgentPipeline({role: 'guest', health: null, healthError: '后台暂不可用，请稍后重试。'});
  assert.equal(view.lanes.length, 3);
  assert.equal(view.lanes.every(lane => lane.state === 'unknown'), true);
  assert.equal(view.banners[0].tone, 'error');
  assert.match(view.banners[0].text, /后台暂不可用/);
});

test('admin card uses collector status and backfill counts already returned by the API', () => {
  const view = buildAgentPipeline({
    role: 'admin',
    health: healthOn,
    collectorStatus: {
      enabled: true,
      intervalMinutes: 1440,
      nextRunAt: Date.parse('2026-09-30T01:00:00Z'),
      running: false,
      runs: [{started_at: Date.parse('2026-09-29T16:00:00Z'), finished_at: Date.parse('2026-09-29T16:05:00Z'), results: [
        {source: 'gzggzy-guangzhou', status: 'error', error: 'HTTP 503'},
        {source: 'ccgp', status: 'ok', added: 2, updated: 1},
      ]}],
      translation: {enabled: true, via: 'model'},
      modelReview: {enabled: true, model: 'glm-4.5', running: false, lastRun: null},
    },
    modelConfig: {
      enabled: true,
      model: 'glm-4.5',
      automation: {useModelTranslation: true},
      review: {running: false, lastRun: {at: '2026-09-29T12:00:00.000Z', report: {archived: 1, extracted: 4, failed: 0, skipped: 2, throttled: 3}}},
    },
  });
  assert.equal(view.showLogin, false);
  assert.match(view.lanes[0].summary, /下次计划：/);
  assert.match(view.lanes[0].summary, /2026/);
  assert.match(view.lanes[0].summary, /1 个来源失败（gzggzy-guangzhou）/);
  assert.match(view.lanes[0].summary, /新增 2，更新 1/);
  assert.match(view.lanes[1].summary, /模型 glm-4.5/);
  assert.match(view.lanes[1].summary, /归档 1，机器整理 4，失败 0，跳过 2/);
  assert.match(view.lanes[1].summary, /失败退避 3/);
  assert.match(view.lanes[2].summary, /站点大模型/);
  assert.equal(view.banners.length, 0);
});

test('admin review without a backfill record says so, and a closed translation switch is explicit', () => {
  const view = buildAgentPipeline({
    role: 'admin',
    health: healthOff,
    collectorStatus: {enabled: false, running: false, runs: [], translation: {enabled: false, via: null}, modelReview: {enabled: false, model: 'gpt-4o-mini', running: false, lastRun: null}},
    modelConfig: {enabled: false, model: 'gpt-4o-mini', automation: {useModelTranslation: false}, review: {running: false, lastRun: null}},
  });
  assert.equal(view.lanes[0].summary.includes('尚无采集记录'), true);
  assert.equal(view.lanes[0].summary.includes('下次计划'), false);
  assert.match(view.lanes[1].summary, /规则模式/);
  assert.equal(/gpt-4o-mini/.test(view.lanes[1].summary), false);
  assert.match(view.lanes[2].summary, /开关已关闭/);
});

test('admin detail failure falls back to health copy and keeps the error', () => {
  const view = buildAgentPipeline({
    role: 'admin',
    health: healthOn,
    collectorStatus: null,
    modelConfig: null,
    detailErrors: ['采集状态读取失败：请先登录。', '模型设置读取失败：仅管理员可查看大模型设置。'],
  });
  assert.equal(view.lanes[0].summary, '定时采集已开启，常规周期 24 小时。');
  assert.equal(view.lanes[1].summary, '大模型机器审核已启用。');
  assert.equal(view.banners.filter(item => item.tone === 'error').length, 2);
});

test('latest run summary does not call an unfinished or empty run a success', () => {
  assert.equal(summarizeLatestRun([]), '尚无采集记录。');
  assert.match(summarizeLatestRun([{started_at: 1, finished_at: null, results: null}]), /仍在进行/);
  assert.match(summarizeLatestRun([{started_at: 1, finished_at: 2, results: null}]), /没有返回来源结果/);
  assert.match(summarizeLatestRun([{started_at: 1, finished_at: 2, results: []}]), /没有启用的来源/);
});
