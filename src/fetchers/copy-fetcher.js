/* @flow */

import path from 'path';
import type {FetchedOverride} from '../types.js';
import BaseFetcher from './base-fetcher.js';
import Config from '../config.js';
import * as fs from '../util/fs.js';
import {getFilesToPack} from '../cli/commands/pack.js';

export default class CopyFetcher extends BaseFetcher {
  async _fetch(): Promise<FetchedOverride> {
    const pkgConfig = await Config.create(
      {
        cwd: this.reference,
      },
      this.reporter,
    );

    const {keepFiles} = await getFilesToPack(pkgConfig);

    const copyQueue = Array.from(keepFiles.values()).map(relativePath => ({
      src: path.join(this.reference, relativePath),
      dest: path.join(this.dest, relativePath),
    }));

    await fs.copyBulk(copyQueue, this.reporter);

    return {
      hash: this.hash || '',
      resolved: null,
    };
  }
}
