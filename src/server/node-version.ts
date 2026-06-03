const MIN_NODE_VERSION = [22, 5, 0] as const;

export const isSupportedNodeVersion = (version: string) => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  const [minMajor, minMinor, minPatch] = MIN_NODE_VERSION;

  if (major !== minMajor) {
    return major > minMajor;
  }

  if (minor !== minMinor) {
    return minor > minMinor;
  }

  return patch >= minPatch;
};

export const assertSupportedNodeVersion = () => {
  if (isSupportedNodeVersion(process.versions.node)) {
    return;
  }

  throw new Error(
    `Bookmark Demo requires Node.js >=${MIN_NODE_VERSION.join(".")} because it uses node:sqlite. Current version: ${process.versions.node}.`
  );
};
