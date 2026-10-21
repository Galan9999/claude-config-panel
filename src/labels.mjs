// What each thing is called in the interface. A file named `settings.local.json`
// tells nobody anything; "Project-local settings" does.

/** @returns {[title: string, description: string]} */
export function describeConfig(file, isGlobal) {
  if (file === 'CLAUDE.md') return isGlobal
    ? ['Standing instructions (global)', 'Rules Claude reads in every session, whatever project you are in. Your style guide with it.']
    : ['Project instructions', 'Rules Claude reads only when working on this project: conventions, commands, things it must not touch.'];
  if (file === 'settings.json') return isGlobal
    ? ['Global settings', 'The baseline for every project: permissions, hooks, appearance. Anything you set in a project overrides this.']
    : ['Project settings', 'Versioned in git, so the whole team shares it. What holds for anyone working here.'];
  if (file === 'settings.local.json') return isGlobal
    ? ['Private global settings', 'Like the global ones, but yours only. Useful for permissions you would rather not make permanent.']
    : ['Project-local settings', 'Yours only: it is in .gitignore and the team never sees it. Your personal preferences in this repo.'];
  return [file, ''];
}

export const KIND_INFO = {
  config:  { label: 'Settings',  one: 'setting', icon: '⚙',  blurb: 'Permissions, hooks and preferences. The global ones apply everywhere; each project refines them.' },
  skill:   { label: 'Skills',    one: 'skill',   icon: '◆',  blurb: 'Instructions Claude loads only when they are needed. Their description is what decides whether they fire at all.' },
  agent:   { label: 'Agents',    one: 'agent',   icon: '◇',  blurb: 'Subagents with their own context and their own tools, for delegating bounded work.' },
  command: { label: 'Commands',  one: 'command', icon: '/',  blurb: 'The ones you invoke yourself with a slash. They always do the same thing, without depending on Claude deciding to.' },
  hook:    { label: 'Hooks and scripts', one: 'script', icon: '⚡', blurb: 'What runs on its own, without asking you, when an event happens. The piece most worth reviewing.' },
  task:    { label: 'Scheduled tasks', one: 'task', icon: '◷', blurb: 'Fired by the calendar, while you are not there.' },
};
