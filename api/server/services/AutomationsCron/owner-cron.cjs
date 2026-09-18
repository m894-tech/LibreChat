'use strict';
const fs = require('node:fs');
const path = require('node:path');
const JOBS_FILE = process.env.MCP_CRON_JOBS_FILE || '/opt/librechat-mcp/mcp/artifacts/cron/jobs.json';
const SCRIPTS_DIR = process.env.MCP_CRON_SCRIPTS_DIR || '/opt/librechat-mcp/mcp/scripts/cron';
const TARGETS = ['session_reminder','session_todo','session_note','script','webhook','resume_conversation'];
const HEARTBEAT_FILE = process.env.MCP_CRON_HEARTBEAT || '/opt/librechat-mcp/mcp/artifacts/cron/heartbeat.json';
function executorHealth(now = Date.now()) {
  try {
    const raw = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
    const ts = Date.parse(raw.ts || '');
    if (!Number.isFinite(ts)) return { healthy: false, lag_ms: null };
    const lag = now - ts;
    return { healthy: lag <= 60000, lag_ms: lag };
  } catch {
    return { healthy: false, lag_ms: null };
  }
}
function normalizeOwner(raw){const s=String(raw||'').trim();if(!s||/^\{\{/.test(s)||s==='undefined'||s==='null')return'';return /^[a-zA-Z0-9._-]{1,128}$/.test(s)?s:''}
function isOwnerOf(job,owner){const value=normalizeOwner(owner);return !!value&&normalizeOwner(job?.userId)===value}
function safePayload(job){
  const p=job?.payload&&typeof job.payload==='object'?job.payload:{};
  if(job.targetType==='webhook')return {url:p.url||null,data:p.data||{}};
  if(job.targetType==='script')return {script:p.script||null,args:Array.isArray(p.args)?p.args:[]};
  if(job.targetType==='session_note')return {key:p.key||null,value:p.value||null};
  return {text:p.text||null,generate:p.generate===true};
}
function toView(job){
  return {id:job.id,name:job.name,source:'cron',target_type:job.targetType,payload:safePayload(job),agent_config:job.agentConfig||null,
    secret_bindings:Array.isArray(job.secretBindings)?job.secretBindings.map(({value,...b})=>b):[],schedule:job.scheduleInfo||job.schedule||null,
    schedule_raw:job.schedule||null,is_recurring:!!job.isRecurring,status:job.status,next_run_at:job.nextRunAt||null,last_run_at:job.lastRunAt||null,
    run_count:job.runCount||0,max_runs:job.maxRuns??null,tz:job.tz||'Europe/Moscow',conversation_id:job.conv||null,owned_by_user:!!normalizeOwner(job.userId),
    in_flight:!!job.inFlight,ended_reason:job.endedReason||null,success_count:job.successCount||0,retry_count:job.retryCount||0,last_runs:Array.isArray(job.history)?job.history.slice(0,20).map(h=>({run_id:h.runId||null,run_at:h.runAt||null,trigger:h.trigger||null,status:h.status||null,kind:h.kind||null,stage:h.stage||null,generated:h.generated===undefined?null:h.generated===true,error:h.error||null,duration_ms:h.durationMs??null,output:typeof h.output==='string'?h.output.slice(0,500):null,response_message_id:h.responseMessageId||null})):[]};
}
function loadJobs(){try{const parsed=JSON.parse(fs.readFileSync(JOBS_FILE,'utf8'));return Array.isArray(parsed)?parsed:[]}catch{return[]}}
function listOwnerCron(owner){const value=normalizeOwner(owner);return value?loadJobs().filter(j=>isOwnerOf(j,value)).map(toView):[]}
function getOwnerCron(owner,id){const value=normalizeOwner(owner);if(!value||!id)return null;const j=loadJobs().find(x=>x.id===id&&isOwnerOf(x,value));return j?toView(j):null}
function listByConv(owner,conv,statuses){const value=normalizeOwner(owner);const convId=String(conv||'').trim();if(!value||!convId)return[];const allow=Array.isArray(statuses)&&statuses.length?new Set(statuses):null;return loadJobs().filter(j=>isOwnerOf(j,value)&&String(j.conv||'')===convId&&(!allow||allow.has(j.status))).map(toView)}
function listScripts(){try{return fs.readdirSync(SCRIPTS_DIR,{withFileTypes:true}).filter(x=>x.isFile()&&/^[a-zA-Z0-9._-]{1,120}$/.test(x.name)).map(x=>x.name).sort()}catch{return[]}}
function capabilities(owner,{isHost=false,native=null}={}){const yes=!!normalizeOwner(owner);return {user_scoped:yes,sources:{cron:{supported:true,action_types:{resume_conversation:yes,session_todo:yes,session_note:yes,session_reminder:yes,script:yes&&isHost,webhook:yes&&isHost},schedule_kinds:['once_timestamp','relative','cron_expr'],commands:{list:true,status:true,create:yes,pause:yes,resume:yes,cancel:yes,run_now:yes},history_depth:20,limits:{resume_max_runs:24,resume_min_interval_minutes:5},agent_features:{generate:true,mcp:true,skills:true,write_tools:false},secret_features:{supported:isHost,targets:isHost?['script','webhook']:[],destinations:isHost?['env','header']:[]}},native:native||{supported:false,api_enabled:false}}}}
module.exports={listOwnerCron,getOwnerCron,listByConv,executorHealth,capabilities,isOwnerOf,normalizeOwner,toView,listScripts,TARGETS};
