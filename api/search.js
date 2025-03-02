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
  let insideClass = false;
  let insideDocstring = false;
  let descriptionLines = [];

  for (let i = 0; i < modCodeLines.length; i++) {
    let line = modCodeLines[i];
    if (!line) continue;
    line = line.trim();

    if (line.startsWith("# meta banner:") && line.includes(":")) {
      banner = line.split(":").slice(1).join(":").trim() || banner;
    }
    if (line.startsWith("# meta developer:") && line.includes(":")) {
      developer = line.split(":").slice(1).join(":").trim() || developer;
    }

    const nameMatch = line.match(/["']name["']\s*:\s*["'](.+?)["']/);
    if (nameMatch && !name) {
      name = nameMatch[1];
    }

    if (line.startsWith("class ") && line.includes("(loader.Module)")) {
      insideClass = true;
    }

    if (insideClass) {
      if (line.startsWith('"""') && line.endsWith('"""') && line.length > 6) {
        description = line.slice(3, -3).trim();
        insideClass = false;
        continue;
      }

      if (line.startsWith('"""') && !insideDocstring) {
        insideDocstring = true;
        descriptionLines = [];
        let content = line.slice(3).trim();
        if (content.endsWith('"""')) {
          description = content.slice(0, -3).trim();
          insideDocstring = false;
          insideClass = false;
        } else if (content) {
          descriptionLines.push(content);
        }
        continue;
      }

      if (insideDocstring) {
        if (line.endsWith('"""')) {
          let content = line.slice(0, -3).trim();
          if (content) {
            descriptionLines.push(content);
          }
          description = descriptionLines.join(" ").trim();
          insideDocstring = false;
          insideClass = false;
          continue;
        } else {
          descriptionLines.push(line);
        }
      }
    }

    if (line.includes('def ') || line.includes('class ')) {
      continue;
    }
  }

  if (!description) {
    description = "No description available";
  }

  return { 
    name: name || null, 
    description: description || null, 
    banner: banner || null, 
    developer: developer || null
  };
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
      const fullTxtResponse = await fetch(`https://modules.fajox.one${repo.path}/full.txt`);
      const fullTxt = await fullTxtResponse.text();

      const modules = fullTxt.split('\n').map(module => {
        return { repoPath: repo.path, module };
      });

      allModules.push(...modules);
    }

    const modulesWithRatios = await Promise.all(allModules.map(async (module) => {
      const ratio = getRatio(query, module.module);
      if (ratio > 0) {
        const moduleLink = `https://modules.fajox.one${encodeURI(module.repoPath)}/${encodeURIComponent(module.module.replace(/\r/g, ""))}.py`;
        const moduleInfo = await getModuleInfo(moduleLink);
        return {
          module: module.module.replace(/\r/g, ""),
          ratio,
          name: moduleInfo.name || module.module.replace(/\r/g, ""),
          description: moduleInfo.description,
          banner: moduleInfo.banner,
          developer: moduleInfo.developer,
          link: moduleLink.replace(/\r/g, ""),
        };
      }
      return null;
    }));

    const filteredModules = modulesWithRatios.filter(module => module !== null);

    filteredModules.sort((a, b) => {
      if (b.ratio !== a.ratio) {
        return b.ratio - a.ratio;
      }

      if (b.module.length !== a.module.length) {
        return b.module.length - a.module.length;
      }

      return a.module.localeCompare(b.module);
    });

    const bestModules = filteredModules.slice(0, limit);

    res.status(200).json({ results: bestModules });

  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}
