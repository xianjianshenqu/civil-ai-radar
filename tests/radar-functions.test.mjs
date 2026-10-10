import test from 'node:test';
import assert from 'node:assert/strict';
import {entries, defaults, filterEntries, inWindow, isUpcoming, validDate, formatReport, readRoute, mergeCollected, isDetailVisible, batchDate, isFeatured, editorialSources, buildHotEvents, featuredSort, HOT_LIMIT, groupByDay, timelineDay, recommendReason, recommendReasonLabel, entryOrigin} from '../src/lib/radar.js';
import {readingKindLabel} from '../src/lib/reading.js';
import {applyLane, sanitizeMachineReview} from '../src/lib/machineReview.js';
import {formatSalesLine, orgWatchlist, parseSalesTags} from '../src/data/orgWatchlist.js';
const real=entries.filter(e=>!e.isDemo);
test('default list isolates demonstration records and never invents verification or heat',()=>{
 const result=filterEntries(entries,{...defaults,nav:'全部动态'});
 assert.equal(result.length,real.length);
 assert.ok(result.every(e=>e.evidence==='待复核'&&e.heatScore===null));
 assert.ok(entries.filter(e=>e.isDemo).every(e=>e.sourceUrl===''&&e.evidence==='演示数据'));
});
test('domestic and case navigation apply actual business filters',()=>{
 const domestic=filterEntries(entries,{...defaults,nav:'国内雷达',demo:'yes'});
 assert.ok(domestic.length>0); assert.ok(domestic.every(e=>e.scope==='国内'));
 const cases=filterEntries(entries,{...defaults,nav:'工程案例',demo:'yes'});
 assert.ok(cases.length>0);assert.ok(cases.every(e=>e.layer==='项目落地'&&['试点','已部署'].includes(e.maturity)));
});
test('calendar windows exclude future and unknown publication dates at China day boundary',()=>{
 const now=new Date('2026-09-07T16:01:00Z');
 assert.equal(inWindow({publishedDate:'2026-09-07'},2,now),true);
 assert.equal(inWindow({publishedDate:'2026-09-06'},2,now),false);
 assert.equal(inWindow({publishedDate:'2026-09-09'},2,now),false);
 assert.equal(inWindow({publishedDate:'未披露'},2,now),false);
 assert.equal(validDate('2026-02-30'),false);
});
test('future events are explicitly classified without relying on publication date',()=>{
 assert.equal(isUpcoming({eventDate:'2026-09-15 至 2026-09-17'},new Date('2026-09-07T00:00:00Z')),true);
 assert.equal(isUpcoming({eventDate:'未披露'},new Date('2026-09-07T00:00:00Z')),false);
});
test('saved and followed lists do not leak unselected entries',()=>{
 const id=real[0].id;
 assert.deepEqual(filterEntries(entries,{...defaults,nav:'收藏'},{saved:[id]}).map(e=>e.id),[id]);
 assert.deepEqual(filterEntries(entries,{...defaults,nav:'我的关注'},{followed:[id]}).map(e=>e.id),[id]);
});
test('date range excludes partial unknown dates, combined filters narrow results',()=>{
 const result=filterEntries(entries,{...defaults,nav:'全部动态',from:'2026-09-02',to:'2026-09-03',scope:'海外',sector:'施工'});
 assert.ok(result.length>0);assert.ok(result.every(e=>validDate(e.publishedDate)&&e.publishedDate>='2026-09-02'&&e.publishedDate<='2026-09-03'&&e.sector==='施工'));
 assert.equal(filterEntries(entries,{...defaults,from:'2026-09-10',to:'2026-09-01'}).length,0);
});
test('exports retain summary and provenance even without a deep report',()=>{
 const text=formatReport([real[0]]);assert.ok(text.includes(real[0].summary));assert.ok(text.includes(real[0].sourceUrl));assert.ok(text.includes('待复核'));
 const demo=entries.find(e=>e.isDemo);assert.ok(formatReport([demo]).includes('演示条目无可引用来源'));
});
test('shared URL restores view, filters and topic identity',()=>{
 const p=new URLSearchParams({nav:'主题库',q:'桥梁',sector:'交通',topic:'bridge',category:'scenarios'});
 const route=readRoute('?'+p);assert.equal(route.nav,'主题库');assert.equal(route.q,'桥梁');assert.equal(route.topic,'bridge');assert.equal(route.demo,'no');
});
test('topic assignments avoid attributing Autodesk news to unrelated institutions',()=>{
 const autodesk=entries.filter(e=>e.id.includes('autodesk'));
 assert.ok(autodesk.every(e=>e.topicIds.includes('autodesk-aec-forma')));
 assert.ok(autodesk.every(e=>!e.topicIds.includes('mwr-digital-twin')&&!e.topicIds.includes('bentley-itwin')));
});
import {parseBackup,mergeDrafts} from '../src/lib/backup.js';
test('backup validation accepts complete records and rejects damaged notes or drafts',()=>{
 const data={version:1,saved:['a'],followed:['a'],notes:{a:{group:'参考',text:'备注'}},seen:{a:'revision'},prefs:{large:true},feedback:[{id:1,date:'2026-09-07',text:'建议',status:'sent',deliveryId:'abc'}]};
 assert.deepEqual(parseBackup(JSON.stringify(data)),data);
 assert.throws(()=>parseBackup(JSON.stringify({...data,notes:{a:3}})));
 assert.throws(()=>parseBackup(JSON.stringify({...data,feedback:[{}]})));
 assert.throws(()=>parseBackup(JSON.stringify({...data,feedback:[{id:1,date:'2026-09-07',text:'建议',status:'bogus'}]})));
 assert.throws(()=>parseBackup('{invalid'));
});
test('draft backup merge does not overwrite existing records',()=>{
 const current=[{id:1,text:'当前'}];const imported=[{id:1,text:'旧稿'},{id:2,text:'新稿'}];
 assert.deepEqual(mergeDrafts(current,imported),[{id:1,text:'当前'},{id:2,text:'新稿'}]);
 assert.equal(current.length,1);
});
import {emptyDocument, mergeGuest, reloadErrorPatch} from '../src/lib/workspace.js';
import {completeVerification} from '../src/lib/evidence.js';
test('verification cannot be inferred from a grade, homepage, or incomplete record',()=>{
 assert.equal(!!completeVerification({status:'verified'}),false);
 const record={status:'verified',reviewer:'编辑',checkedAt:'2026-09-07T09:00:00+08:00',references:[{title:'技术原文',url:'https://example.org/report/1'}]};
 assert.equal(!!completeVerification(record),true);
 assert.equal(!!completeVerification({...record,references:[{title:'官网',url:'https://example.org/'}]}),false);
 assert.equal(!!completeVerification({...record,checkedAt:'未知'}),false);
});
test('collected live articles keep the editorial batch date and skip known source URLs',()=>{
 const seed=[{id:'seed',sourceUrl:'https://example.org/known',title:'seed',summary:'s',source:'s',publishedDate:'2026-09-07',eventDate:'未披露',maturity:'研究',layer:'研究',sector:'施工',scope:'海外',isDemo:false}];
 const live=[{id:'dup',sourceUrl:'https://example.org/known',title:'dup'},{id:'new',sourceUrl:'https://example.org/new',title:'AI construction item',summary:'s',source:'feed',publishedDate:'2026-09-14',eventDate:'未披露',maturity:'待判断',layer:'自动采集',sector:'施工',scope:'海外',dataOrigin:'collector'}];
 const merged=mergeCollected(seed,'2026-09-07',live);
 assert.equal(merged.batchDate,'2026-09-07');
 assert.equal(merged.collectedCount,1);
 assert.equal(merged.collectedEntries[0].id,'new');
 assert.equal(merged.collectedEntries[0].isDemo,false);
 assert.ok(formatReport(seed).includes('数据批次：'+batchDate));
});
test('demo detail routes stay hidden until demo mode is enabled',()=>{
 const demo=entries.find(e=>e.isDemo);
 assert.ok(demo);
 assert.equal(isDetailVisible(demo,'no'),false);
 assert.equal(isDetailVisible(demo,'yes'),true);
 assert.equal(isDetailVisible(entries.find(e=>!e.isDemo),'no'),true);
 assert.equal(isDetailVisible(null,'yes'),false);
});
test('workspace transport errors keep the logged-in document instead of swapping in guest data',()=>{
 const guest=emptyDocument();
 const account={...emptyDocument(),saved:['keep'],notes:{keep:{text:'账号笔记'}}};
 const loggedIn={user:{id:'u1',email:'a@radar.example'},document:account,revision:2,dirty:true,ready:false,status:'连接中',error:'',conflict:null};
 const paused=reloadErrorPatch(loggedIn,{message:'网络中断'},guest,loggedIn.user);
 assert.equal(paused.user.id,'u1');
 assert.deepEqual(paused.document.saved,['keep']);
 assert.equal(paused.status,'同步暂停');
 assert.equal(paused.dirty,true);
 const signedOut=reloadErrorPatch(loggedIn,{status:401,message:'请先登录。'},guest,null);
 assert.equal(signedOut.user,null);
 assert.deepEqual(signedOut.document,guest);
 const firstLoad=reloadErrorPatch({user:null,document:guest,revision:0,dirty:false,ready:false,status:'连接中',error:'',conflict:null},{message:'工作区失败'},guest,{id:'u1',email:'a@radar.example'},account);
 assert.equal(firstLoad.user.id,'u1');
 assert.deepEqual(firstLoad.document.saved,['keep']);
 assert.notEqual(firstLoad.document,guest);
});
test('importing guest data merges lists and reading prefs without overwriting account notes',()=>{
 const account={...emptyDocument(),saved:['a'],notes:{a:{text:'账号'}},prefs:{large:false},feedback:[{id:1,date:'2026-09-07',text:'已有',status:'draft'}]};
 const local={...emptyDocument(),saved:['b'],notes:{a:{text:'游客'},b:{text:'离线'}},prefs:{large:true},feedback:[{id:1,date:'2026-09-07',text:'旧稿',status:'draft'},{id:2,date:'2026-09-07',text:'新稿',status:'draft'}]};
 const merged=mergeGuest(account,local);
 assert.deepEqual([...merged.saved].sort(),['a','b']);
 assert.equal(merged.notes.a.text,'账号');
 assert.equal(merged.notes.b.text,'离线');
 assert.equal(merged.prefs.large,true);
 assert.deepEqual(merged.feedback.map(f=>f.id),[1,2]);
 assert.equal(merged.feedback[0].text,'已有');
});
test('featured, all and hot pools are distinct and never invent heat or homepage sources',()=>{
 const featured=filterEntries(entries,{...defaults,nav:'今日精选'});
 const all=filterEntries(entries,{...defaults,nav:'全部动态'});
 const hot=buildHotEvents(filterEntries(entries,{...defaults,nav:'热点榜'}));
 assert.ok(featured.length>0);
 assert.ok(all.length>featured.length);
 assert.ok(featured.every(isFeatured));
 assert.ok(all.some(e=>!isFeatured(e)));
 assert.ok(hot.length>0 && hot.length<=HOT_LIMIT);
 assert.ok(hot.every(event=>event.sources.every(s=>new URL(s.url).pathname!=='/')));
 assert.ok(entries.every(e=>e.heatScore===null));
 assert.ok(!featured.some(e=>e.id.includes('webinar')||e.id.includes('research-aec')));
 assert.ok(all.some(e=>e.id.includes('webinar')));
});
test('collector items stay out of 今日精选 unless sales score crosses the line',()=>{
 const seed=[{id:'seed',sourceUrl:'https://example.org/known',title:'seed',summary:'s',source:'s',publishedDate:'2026-09-07',eventDate:'未披露',maturity:'研究',layer:'研究',sector:'施工',scope:'海外',isDemo:false,featuredRank:1}];
 const live=[
  {id:'generic',sourceUrl:'https://example.org/generic',title:'AI construction item',summary:'s',source:'feed',publishedDate:'2026-09-14',eventDate:'未披露',maturity:'待判断',layer:'自动采集',sector:'施工',scope:'海外',dataOrigin:'collector'},
  {id:'lead',sourceUrl:'https://example.org/lead',title:'中建三局发布数智化规划并启动智能建造试点',summary:'工程局数字化部门推进数据治理。',source:'中新网即时新闻',publishedDate:'2026-09-17',eventDate:'未披露',maturity:'待判断',layer:'自动采集',sector:'施工',scope:'国内',dataOrigin:'collector',sourceTier:'t2',timelineKind:'discovered'},
 ];
 const merged=mergeCollected(seed,'2026-09-07',live);
 assert.deepEqual(filterEntries(merged.entries,{...defaults,nav:'今日精选'}).map(e=>e.id).sort(),['lead','seed']);
 assert.ok(filterEntries(merged.entries,{...defaults,nav:'全部动态',origin:'采集'}).some(e=>e.id==='generic'));
 const lead=merged.entries.find(e=>e.id==='lead');
 assert.equal(lead.evidence,'待复核');
 assert.equal(lead.featuredRank,undefined);
 assert.equal(lead.heatScore,null);
 assert.equal(lead.salesScore.featured,true);
 assert.ok(lead.salesScore.offerings.includes('咨询'));
});
test('hot events cluster only on an explicit eventId and cap at ten',()=>{
 const list=Array.from({length:12},(_,i)=>({id:'e'+i,eventId:i<2?'shared':undefined,featuredRank:i+1,title:'t'+i,summary:'s',source:'src',sourceUrl:'https://example.org/a/'+i,publishSort:202609010000+i,publishedDate:'2026-09-01',eventDate:'未披露',sector:'施工',evidence:'待复核'}));
 const events=buildHotEvents(list);
 assert.equal(events.length,10);
 assert.equal(events[0].id,'shared');
 assert.equal(events[0].itemCount,2);
 assert.equal(editorialSources({source:'x',sourceUrl:'https://example.org/'}).length,0);
});
test('tied sales scores rank open tenders ahead of award and correction notices',()=>{
 const row=(id,extra)=>({id,title:id,summary:'s',source:'src',sourceUrl:'https://example.org/a/'+id,publishedDate:'2026-09-01',eventDate:'未披露',sector:'施工',evidence:'待复核',dataOrigin:'collector',publishSort:1,...extra});
 const tied={salesScore:{featured:true,total:61}};
 const open=row('open',{...tied,publishSort:1,procurement:{noticeType:'公开招标公告'}});
 const award=row('award',{...tied,publishSort:9,title:'天津交通职业学院人工智能应用平台中标公告',procurement:{noticeClass:'result',noticeType:'中标公告'}});
 const correction=row('correction',{...tied,publishSort:8,title:'更正公告',procurement:{noticeType:'更正公告'}});
 const news=row('news',{...tied,publishSort:7,title:'某项目中标公告解读'});
 const higher=row('higher',{salesScore:{featured:true,total:90},publishSort:0,procurement:{noticeClass:'result',noticeType:'中标公告'}});
 const pinned=row('pinned',{...tied,featuredRank:1,publishSort:0,procurement:{noticeClass:'result',noticeType:'中标公告'}});
 assert.deepEqual([award,news,correction,open].sort(featuredSort).map(e=>e.id),['open','award','correction','news']);
 assert.ok(featuredSort(higher,open)<0);
 assert.ok(featuredSort(pinned,open)<0);
 assert.ok(featuredSort(award,news)<0);
 const hot=buildHotEvents([award,news,correction,open,higher,pinned]);
 assert.deepEqual(hot.map(e=>e.leadId),['higher','pinned','open','award','correction','news']);
 assert.equal(hot.find(e=>e.leadId==='open').noticeClass,'tender');
 assert.equal(hot.find(e=>e.leadId==='award').noticeClass,'result');
 assert.equal(hot.find(e=>e.leadId==='correction').noticeClass,'other');
 assert.equal(hot.find(e=>e.leadId==='news').noticeClass,'');
 assert.equal(hot.find(e=>e.leadId==='news').implication,'');
 const grouped=buildHotEvents([
  row('g-award',{...tied,eventId:'ev',publishSort:5,procurement:{noticeClass:'result'}}),
  row('g-open',{...tied,eventId:'ev',publishSort:1,procurement:{noticeClass:'tender'}}),
 ]);
 assert.equal(grouped[0].leadId,'g-open');
 assert.equal(grouped[0].noticeClass,'tender');
 assert.equal(grouped[0].itemCount,2);
 const scored=buildHotEvents([
  row('g2-award',{salesScore:{featured:true,total:80},eventId:'ev2',procurement:{noticeClass:'result'}}),
  row('g2-open',{salesScore:{featured:true,total:61},eventId:'ev2',procurement:{noticeClass:'tender'}}),
 ]);
 assert.equal(scored[0].leadId,'g2-award');
 assert.equal(scored[0].noticeClass,'result');
});
import {scoreArticle} from '../src/lib/scoring.js';
import {timelineFields} from '../src/lib/timeline.js';
test('slow sources use 收录 time within 72h and backfill stays on publication day',()=>{
 const now=new Date('2026-09-07T16:01:00Z');
 const slow={publishedDate:'2026-09-05',publishedAt:'2026-09-05T02:00:00.000Z',firstSeenAt:'2026-09-07T16:01:00.000Z',...timelineFields({publishedAt:'2026-09-05T02:00:00.000Z',firstSeenAt:'2026-09-07T16:01:00.000Z'})};
 assert.equal(slow.timelineKind,'discovered');
 assert.equal(inWindow(slow,1,now),true);
 assert.equal(timelineDay(slow),'2026-09-08');
 const backfill={publishedDate:'2026-08-01',publishedAt:'2026-08-01T00:00:00.000Z',firstSeenAt:'2026-09-07T16:01:00.000Z',...timelineFields({publishedAt:'2026-08-01T00:00:00.000Z',firstSeenAt:'2026-09-07T16:01:00.000Z'})};
 assert.equal(backfill.timelineKind,'backfill');
 assert.equal(inWindow(backfill,2,now),false);
 const unknown={publishedDate:'未披露',firstSeenAt:'2026-09-07T16:01:00.000Z',...timelineFields({firstSeenAt:'2026-09-07T16:01:00.000Z'})};
 assert.equal(inWindow(unknown,1,now),true);
 const groups=groupByDay([slow,backfill]);
 assert.equal(groups[0].day,'2026-09-08');
 assert.equal(groups[0].items[0],slow);
});
test('sales scores rank buyer-offering leads above vendor blogs and never invent verification',()=>{
 const lead=scoreArticle({title:'中建三局发布数智化规划并启动智能建造试点',summary:'数据治理与数字化部门。',sourceTier:'t2',timelineKind:'discovered'});
 const vendor=scoreArticle({title:'Autodesk Construction Copilot launch',summary:'AI construction digital twin BIM',source:'Autodesk Construction',sourceId:'autodesk-construction',sourceTier:'t1',timelineKind:'discovered'});
 const paper=scoreArticle({title:'Deep learning for bridge inspection',summary:'A review paper.',source:'MDPI Buildings',sourceId:'mdpi-buildings',sourceUrl:'https://www.mdpi.com/x',sourceTier:'t1',layer:'研究'});
 const translation=scoreArticle({title:'Breaking down language barriers to share global best practice',summary:'FIDIC overseas project translation.',source:'Global Construction Review',sourceTier:'t2',timelineKind:'discovered'});
 const academic=scoreArticle({title:'智能建造知识库',summary:'中建三局试验。',academic:true,layer:'研究',sourceId:'crossref-cn-civil',sourceTier:'t1'});
 assert.ok(lead.total>vendor.total);
 assert.equal(lead.featured,true);
 assert.equal(lead.suggestFeatured,true);
 assert.equal(lead.salesStage,'了解需求');
 assert.equal(vendor.featured,false);
 assert.equal(paper.featured,false);
 assert.equal(academic.featured,false);
 assert.equal(translation.featured,true);
 assert.ok(translation.offerings.includes('翻译'));
 assert.equal(lead.featuredRank,undefined);
 assert.equal(lead.priority,'P0');
 assert.equal(vendor.priority,'P2');
 assert.equal(paper.priority,'P3');
 assert.equal(translation.priority,'P1');
 assert.equal(scoreArticle({title:'AI for construction',summary:'AI construction.',sourceTier:'t2'}).priority,'P3');
 const merged=mergeCollected([{id:'seed',sourceUrl:'https://example.org/known',title:'seed',summary:'s',source:'s',publishedDate:'2026-09-07',eventDate:'未披露',maturity:'研究',layer:'研究',sector:'施工',scope:'海外',isDemo:false}],'2026-09-07',[{id:'scored',sourceUrl:'https://example.org/new',title:'AI construction',summary:'s',source:'feed',publishedDate:'2026-09-05',eventDate:'未披露',maturity:'待判断',layer:'自动采集',sector:'施工',scope:'海外',dataOrigin:'collector',assistScore:vendor,heatScore:null}]);
 assert.equal(merged.collectedEntries[0].heatScore,null);
 assert.equal(merged.collectedEntries[0].evidence,'待复核');
 const ranked=mergeCollected(
  [{id:'vendor-pin',sourceUrl:'https://example.org/v',title:'Autodesk Construction Copilot launch',summary:'AI construction digital twin BIM',source:'Autodesk Construction',sourceId:'autodesk-construction',publishedDate:'2026-09-01',eventDate:'未披露',maturity:'预告',layer:'行业活动',sector:'施工',scope:'海外',featuredRank:1,publishSort:1}],
  '2026-09-17',
  [{id:'lead',sourceUrl:'https://example.org/lead-hot',title:'中建三局发布数智化规划并启动智能建造试点',summary:'数据治理与数字化部门。',source:'中新网即时新闻',publishedDate:'2026-09-17',eventDate:'未披露',maturity:'待判断',layer:'自动采集',sector:'施工',scope:'国内',dataOrigin:'collector',sourceTier:'t2',timelineKind:'discovered',publishSort:2}]
 );
 const hot=buildHotEvents(ranked.entries);
 assert.equal(hot[0].leadId,'lead');
});
test('sales watchlist keeps unique units (demo catalog) and tags stay manual',()=>{
 assert.equal(orgWatchlist.length,11);
 assert.equal(new Set(orgWatchlist.map(item=>item.id)).size,11);
 assert.equal(parseSalesTags({offerings:['咨询','知识库'],buyerRole:'工程局',salesStage:'了解需求',watchOrgId:'u-cscec3b'}).watchOrgId,'u-cscec3b');
 assert.equal(parseSalesTags({offerings:['咨询','不相关']}).error.includes('不相关'),true);
 assert.equal(parseSalesTags({offerings:['不相关'],salesStage:'可破冰'}).error.includes('可破冰'),true);
 assert.equal(parseSalesTags({offerings:['翻译'],salesStage:'可破冰',watchOrgId:'m-glodon'}).error.includes('不是买家'),true);
 assert.equal(parseSalesTags({watchOrgId:'中建'}).error.includes('观察单位'),true);
 assert.equal(formatSalesLine({watchOrgId:'o-chec',offerings:['翻译','咨询'],buyerRole:'海外项目',salesStage:'了解需求'}),'中国港湾 · 翻译、咨询 · 海外项目 · 了解需求');
});
test('review lanes archive papers, extract P0/P1, and reject invented metrics or ice-break claims',()=>{
 const paper=applyLane({title:'Deep learning for bridge inspection',summary:'A review paper.',source:'MDPI Buildings',sourceId:'mdpi-buildings',sourceUrl:'https://www.mdpi.com/x',layer:'研究'});
 assert.equal(paper.assistScore.priority,'P3');
 assert.equal(paper.editorial.status,'archived');
 assert.equal(paper.machineReview,undefined);
 const lead=applyLane({title:'中建三局发布数智化规划并启动智能建造试点',summary:'数据治理与数字化部门。',sourceTier:'t2',timelineKind:'discovered'});
 assert.equal(lead.assistScore.priority,'P0');
 assert.equal(lead.machineReview.status,'ready');
 assert.notEqual(lead.editorial?.status,'archived');
 const vendor=applyLane({title:'Autodesk Construction Copilot launch',summary:'AI construction digital twin BIM',source:'Autodesk Construction',sourceId:'autodesk-construction'});
 assert.equal(vendor.assistScore.priority,'P2');
 assert.notEqual(vendor.editorial?.status,'archived');
 const cleaned=sanitizeMachineReview({
  summary:'准确率 98%，见 https://evil.example/a',
  implication:'可破冰，该局已采购。',
  offerings:['咨询'],
  salesStage:'可破冰',
  needsHuman:false,
 }, lead.assistScore, lead);
 assert.equal(cleaned.salesStage,'了解需求');
 assert.doesNotMatch(cleaned.summary,/98|https?:/i);
 assert.equal(cleaned.needsHuman,true);
 assert.equal(recommendReason({dataOrigin:'collector',reviewed:false,machineReview:{implication:'若属实，可能对上咨询。'},salesScore:{reason:'自动评分'}}).kind,'machine');
 assert.equal(recommendReasonLabel('auto'),'自动评分理由');
 assert.equal(recommendReasonLabel('machine'),'机器整理');
 assert.equal(recommendReasonLabel('editorial'),'推荐理由');
 assert.equal(recommendReasonLabel(''),'');
 const withReason=buildHotEvents([{id:'reasoned',featuredRank:1,title:'t',summary:'s',source:'src',sourceUrl:'https://example.org/a/reason',publishSort:1,publishedDate:'2026-09-01',eventDate:'未披露',sector:'施工',evidence:'待复核',dataOrigin:'collector',salesScore:{reason:'命中买家与咨询切口',featured:true,total:80}}]);
 assert.equal(withReason[0].implication,'命中买家与咨询切口');
 assert.equal(withReason[0].recommendKind,'auto');
 const withoutReason=buildHotEvents([{id:'bare',featuredRank:1,title:'t2',summary:'s',source:'src',sourceUrl:'https://example.org/a/bare',publishSort:1,publishedDate:'2026-09-01',eventDate:'未披露',sector:'施工',evidence:'待复核',dataOrigin:'collector'}]);
 assert.equal(withoutReason[0].implication,'');
 const approved=applyLane({...lead,editorial:{status:'approved',reviewer:'admin@example.test'}});
 assert.equal(approved.editorial.status,'approved');
});
test('manual intake and procurement records carry honest origins and reading labels',()=>{
 const manual={id:'x1',title:'中建三局发布大模型平台',sourceUrl:'https://mp.weixin.qq.com/s/a',dataOrigin:'manual',scope:'国内',sector:'施工',evidence:'待复核',publishedDate:'2026-09-17'};
 const procured={id:'x2',title:'智能建造知识库采购招标公告',sourceUrl:'https://www.ccgp.gov.cn/cggg/x.htm',dataOrigin:'collector',scope:'国内',sector:'施工',evidence:'待复核',publishedDate:'2026-09-17'};
 assert.equal(entryOrigin(manual),'登记');
 assert.equal(entryOrigin(procured),'采集');
 assert.deepEqual(filterEntries([manual,procured],{...defaults,nav:'全部动态',origin:'登记'}).map(e=>e.id),['x1']);
 assert.deepEqual(filterEntries([manual,procured],{...defaults,nav:'全部动态',origin:'采集'}).map(e=>e.id),['x1','x2']);
 assert.deepEqual(filterEntries([manual,procured],{...defaults,nav:'全部动态',origin:'入库'}),[]);
 assert.equal(readingKindLabel('manual-clip'),'人工摘录');
 assert.equal(readingKindLabel('procurement-notice'),'政采公告摘要');
});
