// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Generic
import {Changelog} from '../updaters/changelog';
// Cargo.toml support
import {CargoLock} from '../updaters/rust/cargo-lock';
import {parseCargoManifest} from '../updaters/rust/common';
import {BuildUpdatesOptions} from './base';
import {VersionsMap} from '../version';
import {Update} from '../update';
import {CargoWorkspaceToml} from '../updaters/rust/cargo-workspace-toml';
import {Rust} from './rust';

/**
 * Strategy for Rust workspaces where:
 * - workspace.package.version in root Cargo.toml is the source of truth
 * - Root package name is used as the package name
 * - All workspace members inherit the version
 */
export class RustMonorepo extends Rust {
  protected async buildUpdates(
    options: BuildUpdatesOptions
  ): Promise<Update[]> {
    const updates: Update[] = [];
    const version = options.newVersion;

    !this.skipChangelog &&
      updates.push({
        path: this.addPath(this.changelogPath),
        createIfMissing: true,
        updater: new Changelog({
          version,
          changelogEntry: options.changelogEntry,
        }),
      });

    const workspaceManifest = await this.getPackageManifest();
    const versionsMap: VersionsMap = new Map();

    if (!workspaceManifest?.workspace) {
      throw new Error(
        'RustMonorepo strategy requires a workspace in root Cargo.toml'
      );
    }

    if (!workspaceManifest.workspace.package?.version) {
      throw new Error(
        'RustMonorepo strategy requires workspace.package.version in root Cargo.toml'
      );
    }

    if (!workspaceManifest.package?.name) {
      throw new Error(
        'RustMonorepo strategy requires package.name in root Cargo.toml'
      );
    }

    const members = workspaceManifest.workspace.members;
    if (!members || members.length === 0) {
      throw new Error(
        'RustMonorepo strategy requires workspace members in root Cargo.toml'
      );
    }

    // Use root package name as the package name
    const rootPackageName = workspaceManifest.package.name;
    versionsMap.set(rootPackageName, version);

    this.logger.info(
      `found workspace with ${members.length} members, upgrading all to version ${version}`
    );

    // Collect workspace member package names for dependency updates
    for (const member of members) {
      const manifestPath = `${member}/Cargo.toml`;
      const manifestContent = await this.getContent(manifestPath);
      if (!manifestContent) {
        this.logger.warn(
          `member ${member} declared but did not find Cargo.toml`
        );
        continue;
      }
      const manifest = parseCargoManifest(manifestContent.parsedContent);
      if (!manifest.package?.name) {
        this.logger.warn(`member ${member} has no package name`);
        continue;
      }
      versionsMap.set(manifest.package.name, version);
    }
    this.logger.debug('versions map:', versionsMap);

    // Update root Cargo.toml with workspace.package.version
    updates.push({
      path: this.addPath('Cargo.toml'),
      createIfMissing: false,
      updater: new CargoWorkspaceToml(version),
    });

    // Update Cargo.lock
    updates.push({
      path: this.addPath('Cargo.lock'),
      createIfMissing: false,
      updater: new CargoLock(versionsMap),
    });

    return updates;
  }
}
