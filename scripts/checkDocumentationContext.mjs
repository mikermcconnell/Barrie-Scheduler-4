import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realWorkspaceRoot = realpathSync(workspaceRoot);

const excludedRelativePrefixes = [
  '.git/',
  '.tmp/',
  '.worktrees/',
  'build/',
  'dist/',
  'node_modules/',
  'temp/',
  'docs/archive/',
  'docs/artifacts/',
  'docs/plans/',
  'docs/route-planner-legacy/',
  'docs/superpowers/plans/',
];

const excludedRelativeFiles = new Set([
  'docs/DWELL_CASCADE_PLAN.md',
  'docs/IMPLEMENTATION_PLAN.md',
  'docs/SCHEDULE_EDITOR_TEST_SUMMARY.md',
]);

const requiredContextFiles = [
  'AGENTS.md',
  'docs/CONTEXT_INDEX.md',
  'docs/rules/LOCKED_LOGIC.md',
  'docs/PRODUCT_VISION.md',
  'docs/ARCHITECTURE.md',
  'docs/SCHEMA.md',
];

const normalizeRelative = value => value.split(path.sep).join('/');

const shouldExclude = absolutePath => {
  const relativePath = normalizeRelative(path.relative(workspaceRoot, absolutePath));
  const pathSegments = relativePath.split('/');
  return relativePath === '.tmp_pr_body.md'
    || excludedRelativeFiles.has(relativePath)
    || pathSegments.some(segment => ['.git', 'build', 'dist', 'node_modules'].includes(segment))
    || excludedRelativePrefixes.some(prefix => relativePath.startsWith(prefix));
};

const collectMarkdownFiles = directory => {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (shouldExclude(absolutePath)) continue;

    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(absolutePath);
    }
  }

  return files;
};

