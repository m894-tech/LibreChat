'use strict';
const { isMcpHostUser, filterMcpServersForUser, isWriteExecTool } = require('~/server/services/AutomationsCron/mcpHost.cjs');
const BLOCKED_AUTOMATION_SERVERS = new Set(['cron','shell','filesystem','git','dropbox','onepassword','playwright','mac','windows','github-thin','monetka-mail']);
function serverFromTool(name){const s=String(name||'');const marker='_mcp_';const i=s.lastIndexOf(marker);return i>=0?s.slice(i+marker.length):null}
async function buildCatalogs({owner,mcpTools={},skills=[],scripts=[],nativeProfiles=[]}){
 const requested=Object.keys(mcpTools.servers||{});const allowed=new Set(filterMcpServersForUser(owner,requested));
 const servers=[];for(const name of requested){if(!allowed.has(name)||BLOCKED_AUTOMATION_SERVERS.has(name))continue;const raw=mcpTools.servers[name]||{};const tools=(raw.tools||[]).map(t=>({name:t.name,description:t.description||'',write_or_exec:isWriteExecTool(t.name),available_for_automation:!isWriteExecTool(t.name)}));servers.push({name,title:raw.name||name,authenticated:raw.authenticated!==false,tools})}
 const skillItems=(skills||[]).filter(s=>s&&s.name&&s.userInvocable!==false).map(s=>({id:s._id,name:s.name,title:s.displayTitle||s.name,description:s.description||'',version:s.version||1,always_apply:s.alwaysApply===true}));
 return {mcp:{servers},skills:skillItems,scripts:isMcpHostUser(owner)?scripts:[],native_profiles:nativeProfiles,secret_bindings:{supported:isMcpHostUser(owner),provider:isMcpHostUser(owner)?'onepassword':null,destinations:isMcpHostUser(owner)?['header','env']:[]}};
}
module.exports={buildCatalogs,serverFromTool};
