import fs from 'fs';
import util from 'util';
import npmFetch from 'npm-registry-fetch';
import deepEqual from 'deep-equal';

if (process.argv.length !== 4) {
  console.error('usage: node index.js [path to package.json] [output file]');
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

(async () => {
  const content = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

  let packages = {};

  for (const [ packageName, _versionRange ] of Object.entries(content.dependencies)) {
    await addDepsForPackage(packages, packageName);
  }

  console.log('collected dependencies, writing to file');
  fs.writeFileSync(process.argv[3], JSON.stringify(packages));
  console.log('done');
})()
