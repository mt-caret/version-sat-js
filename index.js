import fs from 'fs';
import util from 'util';
import npmFetch from 'npm-registry-fetch';
import deepEqual from 'deep-equal';
import semver from 'semver';

async function fetchVersions(packageName) {
  const result = await npmFetch.json(`/${packageName}`)
    .catch((err) => { console.error(err); return null; });
  if (result == null || result.versions == null) {
    return [];
  } else {
    return Object.values(result.versions)
    .map(({ name, version, dependencies }) =>
      ({ name, version, dependencies: dependencies ? dependencies : {} }));
  }
}

async function addDepsForPackage(packages, newPackageName) {
  console.log(`adding packages for: ${newPackageName}`);
  packages[newPackageName] = await fetchVersions(newPackageName);
  for (const version of packages[newPackageName]) {
    if (version == null || version.dependencies == null) continue;

    const tasks =
      Object.entries(version.dependencies)
        .map(([ packageName, _versionSpec ]) => {
          if (packages[packageName] === undefined) {
            return addDepsForPackage(packages, packageName);
          } else {
            return Promise.resolve();
          }
        });
    await Promise.all(tasks);
  }
}

async function genClosure() {
  const content = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

  let packages = {};

  for (const [ packageName, _versionSpec ] of Object.entries(content.dependencies)) {
    await addDepsForPackage(packages, packageName);
  }

  packages[content.name] = [
    (({ version, dependencies }) => ({ version, dependencies }))(content)
  ];

  console.log('collected dependencies, writing to file');
  fs.writeFileSync(process.argv[4], JSON.stringify(packages));
  console.log('done');
}

function listVersions() {
  const packages = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const packageName = process.argv[4];
  const versionSpec = process.argv[5];

  if (packages[packageName] == null) {
    console.error(`package '${packageName}' not found`);
    process.exit(1);
  }

  for (const { version } of packages[packageName]) {
    if (semver.satisfies(version, versionSpec)) {
      console.log(version);
    }
  }
}

function installLatestVersion(registry, installed, packageName, versionSpec, requiredByPackage) {
  if (installed[packageName] != null) {
    // we assume that versions are sorted in ascending order
    for (let i = installed[packageName].length - 1; i >= 0; i--) {
      if (semver.satisfies(installed[packageName][i].version, versionSpec)) {
        if (!installed[packageName][i].requiredBy.includes(requiredByPackage)) {
          installed[packageName][i].requiredBy.push(requiredByPackage);
        }
        return;
      }
    }
  } else {
    installed[packageName] = [];
  }

  for (let i = registry[packageName].length - 1; i >= 0; i--) {
    if (semver.satisfies(registry[packageName][i].version, versionSpec)) {
      const validDep = registry[packageName][i];
      validDep.requiredBy = [ requiredByPackage ];
      installed[packageName].push(validDep);

      for (const [ depPackageName, depVersionSpec ] of Object.entries(validDep.dependencies)) {
        installLatestVersion(registry, installed, depPackageName, depVersionSpec, packageName);
      }
      return;
    }
  }

  console.error(`could not install '${packageName}' (version spec: ${versionSpec})`);
  process.exit(1);
}

function naiveResolve() {
  const packages = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const content = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));

  let result = {};

  installLatestVersion(packages, result, content.name, content.version, "_naiveResolve");

  console.log('resolved dependencies, writing to file');
  fs.writeFileSync(process.argv[5], JSON.stringify(result));
  console.log('done');
}

function* enumDeps(registry, installed, dependencies, index) {
  if (dependencies.length == index) {
    yield [];
    return;
  }

  const [ depName, depVersionSpec ] = dependencies[index];

  if (installed[depName] != null) {
    if (semver.satisfies(installed[depName].version, depVersionSpec)) {
      const iterator =
        enumDeps(registry, installed, dependencies, index + 1);
      for (let candidateDeps of iterator) {
        candidateDeps.push(installed[depName]);
        yield candidateDeps;
        candidateDeps.pop();
      }
    }

    return;
  }

  // TODO: This doesn't work?
  // this probably doesn't since enumDeps is not the same once we yield.
  //
  //let allCandidateDeps = [];
  //for (const candidateDeps in enumDeps(registry, installed, dependencies, index + 1)) {
  //  allCandidateDeps.push(candidateDeps);
  //}

  for (let i = registry[depName].length - 1; i >= 0; i--) {
    if (!semver.satisfies(registry[depName][i].version, depVersionSpec)) {
      continue;
    }

    for (let candidateDeps of enumDeps(registry, installed, dependencies, index + 1)) {
      candidateDeps.push(registry[depName][i]);
      yield candidateDeps;
      candidateDeps.pop();
    }
  }
}

// assumes version exists in registry
function backtrackInstall(registry, installed, content) {
  let newInstalled = { ...installed };
  newInstalled[content.name] =
    { name: content.name, version: content.version, dependencies: content.dependencies };

  console.log(`attempting install of ${content.name} (${content.version})`);

  for (const candidateDeps of enumDeps(registry, newInstalled, Object.entries(content.dependencies), 0)) {
    let isCandidateValid = true;
    let updatedInstalled = newInstalled;
    for (const dep of candidateDeps) {
      const result = backtrackInstall(registry, updatedInstalled, dep);
      if (!result.isValid) {
        isCandidateValid = false;
        break;
      }
      updatedInstalled = result.installed;
    }

    if (isCandidateValid) {
      return { isValid: true, installed: updatedInstalled };
    }
  }

  return { isValid: false, installed: {} };
}

function backtrackingResolve() {
  const packages = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const content = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));

  let result = {};

  if (packages[content.name] == null) {
    console.error(`package '${content.name}' does not exist in dependency closure`);
    process.exit(1);
  }

  let { isValid, installed } =
    backtrackInstall(packages, result, content);

  if (!isValid) {
    console.error('dependency resolution failed');
    process.exit(1);
  }

  console.log('resolved dependencies, writing to file');
  fs.writeFileSync(process.argv[5], JSON.stringify(installed));
  console.log('done');
}

if (process.argv.length < 3) {
  console.error('supply subcommnd');
  process.exit(1);
}

const subcommand = process.argv[2];
switch (subcommand) {
  case 'gen-closure':
    if (process.argv.length !== 5) {
      console.error('usage: node index.js gen-closure [path to package.json] [output file]');
      process.exit(1);
    }
    genClosure();
    break;
  case 'list-versions':
    if (process.argv.length !== 6) {
      console.error('usage: node index.js list-versions [path to dep closure] [package name] [version spec]');
      process.exit(1);
    }
    listVersions();
    break;
  case 'naive-resolve':
    if (process.argv.length !== 6) {
      console.error('usage: node index.js naive-resolve [path to dep closure] [path to package.json] [output file]');
      process.exit(1);
    }
    naiveResolve();
    break;
  case 'resolve':
    if (process.argv.length !== 6) {
      console.error('usage: node index.js resolve [path to dep closure] [path to package.json] [output file]');
      process.exit(1);
    }
    backtrackingResolve();
    break;
  default:
    console.error(`unrecognized subcommand: ${subcommand}`);
    process.exit(1);
}
