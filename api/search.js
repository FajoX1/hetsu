const getQueryParam = (param, req) => req.query[param] || null;

const getRatio = (a, b) => {
  let matches = 0;
  let length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i].toLowerCase() === b[i].toLowerCase()) {
      matches++;
    }
  }
  return matches / length;
};

const getModuleInfo = async (modulePath) => {
  const fetch = await import('node-fetch').then((module) => module.default);
  
  const response = await fetch(modulePath);
  let moduleCode = await response.text();
  moduleCode = moduleCode.replace(/\r/g, "");

  const modCodeLines = moduleCode.split('\n');
  let name = null, description = null, banner = null, developer = null;

  for (let line of modCodeLines) {
    if (line.startsWith("# Name:")) name = line.split(":", 2)[1]?.trim() || name;
    if (line.startsWith("# Description:")) description = line.split(":", 2)[1]?.trim() || description;
    if (line.startsWith("# meta banner:")) banner = line.slice(line.indexOf(":") + 1).trim() || banner;
    if (line.startsWith("# meta developer:")) developer = line.slice(line.indexOf(":") + 1).trim() || developer;
  }

  return { name, description, banner, developer };
};

export default async function handler(req, res) {
  const query = getQueryParam('q', req);
  if (!query) return res.status(400).json({ error: "Query parameter 'q' is required" });

  let limit = parseInt(getQueryParam('limit', req)) || 5;

  try {
    const reposResponse = await fetch('https://modules.fajox.one/repos.json');
    const repos = await reposResponse.json();

    const allModules = [];

    for (let repo of repos) {
      const fullTxtResponse = await fetch(`https://modules.fajox.one/${repo.path}/full.txt`);
      const fullTxt = await fullTxtResponse.text();

      const modules = fullTxt.split('\n').map(module => {
        return { repoPath: repo.path, module };
      });

      allModules.push(...modules);
    }

    const modulesWithRatios = await Promise.all(allModules.map(async (module) => {
      const ratio = getRatio(query, module.module);
      if (ratio > 0) {
        const moduleInfo = await getModuleInfo(`https://modules.fajox.one/${module.repoPath}/${module.module}.py`);
        return {
          module: module.module.replace(/\r/g, ""),
          ratio,
          name: moduleInfo.name || module.module.replace(/\r/g, ""),
          description: moduleInfo.description,
          banner: moduleInfo.banner,
          developer: moduleInfo.developer,
        };
      }
      return null;
    }));

    const filteredModules = modulesWithRatios.filter(module => module !== null);
    filteredModules.sort((a, b) => b.ratio - a.ratio);

    const bestModules = filteredModules.slice(0, limit);

    res.status(200).json({ results: bestModules });

  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
