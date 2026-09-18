import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** …/SessionMenu/__tests__ → …/components */
const componentsRoot = join(__dirname, '../../../..');
/** …/SessionMenu/__tests__ → …/src */
const srcRoot = join(__dirname, '../../../../..');

describe('Skills Manage destination wiring', () => {
  it('SessionSkillsSection Manage closes the sheet, opens the sidebar, and routes to /skills', () => {
    const source = readFileSync(join(__dirname, '../SessionSkillsSection.tsx'), 'utf8');
    expect(source).toContain("navigate('/skills')");
    expect(source).toContain('setSheetOpen(false)');
    expect(source).toContain('setSidebarOpen(true)');
    expect(source).toContain('session-skills-manage');
  });

  it('SkillsView /skills renders an in-page catalog (not Select-a-skill empty)', () => {
    const source = readFileSync(join(componentsRoot, 'Skills/layouts/SkillsView.tsx'), 'utf8');
    expect(source).toContain('skills-management-catalog');
    expect(source).toContain('SkillsSidePanel');
    expect(source).toContain('alwaysActive');
    expect(source).not.toContain('com_ui_skill_no_selection');
  });

  it('sidebar skills rail is gated by SKILLS USE, not agent skills capability', () => {
    const source = readFileSync(join(srcRoot, 'hooks/Nav/useSideNavLinks.ts'), 'utf8');
    expect(source).toContain("id: 'skills'");
    expect(source).toContain('hasAccessToSkills');
    expect(source).not.toMatch(/hasAccessToSkills\s*&&\s*skillsEnabled/);
    expect(source).not.toContain('useAgentCapabilities');
  });
});