const isExternalTarget = target => /^(?:https?:|mailto:|tel:|data:|#)/i.test(target);
const repositoryPathPattern = /^(?:(?:\.agents|\.claude|\.codex|api|components|docs|functions|hooks|scripts|tests|utils)\/|(?:\.env\.example|\.firebaserc|AGENTS\.md|App\.tsx|FIREBASE_RULES\.md|ORCHESTRATOR\.md|README\.md|cors\.json|firebase\.json|firestore\.indexes\.json|firestore\.rules|index\.html|index\.tsx|package-lock\.json|package\.json|storage\.rules|tsconfig\.json|vercel\.json|vite\.config\.ts)$)/;
const proposedPathsStartMarker = '<!-- docs:allow-missing-paths-begin -->';
const proposedPathsEndMarker = '<!-- docs:allow-missing-paths-end -->';

// Active context is expected to describe real repository paths. Proposed file
// layouts must opt out explicitly so an old path cannot silently become
// accepted merely because it lives outside Tier 1.
const shouldValidateCodePaths = relativePath => !excludedRelativeFiles.has(relativePath);

const intentionalClaudeAdapterDifferences = new Set([
  'doc-review',
  'pm-review',
  'pm-review-auto',
]);

const normalizeText = value => value.replace(/\r\n/g, '\n').trimEnd();

const isOutsideWorkspace = resolvedPath => {
  const relativeTarget = path.relative(workspaceRoot, resolvedPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) return true;
  if (!existsSync(resolvedPath)) return false;

  const realRelativeTarget = path.relative(realWorkspaceRoot, realpathSync(resolvedPath));
  return realRelativeTarget.startsWith('..') || path.isAbsolute(realRelativeTarget);
};

const validateLocalPath = ({ declaredPath, label, lineNumber, relativePath, resolveFrom }) => {
  if (path.isAbsolute(declaredPath) || /^[A-Za-z]:[\\/]/.test(declaredPath)) {
    errors.push(`${relativePath}:${lineNumber}: nonportable absolute ${label} ${declaredPath}`);
    return;
  }

  const resolvedPath = path.resolve(resolveFrom, declaredPath);
  if (isOutsideWorkspace(resolvedPath)) {
    errors.push(`${relativePath}:${lineNumber}: ${label} escapes the workspace ${declaredPath}`);
  } else if (!existsSync(resolvedPath)) {
    errors.push(`${relativePath}:${lineNumber}: ${label} does not exist ${declaredPath}`);
  }
};

const errors = [];
const markdownFiles = collectMarkdownFiles(workspaceRoot);

for (const requiredFile of requiredContextFiles) {
  if (!existsSync(path.join(workspaceRoot, requiredFile))) {
    errors.push(`${requiredFile}: required context file is missing`);
  }
}

for (const absolutePath of markdownFiles) {
  const relativePath = normalizeRelative(path.relative(workspaceRoot, absolutePath));
  const contents = readFileSync(absolutePath, 'utf8');
  const lines = contents.split(/\r?\n/);

  let allowsMissingCodePaths = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (line.includes(proposedPathsStartMarker)) {
      if (allowsMissingCodePaths) {
        errors.push(`${relativePath}:${lineNumber}: nested proposed-path opt-out marker`);
      }
      allowsMissingCodePaths = true;
      return;
    }
    if (line.includes(proposedPathsEndMarker)) {
      if (!allowsMissingCodePaths) {
        errors.push(`${relativePath}:${lineNumber}: proposed-path opt-out ends without a start marker`);
      }
      allowsMissingCodePaths = false;
      return;
    }

    const hasWindowsMachinePath = /[A-Za-z]:[\\/](?:Users|Documents)[\\/]/i.test(line)
      || /\\\\[^\\\s]+\\[^\\\s]+/.test(line);
    const hasUnixMachinePath = /\/(?:home|Users)\/[^/\s]+/.test(line);
    if (hasWindowsMachinePath || hasUnixMachinePath) {
      errors.push(`${relativePath}:${lineNumber}: machine-specific absolute path`);
    }

    if (/`\.Codex(?:[\\/]|`)/.test(line)) {
      errors.push(`${relativePath}:${lineNumber}: obsolete .Codex path; use the repository's canonical paths`);
    }

    for (const match of line.matchAll(/\(file:\s*((?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|(?:\.agents|\.claude|\.codex|api|components|docs|functions|hooks|scripts|tests|utils)[\\/])[^)]+)\)/g)) {
      const declaredPath = match[1].trim();
      validateLocalPath({
        declaredPath,
        label: 'declared file path',
        lineNumber,
        relativePath,
        resolveFrom: workspaceRoot,
      });
    }

    if (shouldValidateCodePaths(relativePath) && !allowsMissingCodePaths) {
      for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
        const candidate = match[1].trim().replace(/:\d+(?:-\d+)?$/, '');
        if (!repositoryPathPattern.test(candidate) || /[*{}\s]/.test(candidate)) continue;
        validateLocalPath({
          declaredPath: candidate,
          label: 'code-formatted repository path',
          lineNumber,
          relativePath,
          resolveFrom: workspaceRoot,
        });
      }
    }

    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, '');
      if (!rawTarget || isExternalTarget(rawTarget)) continue;

      const targetWithoutAnchor = rawTarget.split('#', 1)[0].split('?', 1)[0];
      if (!targetWithoutAnchor) continue;

      if (path.isAbsolute(targetWithoutAnchor) || /^[A-Za-z]:[\\/]/.test(targetWithoutAnchor)) {
        errors.push(`${relativePath}:${lineNumber}: nonportable absolute Markdown link ${rawTarget}`);
        continue;
      }

      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(targetWithoutAnchor);
      } catch {
        errors.push(`${relativePath}:${lineNumber}: invalid URL encoding in Markdown link ${rawTarget}`);
        continue;
      }

      validateLocalPath({
        declaredPath: decodedTarget,
        label: 'Markdown link',
        lineNumber,
        relativePath,
        resolveFrom: path.dirname(absolutePath),
      });
    }

    const referenceLinkMatch = line.match(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/);
    if (referenceLinkMatch) {
      const rawTarget = (referenceLinkMatch[1] ?? referenceLinkMatch[2]).trim();
      if (!isExternalTarget(rawTarget)) {
        const targetWithoutAnchor = rawTarget.split('#', 1)[0].split('?', 1)[0];
        if (targetWithoutAnchor) {
          let decodedTarget;
          try {
            decodedTarget = decodeURIComponent(targetWithoutAnchor);
          } catch {
            errors.push(`${relativePath}:${lineNumber}: invalid URL encoding in reference-style Markdown link ${rawTarget}`);
          }
          if (decodedTarget !== undefined) {
            validateLocalPath({
              declaredPath: decodedTarget,
              label: 'reference-style Markdown link',
              lineNumber,
              relativePath,
              resolveFrom: path.dirname(absolutePath),
            });
          }
        }
      }
    }
  });

  if (allowsMissingCodePaths) {
    errors.push(`${relativePath}: proposed-path opt-out marker is not closed`);
  }

  if (relativePath.endsWith('/SKILL.md')) {
    const frontmatter = contents.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatter) {
      errors.push(`${relativePath}: missing YAML frontmatter`);
    } else {
      if (!/^name:\s*\S+/m.test(frontmatter[1])) {
        errors.push(`${relativePath}: frontmatter is missing name`);
      }
      if (!/^description:\s*\S+/m.test(frontmatter[1])) {
        errors.push(`${relativePath}: frontmatter is missing description`);
      }
    }
  }

  if (!statSync(absolutePath).isFile()) {
    errors.push(`${relativePath}: expected a regular Markdown file`);
  }
}

