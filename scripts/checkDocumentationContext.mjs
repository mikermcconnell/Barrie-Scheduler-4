import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  'docs/superpowers/plans/',
];

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

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/(?:\/)?[A-Za-z]:[\\/](?:Users|Documents)[\\/]/i.test(line)) {
      errors.push(`${relativePath}:${lineNumber}: machine-specific absolute path`);
    }

    if (/`\.Codex(?:[\\/]|`)/.test(line)) {
      errors.push(`${relativePath}:${lineNumber}: obsolete .Codex path; use the repository's canonical paths`);
    }

    for (const match of line.matchAll(/\(file:\s*((?:\.{0,2}[\\/]|[A-Za-z]:[\\/])[^)]+)\)/g)) {
      const declaredPath = match[1].trim();
      if (path.isAbsolute(declaredPath) || /^[A-Za-z]:[\\/]/.test(declaredPath)) {
        errors.push(`${relativePath}:${lineNumber}: nonportable declared file path ${declaredPath}`);
        continue;
      }

      const resolvedPath = path.resolve(workspaceRoot, declaredPath);
      const relativeTarget = path.relative(workspaceRoot, resolvedPath);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        errors.push(`${relativePath}:${lineNumber}: declared file path escapes the workspace ${declaredPath}`);
      } else if (!existsSync(resolvedPath)) {
        errors.push(`${relativePath}:${lineNumber}: declared file path does not exist ${declaredPath}`);
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

      const resolvedTarget = path.resolve(path.dirname(absolutePath), decodedTarget);
      const relativeTarget = path.relative(workspaceRoot, resolvedTarget);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        errors.push(`${relativePath}:${lineNumber}: Markdown link escapes the workspace ${rawTarget}`);
      } else if (!existsSync(resolvedTarget)) {
        errors.push(`${relativePath}:${lineNumber}: broken Markdown link ${rawTarget}`);
      }
    }
  });

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

if (errors.length > 0) {
  console.error(`Documentation context check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation context check passed for ${markdownFiles.length} active Markdown files.`);
}
