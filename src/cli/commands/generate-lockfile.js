/**
 * @flow
 */

import type {Reporter} from '../../reporters/index.js';
import type Config from '../../config.js';
import type {Manifest} from '../../types.js';
import type WorkspaceLayout from '../../workspace-layout.js';

import Lockfile, {stringify as lockStringify} from '../../lockfile';
import {Install} from './install';

export class GenerateLockfile extends Install {
  async bailout(patterns: Array<string>, workspaceLayout: ?WorkspaceLayout): Promise<boolean> { // eslint-disable-line
    const resolvedPatterns: {[packagePattern: string]: Manifest} = {};
    Object.keys(this.resolver.patterns).forEach(pattern => {
      if (!workspaceLayout || !workspaceLayout.getManifestByPattern(pattern)) {
        resolvedPatterns[pattern] = this.resolver.patterns[pattern];
      }
    });

    // TODO this code is duplicated in a few places, need a common way to filter out workspace patterns from lockfile
    patterns = patterns.filter(p => !workspaceLayout || !workspaceLayout.getManifestByPattern(p));

    const lockfileBasedOnResolver = this.lockfile.getLockfile(resolvedPatterns);

    const lockSource = lockStringify(lockfileBasedOnResolver, false, this.config.enableLockfileVersions);

    this.reporter.log(lockSource, {force: true});

    return true;
  }
}

export function hasWrapper(commander: Object, args: Array<string>): boolean {
  return false;
}

export function setFlags(commander: Object) {}

export async function run(config: Config, reporter: Reporter, flags: Object, args: Array<string>): Promise<void> {
  let lockfile;
  if (flags.lockfile === false) {
    lockfile = new Lockfile();
  } else {
    lockfile = await Lockfile.fromDirectory(config.lockfileFolder, reporter);
  }

  reporter.isSilent = true;
  const generateLockfile = new GenerateLockfile(flags, config, reporter, lockfile);
  await generateLockfile.init();
}
