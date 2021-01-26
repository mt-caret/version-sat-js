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
    .map(({ version, dependencies }) =>
      ({ version, dependencies: dependencies ? dependencies : {} }));
  }
}

async function addDepsForPackage(packages, newPackageName) {
  console.log(`adding packages for: ${newPackageName}`);
  packages[newPackageName] = await fetchVersions(newPackageName);
  for (const version of packages[newPackageName]) {
    if (version == null || version.dependencies == null) continue;

    const tasks =
      Object.entries(version.dependencies)
        .map(([ packageName, _versionRange ]) => {
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

  for (const [ packageName, _versionRange ] of Object.entries(content.dependencies)) {
    await addDepsForPackage(packages, packageName);
  }

  console.log('collected dependencies, writing to file');
  fs.writeFileSync(process.argv[4], JSON.stringify(packages));
  console.log('done');
}

function resolve() {
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
    getClosure();
    break;
  case 'resolve':
    if (process.argv.length !== 6) {
      console.error('usage: node index.js [path to dep closure] [package name] [version spec]');
      process.exit(1);
    }
    resolve();
    break;
  default:
    console.error(`unrecognized subcommand: ${subcommand}`);
    process.exit(1);
}


