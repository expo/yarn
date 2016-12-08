Yarn Workspaces
---------------

This work is based off of Rust's "Cargo" package manager's concept of "workspaces": https://github.com/rust-lang/rfcs/blob/master/text/1525-cargo-workspace.md

## Motivations

In a repo containing multiple JavaScript projects, such as a monorepo-type setup like [Babel](https://github.com/babel/babel) or [Jest](https://github.com/facebook/jest), or within a given company's internal monolithic repository, it can be a pain to manage dependencies between the different packages.

Even with current solutions such as [Lerna](https://github.com/lerna/lerna), there are downsides that can cause difficult to reproduce behavior.

At the end of the day, while simultaneously developing multiple JS projects that depend on one another, you want the behavior you're mimicking during the development cycle to be as similar as possible to the production behavior.

Current approaches (whether Lerna-based or custom) often use `yarn link` or `npm link` to connect packages together. These "link" commands operate as follows:

- When running `yarn link` inside of package "foo", it symlinks it to a globally accessible directory (by default `.config/yarn/link` on macOS).
- In package "bar", when running `yarn link foo`, it symlinks from the global "link" directory into your projects `node_modules` folder.

Generally, this works fine, but it has some downsides:

- This method doesn't faithfully represent the node_modules directory that would exist in a production environment. Due to the fact that `yarn link` symlinks the entire package folder, it also includes the nested node_module folder, which means that certain dependencies within that package may be resolved differently than they are in production, depending on the configuration of the consuming package.
- This global link is named only with the package name, not it's version. Thus, it's impossible to simultaneously develop two different versions of the same package (e.g., a `latest` and `next` version).
- `node_modules` are not isolated correctly. A good example of this is when developing a library, containing native dependencies, that's shared between Electron and some version of Node. If you want to develop that library simultaneously for both platforms, you're going to run into trouble -- the native modules that are compiled on post install are going to be shared between Electron and Node, given the transitively linked `node_modules` folder within the linked package.

## Goals

## Implementation

- yarn install
  1) Resolve workspace root
  2) Build dep graph of workspace dependencies for this package.
  3) In each, publish to .yarn-workspaces (in workspace root)
    a) Do like yarn publish
    b) Instead of tar, symlink each file in `files` to .yarn-workspace/[pkg]-x.y.z
      i) Throw if dependency is duplicate
  4) Continue with install
    // runs first -- symlinks back to corresponding workspace dep
    a) Add fetchers/workspace-fetcher.js
    b) Add resolvers/exotics/workspace-resolver.js
