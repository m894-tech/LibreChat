'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const { requireJwtAuth } = require('~/server/middleware');
const { isMcpHostUser } = require('~/server/services/AutomationsCron/mcpHost.cjs');
const { listOwnerCron,getOwnerCron,listByConv,executorHealth,capabilities,listScripts,toView } = require('~/server/services/AutomationsCron/owner-cron.cjs');
const { buildCatalogs } = require('~/server/services/AutomationsCron/catalogs.cjs');
const { getMCPTools } = require('~/server/controllers/mcp');
const { getSkillDbMethods, withDeploymentSkillIds } = require('~/server/services/Endpoints/agents/skillDeps');
const { findAccessibleResources, findPubliclyAccessibleResources } = require('~/server/services/PermissionService');
const { ResourceType, PermissionBits } = require('librechat-data-provider');
const CORE_PATH=process.env.MCP_CRON_CORE_PATH||'/opt/librechat-mcp/mcp/servers/cron-core.mjs';
let corePromise;
const core=()=>corePromise??=(import(pathToFileURL(CORE_PATH).href));
const router=express.Router();
router.use(requireJwtAuth,express.json({limit:'32kb',strict:true}));
router.use((req,res,next)=>{if(typeof req.user?.id!=='string'||!req.user.id)return res.status(401).json({error:'unauthorized'});res.set('Cache-Control','no-store');next()});
const wrap=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
function nativeCapabilities(req){const ready=req.app.locals.automationsNative;return ready?.capabilities?ready.capabilities(req.user.id):{supported:process.env.AUTOMATIONS_API_ENABLED==='true',api_enabled:process.env.AUTOMATIONS_API_ENABLED==='true',worker_ready:false}}
router.get('/capabilities',wrap(async(req,res)=>res.json(capabilities(req.user.id,{isHost:isMcpHostUser(req.user.id),native:await nativeCapabilities(req)}))));
router.get('/scripts',(req,res)=>isMcpHostUser(req.user.id)?res.json({items:listScripts()}):res.status(403).json({error:'forbidden'}));
router.get('/catalogs',wrap(async(req,res)=>{
  let mcpTools={servers:{}};
  const capture={statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
  await getMCPTools(req,capture);
  if(capture.statusCode===200&&capture.body)mcpTools=capture.body;
  const [ownedIds,publicIds]=await Promise.all([
    findAccessibleResources({userId:req.user.id,role:req.user.role,resourceType:ResourceType.SKILL,requiredPermissions:PermissionBits.VIEW}),
    findPubliclyAccessibleResources({resourceType:ResourceType.SKILL,requiredPermissions:PermissionBits.VIEW}),
  ]);
  const accessible=withDeploymentSkillIds(Array.from(new Map([...ownedIds,...publicIds].map((id)=>[id.toString(),id])).values()));
  const skillPage=await getSkillDbMethods().listSkillsByAccess({accessibleIds:accessible,limit:100,cursor:null});
  const native=await nativeCapabilities(req);
  res.json(await buildCatalogs({owner:req.user.id,mcpTools,skills:skillPage?.skills||[],scripts:listScripts(),nativeProfiles:native?.profiles||[]}));
}));
router.get('/by-conv/:conv',wrap(async(req,res)=>{const rows=listByConv(req.user.id,req.params.conv,['active','paused']);res.json({items:rows,count:rows.length,executor:executorHealth()})}));
router.post('/by-conv/:conv/actions',wrap(async(req,res)=>{const {id,action}=req.body||{};if(!id||!['pause','resume','cancel'].includes(action))return res.status(400).json({error:'bad_request'});const owned=getOwnerCron(req.user.id,id);if(!owned||String(owned.conversation_id||'')!==String(req.params.conv))return res.status(404).json({error:'not_found'});const c=await core();const job=await c.mutateOwnedCronJob(req.user.id,id,action);if(!job)return res.status(404).json({error:'not_found'});res.json(toView(job))}));
router.get('/',(req,res)=>{const rows=listOwnerCron(req.user.id);res.json({items:rows,count:rows.length,source:'cron'})});
router.post('/',wrap(async(req,res)=>{
  if(req.body?.target_type==='resume_conversation'&&req.body?.agent_config){
    const catalogs=await (async()=>{let mcpTools={servers:{}};const capture={statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};await getMCPTools(req,capture);if(capture.statusCode===200&&capture.body)mcpTools=capture.body;const [ownedIds,publicIds]=await Promise.all([findAccessibleResources({userId:req.user.id,role:req.user.role,resourceType:ResourceType.SKILL,requiredPermissions:PermissionBits.VIEW}),findPubliclyAccessibleResources({resourceType:ResourceType.SKILL,requiredPermissions:PermissionBits.VIEW})]);const accessible=withDeploymentSkillIds(Array.from(new Map([...ownedIds,...publicIds].map(id=>[id.toString(),id])).values()));const skillPage=await getSkillDbMethods().listSkillsByAccess({accessibleIds:accessible,limit:100,cursor:null});return buildCatalogs({owner:req.user.id,mcpTools,skills:skillPage?.skills||[],scripts:listScripts(),nativeProfiles:[]})})();
    const serverMap=new Map(catalogs.mcp.servers.map(s=>[s.name,s]));
    const requestedServers=req.body.agent_config.mcpServers||[];const requestedTools=req.body.agent_config.mcpTools||[];const requestedSkills=req.body.agent_config.skills||[];
    if(requestedServers.some(name=>!serverMap.has(name)))throw new Error('requested_mcp_not_available');
    const allowedTools=new Set(catalogs.mcp.servers.flatMap(s=>s.tools.filter(t=>t.available_for_automation).map(t=>t.name)));
    if(requestedTools.some(name=>!allowedTools.has(name)))throw new Error('requested_tool_not_available');
    const allowedSkills=new Set(catalogs.skills.map(s=>s.name));if(requestedSkills.some(name=>!allowedSkills.has(name)))throw new Error('requested_skill_not_available');
  }
  const c=await core();const job=await c.createOwnedCronJob(req.user.id,req.body,{allowHostActions:isMcpHostUser(req.user.id)});res.status(201).json(toView(job))
}));
router.get('/:id',(req,res)=>{const row=getOwnerCron(req.user.id,req.params.id);if(!row)return res.status(404).json({error:'not_found'});res.json(row)});
router.post('/:id/actions/:action',wrap(async(req,res)=>{if(!['pause','resume','cancel'].includes(req.params.action))return res.status(400).json({error:'unsupported_action'});const c=await core();const job=await c.mutateOwnedCronJob(req.user.id,req.params.id,req.params.action);if(!job)return res.status(404).json({error:'not_found_or_busy'});res.json(toView(job))}));
router.post('/:id/runs',wrap(async(req,res)=>{const key=req.get('Idempotency-Key');const c=await core();const out=await c.runOwnedCronJobNow(req.user.id,req.params.id,key);if(!out)return res.status(404).json({error:'not_found'});res.status(out.duplicate?200:202).json(out)}));
router.use((err,req,res,next)=>{if(res.headersSent)return next(err);const code=String(err?.message||'internal_error');const status=code.includes('forbidden')?403:code.includes('not_found')?404:code.includes('active')||code.includes('state_')?409:400;res.status(status).json({error:code})});
module.exports=router;