const portableSkillsRoot = path.join(workspaceRoot, '.agents', 'skills');
const claudeSkillsRoot = path.join(workspaceRoot, '.claude', 'skills');
if (existsSync(portableSkillsRoot) && existsSync(claudeSkillsRoot)) {
  const portableSkillNames = readdirSync(portableSkillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(path.join(portableSkillsRoot, name, 'SKILL.md')));
  const claudeSkillNames = readdirSync(claudeSkillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(path.join(claudeSkillsRoot, name, 'SKILL.md')));

  for (const skillName of portableSkillNames) {
    const portablePath = path.join(portableSkillsRoot, skillName, 'SKILL.md');
    const claudePath = path.join(claudeSkillsRoot, skillName, 'SKILL.md');
    if (!existsSync(claudePath)) {
      errors.push(`.claude/skills/${skillName}/SKILL.md: missing adapter for portable skill`);
      continue;
    }
    if (!intentionalClaudeAdapterDifferences.has(skillName)) {
      const portableContents = normalizeText(readFileSync(portablePath, 'utf8'));
      const claudeContents = normalizeText(readFileSync(claudePath, 'utf8'));
      if (portableContents !== claudeContents) {
        errors.push(`.claude/skills/${skillName}/SKILL.md: drifted from portable skill without an approved adapter exception`);
      }
    }
  }

  for (const skillName of claudeSkillNames) {
    if (!portableSkillNames.includes(skillName)) {
      errors.push(`.claude/skills/${skillName}/SKILL.md: adapter has no portable source`);
    }
  }
}

const staleSemanticPatterns = [
  {
    file: 'ORCHESTRATOR.md',
    pattern: /without closest-bucket/i,
    message: 'obsolete exact-only runtime rule; nearest eligible same-orientation fallback is locked',
  },
  {
    file: '.agents/skills/fixed-route-pipeline/SKILL.md',
    pattern: /fall back to raw CSV/i,
    message: 'unsafe raw-runtime fallback conflicts with the approved-runtime trust boundary',
  },
  {
    file: '.agents/skills/time-parsing/SKILL.md',
    pattern: /1\.02083\)\)\.toBe\(30\)/,
    message: 'fixed-route Excel next-day example discards the day offset',
  },
  {
    file: '.agents/skills/schedule-domain/SKILL.md',
    pattern: /Short-turn[^\n]*Not currently supported/i,
    message: 'short turns are supported by the current Schedule Editor',
  },
  {
    file: '.claude/context.md',
    pattern: /Locked Logic \(6 Rules\)/,
    message: 'locked-rule count is stale',
  },
];

for (const check of staleSemanticPatterns) {
  const absolutePath = path.join(workspaceRoot, check.file);
  if (existsSync(absolutePath) && check.pattern.test(readFileSync(absolutePath, 'utf8'))) {
    errors.push(`${check.file}: ${check.message}`);
  }
}

if (errors.length > 0) {
  console.error(`Documentation context check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation context check passed for ${markdownFiles.length} active Markdown files.`);
}
