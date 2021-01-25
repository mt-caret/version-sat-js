import fs from 'fs';
import util from 'util';
import npmFetch from 'npm-registry-fetch';
import deepEqual from 'deep-equal';

if (process.argv.length !== 3) {
  console.error('usage: node index.js [path to package.json]');
  process.exit(1);
}

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

    for (const [ packageName, _versionRange ] of Object.entries(version.dependencies)) {
      if (packages[packageName] === undefined) {
        await addDepsForPackage(packages, packageName);
      }
    }
  }
}

(async () => {
  const path = process.argv[2];
  const content = JSON.parse(fs.readFileSync(path, 'utf8'));

  let packages = {};

  for (const [ packageName, _versionRange ] of Object.entries(content.dependencies)) {
    await addDepsForPackage(packages, packageName);
  }

  //console.log(util.inspect(packages, false, null, true /* enable colors */))
  console.log(packages);
})()
