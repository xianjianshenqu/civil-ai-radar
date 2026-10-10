// 示例观察名单（演示数据）：仅用于展示数据结构、关键词计分与人工复核链路，
// 名单成员与业务切口标注不代表任何真实商业判断。请按自身业务整表替换。
// 关键词命中只是计分线索，绝不构成该单位参与某项目的证据。
export const OFFERING_OPTIONS = [
  {id:'咨询', label:'组织落地咨询'},
  {id:'知识库', label:'AI 知识库'},
  {id:'翻译', label:'AI 翻译'},
  {id:'算量', label:'AI 工程算量'},
  {id:'培训', label:'AI 企业培训'},
  {id:'不相关', label:'不相关'},
];
export const PRODUCT_OFFERINGS = ['咨询','知识库','翻译','算量','培训'];
export const OFFERINGS = new Set([...PRODUCT_OFFERINGS, '不相关']);
export const BUYER_ROLES = ['未知','集团数智','设计院','工程局','商务造价','海外项目','主管部门','培训主办','专业单位','市场观察'];
export const SALES_STAGES = ['待判断','了解需求','可破冰','已有供应商需谨慎','仅市场观察'];
export const WATCH_LAYERS = [
  {id:'group', label:'集团总部'},
  {id:'unit', label:'局院'},
  {id:'overseas', label:'海外事业部'},
  {id:'standard', label:'标准与大赛'},
  {id:'market', label:'市场观察'},
];

function org(id, name, layer, offerings, secondary, buyerRole, isBuyer, aliases = []) {
  return {id, name, layer, offerings, secondary, buyerRole, isBuyer, aliases};
}

// 演示名单覆盖全部 WATCH_LAYERS 与 isBuyer 两种取值；正式使用请替换为你自己的观察单位。
export const orgWatchlist = [
  org('g-cscec','中国建筑','group',['咨询'],[],'集团数智',true,['中国建筑集团','China State Construction','CSCEC']),
  org('g-crec','中国中铁','group',['知识库'],[],'集团数智',true,['中国中铁股份','CREC']),
  org('g-crcc','中国铁建','group',['咨询'],[],'集团数智',true,['中国铁建股份','CRCC']),
  org('g-sgcc','国家电网','group',['知识库'],[],'集团数智',true,['国网','State Grid','SGCC']),
  org('g-sinopec','中国石化','group',['翻译'],[],'集团数智',true,['中石化','Sinopec']),
  org('g-petrochina','中国石油','group',['知识库'],[],'集团数智',true,['中石油','中国石油天然气集团','PetroChina']),
  org('u-cscec3b','中建三局','unit',['咨询'],[],'工程局',true,['CSCEC Third']),
  org('u-fsdi','中铁第一勘察设计院','unit',['知识库'],[],'设计院',true,['中铁一院','FSDI']),
  org('o-chec','中国港湾','overseas',['翻译'],[],'海外项目',true,['CHEC']),
  org('s-mohurd','住房城乡建设部','standard',['咨询'],[],'主管部门',true,['住房和城乡建设部','住建部','MOHURD']),
  org('m-glodon','广联达','market',['算量'],[],'市场观察',false,['Glodon']),
];

export const orgWatchById = Object.fromEntries(orgWatchlist.map(item => [item.id, item]));
export const WATCH_ORG_IDS = new Set(orgWatchlist.map(item => item.id));

export function offeringLabel(id) {
  return OFFERING_OPTIONS.find(item => item.id === id)?.label || id;
}

// extraOrgs：界面新增的附加观察单位（服务端传入）；静态名单之外的人工扩展，同样只是计分线索。
export function parseSalesTags(input, extraOrgs = []) {
  const out = {};
  const extraById = new Map(extraOrgs.map(item => [item.id, item]));
  if (input.offerings !== undefined) {
    if (!Array.isArray(input.offerings) || input.offerings.length > 5 || !input.offerings.every(id => OFFERINGS.has(id))) {
      return {error:'业务切口需从咨询、知识库、翻译、算量、培训或不相关中选择，最多 5 个。'};
    }
    const offerings = [...new Set(input.offerings)];
    if (offerings.includes('不相关') && offerings.length > 1) return {error:'选择不相关时不要同时勾选产品切口。'};
    out.offerings = offerings;
  }
  if (input.buyerRole !== undefined) {
    if (!BUYER_ROLES.includes(input.buyerRole)) return {error:'买家角色无效。'};
    out.buyerRole = input.buyerRole;
  }
  if (input.salesStage !== undefined) {
    if (!SALES_STAGES.includes(input.salesStage)) return {error:'销售阶段无效。'};
    out.salesStage = input.salesStage;
  }
  if (input.watchOrgId !== undefined) {
    const watchOrgId = typeof input.watchOrgId === 'string' ? input.watchOrgId.trim() : '';
    if (watchOrgId && !WATCH_ORG_IDS.has(watchOrgId) && !extraById.has(watchOrgId)) return {error:'观察单位需从名单中选择，或留空。原文未点名时不要填写。'};
    out.watchOrgId = watchOrgId;
  }
  const offerings = out.offerings || [];
  const salesStage = out.salesStage;
  const org = orgWatchById[out.watchOrgId] || extraById.get(out.watchOrgId);
  if (salesStage === '可破冰') {
    if (!offerings.some(id => PRODUCT_OFFERINGS.includes(id))) return {error:'可破冰需要至少选择一个产品切口，且不能是不相关。'};
    if (org && !org.isBuyer) return {error:'该观察对象不是买家，销售阶段不能标为可破冰。'};
  }
  return out;
}

export function formatSalesLine(editorial = {}, extraOrgs = []) {
  const org = orgWatchById[editorial.watchOrgId] || extraOrgs.find(item => item.id === editorial.watchOrgId);
  const bits = [];
  if (org) bits.push(org.name);
  if (editorial.offerings?.length) bits.push(editorial.offerings.join('、'));
  if (editorial.buyerRole && editorial.buyerRole !== '未知') bits.push(editorial.buyerRole);
  if (editorial.salesStage && editorial.salesStage !== '待判断') bits.push(editorial.salesStage);
  return bits.join(' · ');
}

export function salesCatalog() {
  return {
    offerings: OFFERING_OPTIONS,
    buyerRoles: BUYER_ROLES,
    salesStages: SALES_STAGES,
    layers: WATCH_LAYERS,
    orgs: orgWatchlist.map(({id,name,layer,offerings,secondary,buyerRole,isBuyer}) => ({id,name,layer,offerings,secondary,buyerRole,isBuyer})),
  };
}
