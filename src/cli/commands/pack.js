/* @flow */

import type {Reporter} from '../../reporters/index.js';
import type Config from '../../config.js';
import * as fs from '../../util/fs.js';
import {ignoreLinesToRegex, filterOverridenGitignores} from '../../util/filter.js';
import {MessageError} from '../../errors.js';
import micromatch from 'micromatch';

const zlib = require('zlib');
const path = require('path');
const tar = require('tar-fs');
const fs2 = require('fs');

const FOLDERS_IGNORE = [
  // never allow version control folders
  '**/.git/',
  '**/.git/**',
  '**/CVS',
  '**/CVS/**',
  '**/.svn',
  '**/.svn/**',
  '**/.hg',
  '**/.hg/**',
];

const DEFAULT_IGNORE = [
  ...FOLDERS_IGNORE,

  '**/.yarnignore',
  '**/.npmignore',
  '**/.gitignore',

  // ignore cruft
  '**/.DS_Store',
  '**/yarn.lock',
  '**/.lock-wscript',
  '**/.wafpickle-{0..9}',
  '**/build/config.gypi',
  '**/*.swp',
  '**/._*',
  '**/*.orig',
  '**/npm-debug.log',
  '**/yarn-error.log',
  '**/.npmrc',
  '**/.yarnrc',
  '**/package-lock.json',
];

const NEVER_IGNORE = [
  // never ignore these files
  'package.json',
  '@(readme|license|licence|notice|changes|changelog|history)?(.*)',
];

export async function getFilesToPack(config: Config): Promise<Set<string>> {
  const pkg = await config.readRootManifest();
  const {bundleDependencies, main, files: onlyFiles} = pkg;

  // include required files
  const filters: {[path: string]: Array<string>} = {
    '.': [],
  };

  // `files` field
  if (onlyFiles) {
    filters['.'] = filters['.'].concat(
      onlyFiles.map((filename: string): string => `${filename}`),
      onlyFiles.map((filename: string): string => `${path.join(filename, '**')}`),
    );
  } else {
    // include default filters unless `files` is used
    filters['.'] = filters['.'].concat(
      ['*', '*/**'], // include everything
      DEFAULT_IGNORE.map(l => '!' + l), //ignore the defaults
    );
  }

  // Include NEVER_IGNORE
  filters['.'] = filters['.'].concat(NEVER_IGNORE.slice());

  if (main) {
    filters['.'] = filters['.'].concat([main]);
  }

  const foldersToIgnore = new Set(FOLDERS_IGNORE);

  // include bundledDependencies
  if (bundleDependencies) {
    const folder = config.getFolder(pkg);
    filters['.'] = filters['.'].concat(bundleDependencies.map((name): string => `${folder}/${name}/**`));
  } else {
    foldersToIgnore.add('node_modules');
  }

  const files = await fs.walk(config.cwd, null, foldersToIgnore);
  const dotIgnoreFiles = filterOverridenGitignores(files);

  // create ignores
  for (const file of dotIgnoreFiles) {
    const raw = await fs.readFile(file.absolute);
    const lines = raw.split('\n');
    const regexes = ignoreLinesToRegex(lines, path.dirname(file.relative));
    if (!filters[path.dirname(file.relative)]) {
      filters[path.dirname(file.relative)] = [];
    }
    filters[path.dirname(file.relative)].unshift(
      ...regexes.map(filter => {
        let patt = filter.pattern;
        if (!filter.isNegation) {
          patt = `!${patt}`;
        }
        return patt;
      }),
    );
  }

  function getNearestFilterSet(filename: string): {base: string, filters: Array<string>} {
    const dir = path.dirname(filename);
    if (filters[dir]) {
      return {base: dir, filters: filters[dir]};
    }
    return getNearestFilterSet(dir);
  }

  function filterWithFilterSet(filename: string, base: string, filterSet: Array<string>): boolean {
    const pathRelativeToFilterSet = path.relative(base, filename);

    const mmOpts = {
      dot: true,
      nocase: true,
    };
    let keep = false;
    if (filterSet) {
      for (const filter of filterSet) {
        const isNegation = filter.startsWith('!');

        // Negation and match --> don't keep
        // Not negation and match --> keep
        // No match and has parent --> run the parent rules
        if (isNegation && micromatch.isMatch(pathRelativeToFilterSet, filter.slice(1), mmOpts)) {
          keep = false;
        } else if (!isNegation && micromatch.isMatch(pathRelativeToFilterSet, filter, mmOpts)) {
          keep = true;
        } else if (base !== '.') {
          const {base: parentBase, filters: parentFilterSet} = getNearestFilterSet(base);
          if (parentFilterSet && parentBase) {
            return filterWithFilterSet(filename, parentBase, parentFilterSet);
          }
        }
      }
    }

    return keep;
  }

  const keepFiles = new Set();
  for (const f of files) {
    const file = f.relative;
    let keep = false;

    const {base, filters: nearestFilterSet} = getNearestFilterSet(file);
    keep = filterWithFilterSet(file, base, nearestFilterSet);

    if (keep) {
      keepFiles.add(file);
    }
  }

  return keepFiles;
}

export async function packTarball(
  config: Config,
  {mapHeader}: {mapHeader?: Object => Object} = {},
): Promise<stream$Duplex> {
  const filesToPack = await getFilesToPack(config);
  const packer = tar.pack(config.cwd, {
    entries: [...filesToPack.values()],
    map: header => {
      const suffix = header.name === '.' ? '' : `/${header.name}`;
      header.name = `package${suffix}`;
      delete header.uid;
      delete header.gid;
      return mapHeader ? mapHeader(header) : header;
    },
  });
  return packer;
}

export async function pack(config: Config, dir: string): Promise<stream$Duplex> {
  const packer = await packTarball(config);
  const compressor = packer.pipe(new zlib.Gzip());

  return compressor;
}

export function setFlags(commander: Object) {
  commander.option('-f, --filename <filename>', 'filename');
}

export function hasWrapper(commander: Object, args: Array<string>): boolean {
  return true;
}

export async function run(config: Config, reporter: Reporter, flags: Object, args: Array<string>): Promise<void> {
  const pkg = await config.readRootManifest();
  if (!pkg.name) {
    throw new MessageError(reporter.lang('noName'));
  }
  if (!pkg.version) {
    throw new MessageError(reporter.lang('noVersion'));
  }

  const normaliseScope = name => (name[0] === '@' ? name.substr(1).replace('/', '-') : name);
  const filename = flags.filename || path.join(config.cwd, `${normaliseScope(pkg.name)}-v${pkg.version}.tgz`);

  await config.executeLifecycleScript('prepack');

  const stream = await pack(config, config.cwd);

  await new Promise((resolve, reject) => {
    stream.pipe(fs2.createWriteStream(filename));
    stream.on('error', reject);
    stream.on('close', resolve);
  });

  await config.executeLifecycleScript('postpack');

  reporter.success(reporter.lang('packWroteTarball', filename));
}
