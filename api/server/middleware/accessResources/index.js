const { canAccessResource } = require('./canAccessResource');
const { canAccessAgentResource } = require('./canAccessAgentResource');
const { canAccessAgentFromBody } = require('./canAccessAgentFromBody');
const { canAccessPromptViaGroup } = require('./canAccessPromptViaGroup');
const { canAccessPromptGroupResource } = require('./canAccessPromptGroupResource');
const { canAccessMCPServerResource } = require('./canAccessMCPServerResource');
const { canAccessCodeEnvironmentResource } = require('./canAccessCodeEnvironmentResource');
const { canAccessSkillResource } = require('./canAccessSkillResource');

module.exports = {
  canAccessResource,
  canAccessAgentResource,
  canAccessAgentFromBody,
  canAccessPromptViaGroup,
  canAccessPromptGroupResource,
  canAccessMCPServerResource,
  canAccessCodeEnvironmentResource,
  canAccessSkillResource,
};
