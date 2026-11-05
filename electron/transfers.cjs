const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { info } = require("./file-operations.cjs");
function inspectSources(sources) {
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.length > 100 ||
    sources.some((file) => typeof file !== "string" || !path.isAbsolute(file))
  )
    throw Error("Choose 1–100 local files.");
  // Validate the entire selection before starting. Directory drops are explicit
  // errors rather than a surprise recursive upload of a large local tree.
  return sources.map((file) => {
    const before = info(file);
    if (before.directory || before.symlink || !fs.statSync(file).isFile())
      throw Error(
        "Drop regular files only; folder and symbolic-link uploads are not supported yet.",
      );
    return { file, before };
  });
}
async function importFiles(connection, root, directory, sources, options = {}) {
  const files = inspectSources(sources);
  const checkCancelled = () => {
    if (options.cancelled?.()) throw Error("Upload stopped.");
  };
  const completed = [];
  for (const { file, before } of files) {
    let token;
    try {
      checkCancelled();
      ({ token } = await connection.request("upload-start", {
        root,
        directory,
        name: path.basename(file),
        size: before.size,
      }));
      let offset = 0;
      checkCancelled();
      for await (const data of fs.createReadStream(file, {
        highWaterMark: 16384,
      })) {
        checkCancelled();
        await connection.request("upload-chunk", {
          token,
          offset,
          data: data.toString("base64"),
        });
        offset += data.length;
        options.progress?.(offset, before.size);
      }
      checkCancelled();
      if (info(file).revision !== before.revision)
        throw Error("Local file changed during transfer; retry.");
      options.committing?.();
      const result = await connection.request("upload-finish", { token });
      token = undefined;
      completed.push(result.path);
    } catch (error) {
      if (token)
        await connection.request("upload-abort", { token }).catch(() => {});
      throw Error(
        `${error.message}${completed.length ? ` (${completed.length} earlier files were copied successfully.)` : ""}`,
      );
    }
  }
  return { paths: completed };
}
async function downloadFile(
  connection,
  root,
  source,
  destination,
  allowReplace = false,
) {
  if (connection.kind !== "ssh")
    throw Error("Download is available in SSH workspaces.");
  if (typeof destination !== "string" || !path.isAbsolute(destination))
    throw Error("Choose an absolute local destination.");
  let original;
  try {
    original = info(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (original && (!allowReplace || original.directory || original.symlink))
    throw Error("Destination already exists. Choose another filename.");
  const temp = path.join(
    path.dirname(destination),
    ".owlet-download-" + crypto.randomUUID(),
  );
  let fd, token;
  try {
    const meta = await connection.request("download-open", {
      root,
      path: source,
    });
    token = meta.token;
    fd = fs.openSync(temp, "wx", 0o644);
    for (let offset = 0; offset < meta.size;) {
      const result = await connection.request("download-chunk", {
        token,
        offset,
      });
      const data = Buffer.from(result.data, "base64");
      if (
        !data.length ||
        data.length > 16384 ||
        offset + data.length > meta.size
      )
        throw Error("Incomplete download.");
      let written = 0;
      while (written < data.length)
        written += fs.writeSync(fd, data, written, data.length - written);
      offset += data.length;
    }
    await connection.request("download-finish", { token });
    token = undefined;
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (original) {
      if (info(destination).revision !== original.revision)
        throw Error(
          "Destination changed during download; choose another filename.",
        );
      fs.renameSync(temp, destination);
    } else {
      fs.linkSync(temp, destination);
      fs.unlinkSync(temp);
    }
    return { path: destination };
  } finally {
    if (token)
      await connection.request("download-abort", { token }).catch(() => {});
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
module.exports = { importFiles, downloadFile, inspectSources };
